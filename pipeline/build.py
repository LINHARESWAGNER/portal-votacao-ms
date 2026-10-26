"""
Pipeline do Portal de Votação MS.

Lê os ZIPs baixados do Portal de Dados Abertos do TSE (pasta data/raw),
cruza votação por seção com o cadastro de locais de votação (bairro e
coordenadas) e gera arquivos JSON estáticos em docs/data/ para o portal.

Uso:
    python pipeline/build.py            # processa tudo o que estiver em data/raw
    python pipeline/build.py --only dep_fed_2022
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import re
import shutil
import sys
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
WORK = ROOT / "data" / "processed"
OUT = ROOT / "docs" / "data"

UF = "MS"
CAMPO_GRANDE_TSE = "90514"  # código TSE do município de Campo Grande

# Conjuntos que o portal mostra. cargo = CD_CARGO do TSE.
DATASETS = [
    {"id": "ver_2020", "ano": 2020, "cargo": "13", "titulo": "Vereador 2020 · Campo Grande", "municipio": CAMPO_GRANDE_TSE},
    {"id": "ver_2024", "ano": 2024, "cargo": "13", "titulo": "Vereador 2024 · Campo Grande", "municipio": CAMPO_GRANDE_TSE},
    {"id": "dep_fed_2022", "ano": 2022, "cargo": "6", "titulo": "Deputado Federal 2022 · MS", "municipio": None},
    {"id": "dep_est_2022", "ano": 2022, "cargo": "7", "titulo": "Deputado Estadual 2022 · MS", "municipio": None},
    {"id": "dep_fed_2026", "ano": 2026, "cargo": "6", "titulo": "Deputado Federal 2026 · MS", "municipio": None},
    {"id": "dep_est_2026", "ano": 2026, "cargo": "7", "titulo": "Deputado Estadual 2026 · MS", "municipio": None},
]

csv.field_size_limit(10**9)

# Campo Grande: bairro oficial e região urbana de cada local de votação.
# geo/cg_regioes.json -> "coord": {"lat,lon" (4 casas): [bairro, região]} (classificação pelos limites do
# OpenStreetMap) e "nome": {bairro do TSE normalizado: [bairro, região]} (reserva para locais novos).
CAPITAL_NOME = "Campo Grande"
_CG = json.loads((Path(__file__).resolve().parent / "geo" / "cg_regioes.json").read_text("utf-8"))


def cg_bairro_regiao(info: dict) -> tuple[str, str]:
    if info.get("lat") is not None:
        hit = _CG["coord"].get(f"{info['lat']:.4f},{info['lon']:.4f}")
        if hit:
            return hit[0], hit[1]
    b = info.get("bairro", "")
    hit = _CG["nome"].get(b) or _CG["nome"].get(loose_key(b))
    if hit:
        return hit[0], hit[1]
    return "Não classificado", "Não classificado"


_RURAL = re.compile(r"\b(ZONA RURAL|RURAL|FAZENDA|SITIO|CHACARA|GLEBA|LINHA|ESTRADA|RODOVIA|BR \d+|MS \d+|KM \d+|CORREGO|PORTO|POVOADO|COLONIA|LOTE|SETOR RURAL|AREA RURAL)\b")
_ASSENT = re.compile(r"\b(ASSENTAMENTO|ASSENT|ACAMPAMENTO|PA )")
_ALDEIA = re.compile(r"\b(ALDEIA|RESERVA INDIGENA|TERRA INDIGENA|INDIGENA)\b")
_DISTR = re.compile(r"^(DISTRITO|DIST)( DE| DO| DA)? ")


def agrupa_bairro_interior(b: str, raw: str = "") -> str:
    """Agrupa os bairros do interior: junta numerações (Jardim X II -> Jardim X), separa distritos,
    e reúne zona rural, assentamentos e aldeias em três grupos."""
    s = norm_bairro(b)
    if s in ("NÃO INFORMADO", ""):
        return "Não informado"
    if _DISTR.search(s):
        return "Distrito de " + title_pt(_DISTR.sub("", s))
    if _ALDEIA.search(s):
        return "Aldeias / reservas indígenas"
    if _ASSENT.search(s + " "):
        return "Assentamentos"
    if _RURAL.search(s):
        return "Zona rural"
    s = re.sub(r"(\s+([IVX]+|\d+))+$", "", s).strip() or s
    # exibe com os acentos da grafia original do TSE, quando ela corresponde ao nome padronizado
    if raw:
        r = re.sub(r"\s+", " ", re.sub(r"[^\w ]", " ", raw.upper())).strip()
        r = re.sub(r"(\s+([IVX]+|\d+))+$", "", r).strip()
        if strip_accents(r) == s:
            return title_pt(r)
    return title_pt(s)


_PREFIXOS = ("LOTEAMENTO MUNICIPAL ", "LOTEAMENTO ", "CONJUNTO HABITACIONAL ", "CONJUNTO RESIDENCIAL ", "CONJUNTO ",
             "NUCLEO HABITACIONAL ", "PARQUE RESIDENCIAL ", "RESIDENCIAL ", "PARQUE ", "JARDIM ", "VILA ", "BAIRRO ")


def loose_key(b: str) -> str:
    """Chave tolerante: sem prefixos genéricos (Jardim, Vila, Loteamento…) e sem numeração final (I, II, 2…)."""
    s = norm_bairro(b)
    changed = True
    while changed:
        changed = False
        for p in _PREFIXOS:
            if s.startswith(p) and len(s) > len(p):
                s = s[len(p):]; changed = True
    return "~" + re.sub(r"(\s+([IVX]+|\d+))+$", "", s).strip()


# ----------------------------------------------------------------- utilidades
def log(*a):
    print(*a, flush=True)


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


ABREV = [
    (r"\bJD\b\.?", "JARDIM"), (r"\bJDM\b\.?", "JARDIM"), (r"\bJARD\b\.?", "JARDIM"),
    (r"\bVL\b\.?", "VILA"), (r"\bV\.\s", "VILA "),
    (r"\bPQ\b\.?", "PARQUE"), (r"\bPRQ\b\.?", "PARQUE"),
    (r"\bRES\b\.?", "RESIDENCIAL"), (r"\bRESID\b\.?", "RESIDENCIAL"),
    (r"\bCONJ\b\.?", "CONJUNTO"), (r"\bCJ\b\.?", "CONJUNTO"),
    (r"\bNUC\b\.?", "NUCLEO"), (r"\bHAB\b\.?", "HABITACIONAL"),
    (r"\bLOT\b\.?", "LOTEAMENTO"), (r"\bCH\b\.?", "CHACARA"),
    (r"\bSTA\b\.?", "SANTA"), (r"\bSTO\b\.?", "SANTO"), (r"\bS\.\s", "SAO "),
    (r"\bN\.?\s?S\.?\s", "NOSSA SENHORA "), (r"\bDR\b\.?", "DOUTOR"),
]


def norm_bairro(raw: str | None) -> str:
    """Padroniza nomes de bairro digitados de formas diferentes."""
    if not raw:
        return "NÃO INFORMADO"
    s = strip_accents(raw.upper()).strip()
    s = re.sub(r"^(BAIRRO|B\.)\s+", "", s)
    for pat, rep in ABREV:
        s = re.sub(pat, rep + " ", s)
    s = re.sub(r"[^A-Z0-9 ]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    if s in ("", "NULO", "NAO INFORMADO", "NI", "SEM BAIRRO"):
        return "NÃO INFORMADO"
    return s


def title_pt(s: str) -> str:
    keep_lower = {"DE", "DA", "DO", "DAS", "DOS", "E"}
    out = []
    for i, w in enumerate(s.split()):
        out.append(w.lower() if (i and w in keep_lower) else w.capitalize())
    return " ".join(out)


_SIGLAS_MAIUSC = {"PT", "PL", "PP", "PDT", "PSDB", "PSD", "MDB", "PSB", "PSOL", "PV", "PTB", "PSL", "PSC", "PCB", "PCO", "PSTU",
                  "UP", "DC", "PRD", "PMB", "PMN", "CG", "MS", "TV", "UFMS", "UEMS", "II", "III", "IV", "VI", "VII", "VIII", "IX", "XI"}


def nome_urna(s: str) -> str:
    """Nome de urna em caixa de título, mantendo siglas (ex.: 'ZECA DO PT' -> 'Zeca do PT')."""
    out = []
    for w in title_pt(s).split():
        bare = strip_accents(w).upper().strip(".")
        out.append(w.upper() if bare in _SIGLAS_MAIUSC else w)
    return " ".join(out)


def to_float(v: str | None) -> float | None:
    if v is None:
        return None
    v = v.strip().replace(",", ".")
    try:
        f = float(v)
    except ValueError:
        return None
    if f in (-1, 0) or abs(f) > 180:
        return None
    return round(f, 6)


def to_int(v: str | None) -> int:
    try:
        return int(str(v).strip())
    except (TypeError, ValueError):
        return 0


def pick(header: list[str], *names: str) -> str | None:
    for n in names:
        if n in header:
            return n
    return None


def find_zip(patterns: list[str]) -> Path | None:
    for p in patterns:
        hits = sorted(RAW.glob(p))
        if hits:
            return hits[0]
    return None


def iter_csv_from_zip(zpath: Path, name_hint: str, uf_filter: str | None):
    """Lê o CSV de dentro do ZIP (latin-1, ';') e devolve dicts.
    Se uf_filter for informado, descarta linhas de outras UFs antes de parsear."""
    with zipfile.ZipFile(zpath) as zf:
        names = [n for n in zf.namelist() if n.lower().endswith(".csv")]
        cand = [n for n in names if name_hint.lower() in n.lower()] or names
        # prefira o arquivo da UF, se houver um por UF
        uf_named = [n for n in cand if f"_{UF}.csv".lower() in n.lower()]
        member = (uf_named or cand)[0]
        log(f"   lendo {zpath.name} :: {member}")
        with zf.open(member) as fh:
            text = io.TextIOWrapper(fh, encoding="latin-1", newline="")
            header_line = text.readline()
            header = next(csv.reader([header_line], delimiter=";"))
            uf_token = f'"{uf_filter}"' if uf_filter else None
            for line in text:
                if uf_token and uf_token not in line:
                    continue
                row = next(csv.reader([line], delimiter=";"))
                if len(row) != len(header):
                    continue
                yield dict(zip(header, row))


# ------------------------------------------------------- cadastro de locais
def load_locais(ano: int) -> dict[tuple[str, str, str], dict]:
    """(municipio, zona, secao) -> dados do local de votação."""
    z = find_zip([f"eleitorado_local_votacao_{ano}*.zip", f"*local*votacao*{ano}*.zip"])
    if not z:
        log(f"   ! arquivo de locais de votação {ano} não encontrado em data/raw")
        return {}
    out: dict[tuple[str, str, str], dict] = {}
    header_checked = False
    for r in iter_csv_from_zip(z, "local_votacao", UF):
        if not header_checked:
            h = list(r.keys())
            c_turno = pick(h, "NR_TURNO")
            c_ano = pick(h, "AA_ELEICAO", "ANO_ELEICAO")
            c_mun = pick(h, "CD_MUNICIPIO")
            c_zona = pick(h, "NR_ZONA")
            c_sec = pick(h, "NR_SECAO")
            c_nrloc = pick(h, "NR_LOCAL_VOTACAO")
            c_nmloc = pick(h, "NM_LOCAL_VOTACAO")
            c_end = pick(h, "DS_ENDERECO", "DS_LOCAL_VOTACAO_ENDERECO")
            c_bai = pick(h, "NM_BAIRRO")
            c_lat = pick(h, "NR_LATITUDE")
            c_lon = pick(h, "NR_LONGITUDE")
            c_nmmun = pick(h, "NM_MUNICIPIO")
            c_eleit = pick(h, "QT_ELEITOR_SECAO", "QT_ELEITOR", "QT_ELEITORES")
            c_uf = pick(h, "SG_UF")
            missing = [n for n, c in [("CD_MUNICIPIO", c_mun), ("NR_ZONA", c_zona), ("NR_SECAO", c_sec)] if not c]
            if missing:
                raise SystemExit(f"Colunas ausentes no arquivo de locais {ano}: {missing}")
            header_checked = True
        if c_uf and r[c_uf] != UF:
            continue
        if c_ano and r[c_ano] and str(r[c_ano]) != str(ano):
            continue
        if c_turno and r[c_turno] not in ("1", "01", ""):
            continue
        key = (r[c_mun].lstrip("0"), r[c_zona].lstrip("0"), r[c_sec].lstrip("0"))
        out[key] = {
            "nr_local": r.get(c_nrloc, "") if c_nrloc else "",
            "nome": r.get(c_nmloc, "") if c_nmloc else "",
            "endereco": r.get(c_end, "") if c_end else "",
            "bairro_raw": r.get(c_bai, "") if c_bai else "",
            "municipio": r.get(c_nmmun, "") if c_nmmun else "",
            "lat": to_float(r.get(c_lat)) if c_lat else None,
            "lon": to_float(r.get(c_lon)) if c_lon else None,
            "eleitores": to_int(r.get(c_eleit)) if c_eleit else 0,
        }
    log(f"   {len(out):,} seções com local de votação ({ano})")
    return out


# ------------------------------------------------------- candidatos (urna)
_URNA_CACHE: dict = {}


def load_urnas(ano: int, cargo: str, ue: str) -> tuple[dict, dict]:
    """Lê consulta_cand_<ano>.zip e devolve ({número: nome de urna}, {nº partido: sigla})
    para o cargo e a unidade eleitoral (código TSE do município ou 'MS')."""
    if ano not in _URNA_CACHE:
        z = find_zip([f"consulta_cand_{ano}*.zip"])
        rows = []
        if z:
            for r in iter_csv_from_zip(z, "consulta_cand", UF):
                rows.append(r)
            log(f"   {len(rows):,} candidaturas em {z.name}")
        else:
            log(f"   (sem consulta_cand_{ano}.zip: nomes de urna ficam em branco)")
        _URNA_CACHE[ano] = rows
    urnas, siglas = {}, {}
    for r in _URNA_CACHE[ano]:
        if r.get("SG_UF") != UF or r.get("CD_CARGO", "").lstrip("0") != cargo:
            continue
        if r.get("NR_TURNO", "1").lstrip("0") not in ("1", ""):
            continue
        if str(r.get("SG_UE", "")).lstrip("0") != str(ue).lstrip("0"):
            continue
        nr = r.get("NR_CANDIDATO", "").strip()
        nm = r.get("NM_URNA_CANDIDATO", "").strip()
        if nr and nm and nm not in ("#NULO#", "#NE#"):
            urnas[nr] = nm
        pn, sg = r.get("NR_PARTIDO", "").strip(), r.get("SG_PARTIDO", "").strip()
        if pn and sg and sg not in ("#NULO#", "#NE#"):
            siglas[pn] = sg
    return urnas, siglas


# --------------------------------------------------------- votação por seção
def build_dataset(ds: dict, locais_cache: dict) -> dict | None:
    ano = ds["ano"]
    z = find_zip([f"votacao_secao_{ano}_{UF}*.zip", f"votacao_secao_{ano}*.zip"])
    if not z:
        log(f"   ! votacao_secao_{ano}_{UF}.zip não encontrado — pulando {ds['id']}")
        return None
    if ano not in locais_cache:
        locais_cache[ano] = load_locais(ano)
    secao_local = locais_cache[ano]

    # acumuladores
    local_info: dict[str, dict] = {}
    votos = defaultdict(int)          # (local_id, nr_votavel) -> votos
    nomes: dict[str, str] = {}        # nr_votavel -> nome
    brancos = defaultdict(int)
    nulos = defaultdict(int)
    secoes_sem_local = 0
    secoes_vistas = set()

    first = True
    for r in iter_csv_from_zip(z, "votacao_secao", UF):
        if first:
            h = list(r.keys())
            c_cargo = pick(h, "CD_CARGO")
            c_turno = pick(h, "NR_TURNO")
            c_mun = pick(h, "CD_MUNICIPIO")
            c_nmmun = pick(h, "NM_MUNICIPIO")
            c_zona = pick(h, "NR_ZONA")
            c_sec = pick(h, "NR_SECAO")
            c_nr = pick(h, "NR_VOTAVEL")
            c_nm = pick(h, "NM_VOTAVEL")
            c_qt = pick(h, "QT_VOTOS")
            c_nrloc = pick(h, "NR_LOCAL_VOTACAO")
            c_nmloc = pick(h, "NM_LOCAL_VOTACAO")
            c_end = pick(h, "DS_LOCAL_VOTACAO_ENDERECO")
            c_tipo = pick(h, "CD_TIPO_ELEICAO")
            first = False
        if r[c_cargo].lstrip("0") != ds["cargo"]:
            continue
        if c_turno and r[c_turno].lstrip("0") not in ("1", ""):
            continue
        if c_tipo and r[c_tipo] not in ("2", "", "0"):  # 2 = eleição ordinária
            continue
        mun = r[c_mun].lstrip("0")
        if ds["municipio"] and mun != ds["municipio"]:
            continue
        zona, sec = r[c_zona].lstrip("0"), r[c_sec].lstrip("0")
        loc = secao_local.get((mun, zona, sec))
        nr_local = (loc or {}).get("nr_local") or (r.get(c_nrloc, "") if c_nrloc else "") or f"S{sec}"
        lid = f"{mun}-{zona}-{nr_local.lstrip('0')}"
        if (mun, zona, sec) not in secoes_vistas:
            secoes_vistas.add((mun, zona, sec))
            if not loc:
                secoes_sem_local += 1
            info = local_info.get(lid)
            if not info:
                info = local_info[lid] = {
                    "nome": (loc or {}).get("nome") or (r.get(c_nmloc, "") if c_nmloc else "") or f"Seção {sec}",
                    "endereco": (loc or {}).get("endereco") or (r.get(c_end, "") if c_end else ""),
                    "bairro": norm_bairro((loc or {}).get("bairro_raw")),
                    "bairro_raw": (loc or {}).get("bairro_raw") or "",
                    "municipio": (loc or {}).get("municipio") or r.get(c_nmmun, ""),
                    "lat": (loc or {}).get("lat"),
                    "lon": (loc or {}).get("lon"),
                    "eleitores": 0,
                    "secoes": 0,
                }
            info["eleitores"] += (loc or {}).get("eleitores", 0)
            info["secoes"] += 1
        nr = r[c_nr].strip()
        q = to_int(r[c_qt])
        if nr == "95":
            brancos[lid] += q
        elif nr in ("96", "97"):
            nulos[lid] += q
        else:
            votos[(lid, nr)] += q
            nomes.setdefault(nr, r[c_nm].strip() if c_nm else nr)

    if not local_info:
        log(f"   ! nenhum voto encontrado para {ds['id']} (cargo {ds['cargo']})")
        return None

    # índices estáveis
    lids = sorted(local_info, key=lambda k: (local_info[k]["municipio"], local_info[k]["bairro"], local_info[k]["nome"]))
    lidx = {k: i for i, k in enumerate(lids)}

    por_local = defaultdict(list)
    por_cand = defaultdict(list)
    tot_cand = defaultdict(int)
    validos_local = defaultdict(int)
    for (lid, nr), q in votos.items():
        if q <= 0:
            continue
        por_local[lid].append((nr, q))
        por_cand[nr].append((lidx[lid], q))
        tot_cand[nr] += q
        validos_local[lid] += q

    # partidos: votos de legenda (2 dígitos) dão o nome/sigla do partido
    partidos_nome = {nr: nm for nr, nm in nomes.items() if len(nr) == 2}
    tot_partido = defaultdict(int)
    for nr, q in tot_cand.items():
        tot_partido[nr[:2]] += q

    # nome de urna e sigla do partido (arquivo consulta_cand do TSE, quando disponível)
    urnas, siglas = load_urnas(ano, ds["cargo"], ds["municipio"] or UF)
    for nr, sg in siglas.items():
        partidos_nome[nr] = sg

    candidatos = sorted(
        ([nr, title_pt(nomes[nr]) if len(nr) > 2 else f"Legenda {partidos_nome.get(nr, nr)}", nr[:2], tot_cand[nr],
          nome_urna(urnas[nr]) if nr in urnas else ""]
         for nr in tot_cand),
        key=lambda x: -x[3],
    )
    partidos = sorted(([nr, partidos_nome.get(nr, nr), q] for nr, q in tot_partido.items()), key=lambda x: -x[2])

    locais_out = []
    cg_info = {}
    for lid in lids:
        i = local_info[lid]
        top = sorted(por_local[lid], key=lambda x: -x[1])[:10]
        bo, reg = cg_bairro_regiao(i) if title_pt(i["municipio"]) == CAPITAL_NOME else (agrupa_bairro_interior(i["bairro"], i.get("bairro_raw", "")), "")
        cg_info[lid] = (bo, reg)
        locais_out.append([
            lid, title_pt(i["nome"]), title_pt(i["endereco"]), i["bairro"], title_pt(i["municipio"]),
            i["lat"], i["lon"], i["eleitores"], i["secoes"],
            validos_local[lid], brancos[lid], nulos[lid],
            [[nr, q] for nr, q in top],
            bo, reg,
        ])

    # Campo Grande: agregados por bairro oficial e por região urbana
    # (bairros agrupados de todos os municípios; regiões urbanas só da capital)
    cg_grupos = {}
    for nivel, pos in (("bairro", 0), ("regiao", 1)):
        g = defaultdict(lambda: {"locais": [], "validos": 0, "eleitores": 0, "cand": defaultdict(int), "r": "", "m": ""})
        for lid in lids:
            if not cg_info[lid][0]:
                continue
            mun = title_pt(local_info[lid]["municipio"])
            if nivel == "regiao" and mun != CAPITAL_NOME:
                continue
            x = g[(mun, cg_info[lid][pos])]
            x["r"] = cg_info[lid][1]; x["m"] = mun
            x["locais"].append(lidx[lid]); x["validos"] += validos_local[lid]; x["eleitores"] += local_info[lid]["eleitores"]
            for nr, q in por_local[lid]:
                x["cand"][nr] += q
        cg_grupos[nivel] = [{"m": x["m"], "b": k[1], "r": x["r"], "l": x["locais"], "v": x["validos"], "e": x["eleitores"],
                             "top": [[nr, q] for nr, q in sorted(x["cand"].items(), key=lambda t: -t[1])[:20]]}
                            for k, x in sorted(g.items())]

    # bairros
    bairros = defaultdict(lambda: {"locais": [], "validos": 0, "eleitores": 0, "cand": defaultdict(int)})
    for lid in lids:
        i = local_info[lid]
        b = bairros[(title_pt(i["municipio"]), i["bairro"])]
        b["locais"].append(lidx[lid])
        b["validos"] += validos_local[lid]
        b["eleitores"] += i["eleitores"]
        for nr, q in por_local[lid]:
            b["cand"][nr] += q
    bairros_out = []
    for (m, bn), b in sorted(bairros.items()):
        top = sorted(b["cand"].items(), key=lambda x: -x[1])[:20]
        bairros_out.append({"m": m, "b": bn, "l": b["locais"], "v": b["validos"], "e": b["eleitores"],
                            "top": [[nr, q] for nr, q in top]})

    # totais por município (ranking completo quando o portal filtra um município)
    mun_cand = defaultdict(lambda: defaultdict(int))
    for lid in lids:
        m = title_pt(local_info[lid]["municipio"])
        for nr, q in por_local[lid]:
            mun_cand[m][nr] += q
    municipios_out = {m: sorted(([nr, q] for nr, q in c.items()), key=lambda x: -x[1]) for m, c in sorted(mun_cand.items())}

    # grava
    dest = OUT / ds["id"]
    if dest.exists():
        shutil.rmtree(dest)
    (dest / "cand").mkdir(parents=True)
    dump = lambda p, o: (dest / p).write_text(json.dumps(o, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    dump("locais.json", locais_out)
    dump("candidatos.json", candidatos)
    dump("partidos.json", partidos)
    dump("bairros.json", bairros_out)
    dump("municipios.json", municipios_out)
    dump("cg_grupos.json", cg_grupos)
    for nr, rows in por_cand.items():
        dump(f"cand/{nr}.json", sorted(rows, key=lambda x: -x[1]))

    meta = {
        "id": ds["id"], "titulo": ds["titulo"], "ano": ano, "cargo": ds["cargo"],
        "locais": len(locais_out),
        "locais_sem_coord": sum(1 for l in locais_out if l[5] is None),
        "secoes": len(secoes_vistas), "secoes_sem_local": secoes_sem_local,
        "votos_validos": sum(validos_local.values()),
        "votos_nominais": sum(q for nr, q in tot_cand.items() if len(nr) > 2),
        "votos_legenda": sum(q for nr, q in tot_cand.items() if len(nr) == 2),
        "brancos": sum(brancos.values()), "nulos": sum(nulos.values()),
        "candidatos": sum(1 for c in candidatos if len(c[0]) > 2),
        "bairros": len(bairros_out),
    }
    dump("meta.json", meta)
    log(f"   ✓ {ds['id']}: {meta['locais']} locais, {meta['candidatos']} candidatos, "
        f"{meta['votos_validos']:,} votos válidos, {meta['locais_sem_coord']} locais sem coordenada")
    return meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", help="ids de conjunto a processar")
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    cache: dict = {}
    metas = []
    for ds in DATASETS:
        if args.only and ds["id"] not in args.only:
            continue
        log(f"→ {ds['id']}")
        m = build_dataset(ds, cache)
        if m:
            metas.append(m)
    # índice: mantém conjuntos já gerados antes
    idx_path = OUT / "datasets.json"
    existing = {m["id"]: m for m in json.loads(idx_path.read_text("utf-8"))} if idx_path.exists() else {}
    for m in metas:
        existing[m["id"]] = m
    order = [d["id"] for d in DATASETS]
    final = [existing[i] for i in order if i in existing and (OUT / i / "meta.json").exists()]
    idx_path.write_text(json.dumps(final, ensure_ascii=False, indent=1), encoding="utf-8")
    log(f"datasets.json: {[m['id'] for m in final]}")
    if not final:
        sys.exit("Nenhum conjunto gerado — confira os arquivos em data/raw.")


if __name__ == "__main__":
    main()
