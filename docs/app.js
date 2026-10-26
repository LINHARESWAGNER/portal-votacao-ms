/* Portal de Votação MS — lê os JSON gerados por pipeline/build.py */
(() => {
  "use strict";

  // índices do array de locais (ver build.py)
  const L = { ID: 0, NOME: 1, END: 2, BAIRRO: 3, MUN: 4, LAT: 5, LON: 6, ELEIT: 7, SECOES: 8, VALIDOS: 9, BRANCOS: 10, NULOS: 11, TOP: 12, BO: 13, REG: 14 };
  const TODOS = "__todos__";
  const CAPITAL = "Campo Grande";
  const COLORS = ["#2563eb", "#dc2626", "#059669", "#9333ea"];
  const MAX_SERIES = 4;
  const CHART_MAX = 30;

  const $ = (s) => document.querySelector(s);
  const fmt = new Intl.NumberFormat("pt-BR");
  const pct = (a, b) => (b ? (100 * a / b) : 0);
  const fmtPct = (x) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
  const fmtDelta = (x) => (x > 0 ? "+" : "") + fmt.format(x);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normName = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  const shortName = (s) => { const p = s.split(" "); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : s; };
  const coordKey = (l) => (l[L.LAT] == null ? null : l[L.LAT].toFixed(4) + "," + l[L.LON].toFixed(4));

  // o TSE grava o nome do partido por extenso e com grafias variadas; mostra a sigla
  const SIGLAS = [
    ["RENOVADOR TRABALHISTA", "PRTB"], ["DEMOCRATICO TRABALHISTA", "PDT"], ["TRABALHISTA BRASILEIRO", "PTB"],
    ["SOCIAL DEMOCRACIA", "PSDB"], ["SOCIAL DEMOCRATICO", "PSD"], ["DOS TRABALHADORES", "PT"],
    ["MOVIMENTO DEMOCRATICO", "MDB"], ["PARTIDO LIBERAL", "PL"], ["PROGRESSISTAS", "PP"], ["UNIAO BRASIL", "UNIÃO"],
    ["REPUBLICANO DA ORDEM", "PROS"], ["REPUBLICANOS", "REPUBLICANOS"], ["PODEMOS", "PODE"], ["PATRIOTA", "PATRIOTA"],
    ["SOCIALISTA BRASILEIRO", "PSB"], ["SOCIALISMO E LIBERDADE", "PSOL"], ["SOLIDARIEDADE", "SOLIDARIEDADE"],
    ["REDE SUSTENTABILIDADE", "REDE"], ["CIDADANIA", "CIDADANIA"], ["PARTIDO VERDE", "PV"], ["AVANTE", "AVANTE"],
    ["AGIR", "AGIR"], ["COMUNISTA DO BRASIL", "PCdoB"], ["DEMOCRACIA CRISTA", "DC"], ["PARTIDO NOVO", "NOVO"],
    ["CAUSA OPERARIA", "PCO"], ["RENOVACAO DEMOCRATICA", "PRD"], ["MISSAO", "MISSÃO"], ["DEMOCRATAS", "DEM"],
    ["SOCIAL LIBERAL", "PSL"], ["SOCIAL CRISTAO", "PSC"], ["MOBILIZACAO NACIONAL", "PMN"], ["MULHER BRASILEIRA", "PMB"],
    ["UNIDADE POPULAR", "UP"], ["SOCIALISTA DOS TRABALHADORES", "PSTU"], ["COMUNISTA BRASILEIRO", "PCB"],
  ];
  const sigla = (nome) => { const n = normName(nome); const hit = SIGLAS.find(([k]) => n.includes(k)); return hit ? hit[1] : nome; };

  const state = {
    datasets: [], cache: new Map(), active: null,
    series: [],                 // [{ds, nr, color, ord, votes: Map(localIdx -> votos)}] — sempre em ordem cronológica
    seq: 0,
    persons: new Map(),         // nome normalizado -> [{ds, nr, v}]
    geo: { bairro: null, regiao: null },
    scope: "estado", level: "bairros", levelCap: "regioes", mun: TODOS, partido: TODOS, busca: "",
    metric: "v",
    detail: null,               // linha aberta (ranking de um bairro/região/cidade/local)
    sort: { key: null, dir: -1 }, rows: [], cols: [], units: [],
  };

  // ------------------------------------------------------------------ mapa
  // mapa preso a Mato Grosso do Sul (limites reais aplicados quando o contorno do estado carrega)
  const MS_BOUNDS = window.L.latLngBounds([-24.2, -58.3], [-17.0, -50.8]);
  const map = window.L.map("map", { maxBounds: MS_BOUNDS.pad(0.08), maxBoundsViscosity: 1.0, minZoom: 5 }).fitBounds(MS_BOUNDS);
  map.createPane("mascara"); map.getPane("mascara").style.zIndex = 350; map.getPane("mascara").style.pointerEvents = "none";
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const layer = window.L.layerGroup().addTo(map);
  const svgRenderer = window.L.svg();   // polígonos em SVG (dica ao passar o mouse funciona melhor)

  const ramp = (t) => {
    const a = [253, 231, 214], b = [194, 65, 12];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t)))).join(",")})`;
  };

  // ------------------------------------------------------------------ dados
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function ds(id) {
    if (state.cache.has(id)) return state.cache.get(id);
    const base = `data/${id}/`;
    const [locais, candidatos, partidos, bairros, municipios] = await Promise.all(
      ["locais", "candidatos", "partidos", "bairros", "municipios"].map((n) => getJSON(base + n + ".json")));
    const cg = await getJSON(base + "cg_grupos.json").catch(() => ({ bairro: [], regiao: [] }));
    const D = {
      id, meta: state.datasets.find((d) => d.id === id), locais, candidatos, partidos, bairros, municipios,
      cg: { bairro: new Map(cg.bairro.map((x) => [x.b, x])), regiao: new Map(cg.regiao.map((x) => [x.b, x])) },
      candByNr: new Map(candidatos.map((c) => [c[0], c])),
      partidoNome: new Map(partidos.map((p) => [p[0], sigla(p[1])])),
      bairroIdx: new Map(bairros.map((b, i) => [b.m + "|" + b.b, i])),
      votes: new Map(),
    };
    state.cache.set(id, D);
    return D;
  }
  const D = (id) => state.cache.get(id);
  const A = () => D(state.active);
  const meta = (id) => state.datasets.find((d) => d.id === id) || {};
  const label = (id) => (meta(id).titulo || id).split(" · ")[0];
  const yearOf = (id) => +meta(id).ano || 0;

  async function candVotes(dsId, nr) {
    const d = await ds(dsId);
    if (!d.votes.has(nr)) d.votes.set(nr, new Map(await getJSON(`data/${dsId}/cand/${nr}.json`)));
    return d.votes.get(nr);
  }

  async function init() {
    try { state.datasets = await getJSON("data/datasets.json"); }
    catch (e) { loading("Sem dados ainda. Rode pipeline/build.py e sirva a pasta docs/ por um servidor HTTP."); return; }
    if (!state.datasets.length) { loading("Nenhum conjunto de dados gerado ainda."); return; }
    setTopHeight();

    $("#tabs").innerHTML = state.datasets.map((d) => `<button data-id="${d.id}" aria-pressed="false">${esc(d.titulo)}</button>`).join("");

    // contornos de Campo Grande (bairros oficiais e regiões)
    const geo = await Promise.all(["cg_bairros", "cg_regioes", "ms"].map((n) => getJSON(`data/geo/${n}.geojson`).catch(() => null)));
    state.geo.bairro = geo[0]; state.geo.regiao = geo[1];
    if (geo[2]) maskOutsideMS(geo[2]);

    // índice de pessoas entre eleições (pelo nome completo)
    await Promise.all(state.datasets.map(async (m) => {
      const cands = await getJSON(`data/${m.id}/candidatos.json`);
      cands.forEach(([nr, nome, , v]) => {
        if (nr.length <= 2) return;
        const k = normName(nome);
        if (!state.persons.has(k)) state.persons.set(k, []);
        state.persons.get(k).push({ ds: m.id, nr, v });
      });
    }));

    const h = new URLSearchParams(location.hash.slice(1));
    if (["estado", "capital", "interior"].includes(h.get("g"))) state.scope = h.get("g");
    if (["bairros", "cidades", "locais"].includes(h.get("n"))) state.level = h.get("n");
    const nc = h.get("nc") === "tse" ? "locais" : h.get("nc");
    if (["regioes", "bairros", "locais"].includes(nc)) state.levelCap = nc;
    if (["v", "p"].includes(h.get("m"))) state.metric = h.get("m");
    const start = state.datasets.find((d) => d.id === h.get("e")) || state.datasets[0];
    await setActive(start.id, false);
    const ser = (h.get("s") || "").split(",").filter(Boolean).map((x) => x.split(":"));
    for (const [d, nr] of ser.slice(0, MAX_SERIES)) {
      if (state.datasets.some((m) => m.id === d)) { try { await addSeries(d, nr, false); } catch (e) { /* ignora */ } }
    }
    renderAll(true);
  }

  // escurece tudo fora de MS e trava o mapa no estado
  function maskOutsideMS(fc) {
    const ring = fc.features[0].geometry.coordinates[0].map(([x, y]) => [y, x]);
    const world = [[-89, -179], [-89, 179], [89, 179], [89, -179]];
    const dark = matchMedia("(prefers-color-scheme: dark)").matches;
    window.L.polygon([world, ring], { pane: "mascara", stroke: false, fillColor: dark ? "#111513" : "#f4f5f2", fillOpacity: 0.82, interactive: false }).addTo(map);
    window.L.polygon(ring, { pane: "mascara", color: dark ? "#9aa49f" : "#1b1f1d", weight: 1.6, opacity: 0.8, fill: false, interactive: false }).addTo(map);
    const b = window.L.latLngBounds(ring);
    state.msBounds = b;
    map.setMaxBounds(b.pad(0.06));
    map.setMinZoom(Math.max(4, map.getBoundsZoom(b, false) - 0));
  }

  function setTopHeight() {
    document.documentElement.style.setProperty("--top-h", $(".top").offsetHeight + "px");
  }
  window.addEventListener("resize", setTopHeight);

  async function setActive(id, render = true) {
    loading("Carregando…");
    await ds(id);
    state.active = id; state.mun = TODOS; state.partido = TODOS; state.busca = ""; state.detail = null;
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === id)));
    $("#fPartido").innerHTML = `<option value="${TODOS}">Todos</option>` +
      A().partidos.map((p) => `<option value="${p[0]}">${esc(sigla(p[1]))} (${p[0]})</option>`).join("");
    $("#fBusca").value = "";
    loading(null);
    if (render) renderAll(true);
  }

  function loading(msg) { const el = $("#loading"); el.hidden = !msg; if (msg) el.textContent = msg; }
  let toastT;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4000); }

  // ------------------------------------------------------------ recorte
  const onlyCapital = (d) => Object.keys(d.municipios).length === 1 && d.municipios[CAPITAL];
  const involved = () => (state.series.length ? [...new Set(state.series.map((s) => s.ds))] : [state.active]);
  const capView = () => state.scope === "capital" || state.mun === CAPITAL;
  const LEVELS_CAP = [["regioes", "Regiões"], ["bairros", "Bairros"], ["locais", "Locais de votação"]];
  const LEVELS_EST = [["cidades", "Cidades"], ["bairros", "Bairros"], ["locais", "Locais de votação"]];
  function effLevel() {
    if (capView()) return state.levelCap;
    if (state.mun !== TODOS && state.level === "cidades") return "bairros";
    return state.level;
  }
  const LVLNAME = { regioes: "Regiões", bairros: "Bairros", locais: "Locais de votação", cidades: "Cidades" };

  // unidade (linha do resumo / forma no mapa) de um local, conforme o nível
  function unitOf(l, lvl) {
    const m = l[L.MUN], cg = m === CAPITAL && l[L.BO];
    if (lvl === "cidades") return { k: m, m, b: "", g: "cidade" };
    if (lvl === "regioes") return cg ? { k: "R|" + l[L.REG], m, b: l[L.REG], g: "regiao" } : { k: m, m, b: "", g: "cidade" };
    if (lvl === "locais") {
      const ck = coordKey(l);
      return { k: "L|" + (ck || l[L.ID]), m, b: l[L.NOME], bb: l[L.BO] || l[L.BAIRRO], g: "local" };
    }
    if (cg) return { k: "B|" + l[L.BO], m, b: l[L.BO], r: l[L.REG], g: "bairro" };
    return { k: m + "|" + l[L.BAIRRO], m, b: l[L.BAIRRO], g: "tse" };
  }
  // ranking de candidatos de uma unidade, na eleição ativa
  function unitTop(d, u) {
    if (u.g === "cidade") return d.municipios[u.m] || [];
    if (u.g === "regiao" || u.g === "bairro") return d.cg[u.g].get(u.b)?.top || [];
    if (u.g === "local") { const ref = u.locs.find(([id]) => id === d.id); return ref ? d.locais[ref[1]][L.TOP] : []; }
    return d.bairros[d.bairroIdx.get(u.m + "|" + u.b)]?.top || [];
  }
  function munIn(m) {
    if (state.mun !== TODOS) return m === state.mun;
    if (state.scope === "capital") return m === CAPITAL;
    if (state.scope === "interior") return m !== CAPITAL;
    return true;
  }

  function rankActive() {
    const d = A();
    if (state.mun !== TODOS) return d.municipios[state.mun] || [];
    if (state.scope === "capital") return d.municipios[CAPITAL] || [];
    const tot = d.candidatos.map((c) => [c[0], c[3]]);
    if (state.scope === "estado") return tot;
    const cap = new Map(d.municipios[CAPITAL] || []);
    return tot.map(([nr, v]) => [nr, v - (cap.get(nr) || 0)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]);
  }

  function seriesTotal(s) {
    const d = D(s.ds); let v = 0;
    s.votes.forEach((q, i) => { if (munIn(d.locais[i][L.MUN])) v += q; });
    return v;
  }
  const seriesName = (s) => D(s.ds).candByNr.get(s.nr)?.[1] || s.nr;

  // ---------------------------------------------------------- comparação
  function sortSeries() {
    // ordem cronológica (ano menor primeiro); na mesma eleição, a ordem em que foram adicionados
    state.series.sort((a, b) => yearOf(a.ds) - yearOf(b.ds) || a.ord - b.ord);
  }
  function deltaLabel() {
    const [a, b] = state.series;
    const ya = yearOf(a.ds), yb = yearOf(b.ds);
    return ya !== yb ? `Δ votos (${yb} − ${ya})` : "Δ votos (2º − 1º)";
  }

  async function addSeries(dsId, nr, render = true) {
    const ix = state.series.findIndex((s) => s.ds === dsId && s.nr === nr);
    if (ix >= 0) { state.series.splice(ix, 1); if (render) renderAll(false); return; }
    if (state.series.length >= MAX_SERIES) { toast(`Máximo de ${MAX_SERIES} candidatos na comparação. Remova um para adicionar outro.`); return; }
    loading("Carregando votos…");
    const votes = await candVotes(dsId, nr);
    const used = new Set(state.series.map((s) => s.color));
    state.series.push({ ds: dsId, nr, color: COLORS.find((c) => !used.has(c)), ord: state.seq++, votes });
    sortSeries();
    loading(null);
    // vereador cobre só a capital: comparado a deputado, o recorte comum é Campo Grande
    const ids = involved();
    if (render && state.scope === "estado" && ids.some((id) => onlyCapital(D(id))) && ids.some((id) => !onlyCapital(D(id)))) {
      state.scope = "capital"; state.mun = TODOS;
      toast("Recorte ajustado para Campo Grande, a área que as duas eleições têm em comum. Troque para Estado se quiser.");
    }
    state.detail = null; state.sort = { key: null, dir: -1 };
    if (render) renderAll(false);
  }

  // ------------------------------------------------------------- render
  function renderAll(fit) {
    renderControls(); renderKPIs(); renderChips(); renderCandList();
    state.units = buildUnits();
    drawMap(fit); renderTable(); renderChart(); updateHash();
  }

  function renderControls() {
    const a = A();
    const capOnly = involved().every((id) => onlyCapital(D(id)));
    if (capOnly && state.scope !== "capital") state.scope = "capital";
    document.querySelectorAll("#segScope button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.v === state.scope));
      b.disabled = capOnly && b.dataset.v !== "capital";
      b.title = b.disabled ? "Esta eleição cobre só Campo Grande" : "";
    });
    const lvl = effLevel();
    const opts = capView() ? LEVELS_CAP : LEVELS_EST;
    $("#segLevel").innerHTML = opts.map(([v, t]) => {
      const dis = !capView() && state.mun !== TODOS && v === "cidades";
      return `<button data-v="${v}" aria-pressed="${v === lvl}" ${dis ? "disabled" : ""}>${t}</button>`;
    }).join("");
    const muns = Object.keys(a.municipios).filter((m) => state.scope === "estado" || (state.scope === "capital" ? m === CAPITAL : m !== CAPITAL))
      .sort((x, y) => x.localeCompare(y, "pt-BR"));
    if (state.mun !== TODOS && !muns.includes(state.mun)) state.mun = TODOS;
    $("#fMun").innerHTML = (muns.length > 1 ? `<option value="${TODOS}">Todos (${muns.length})</option>` : "") +
      muns.map((m) => `<option ${m === state.mun ? "selected" : ""}>${esc(m)}</option>`).join("");
    $("#fMun").disabled = muns.length <= 1;
    document.querySelectorAll("#segMetric button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === state.metric)));
  }

  function renderKPIs() {
    let validos = 0, eleit = 0, nLoc = 0, bn = 0;
    A().locais.forEach((l) => {
      if (!munIn(l[L.MUN])) return;
      nLoc++; validos += l[L.VALIDOS]; eleit += l[L.ELEIT]; bn += l[L.BRANCOS] + l[L.NULOS];
    });
    const k = [[fmt.format(validos), "votos válidos"], [fmt.format(eleit), "eleitores aptos"],
      [fmt.format(nLoc), "locais de votação"], [fmt.format(bn), "brancos + nulos"]];
    $("#kpis").innerHTML = k.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join("");
  }

  function renderChips() {
    $("#cmpBlock").hidden = !state.series.length;
    $("#chips").innerHTML = state.series.map((s, si) => {
      const d = D(s.ds), c = d.candByNr.get(s.nr);
      const outras = c && s.nr.length > 2 ? (state.persons.get(normName(c[1])) || [])
        .filter((p) => !state.series.some((x) => x.ds === p.ds && x.nr === p.nr))
        .sort((x, y) => yearOf(x.ds) - yearOf(y.ds)) : [];
      return `<li class="chip" style="--c:${s.color}">
        <div class="chip-top"><span class="nm" title="${esc(c?.[1])}">${esc(c?.[1] || s.nr)}</span>
          <span class="v">${fmt.format(seriesTotal(s))}</span>
          <button class="x" data-rm="${si}" title="Remover">×</button></div>
        <div class="meta">${esc(label(s.ds))} · ${esc(s.nr)} · ${esc(d.partidoNome.get(c?.[2]) || c?.[2] || "")}</div>
        ${outras.length ? `<div class="outras">${outras.map((p) =>
          `<button data-add="${p.ds}:${p.nr}" title="Adicionar à comparação">+ ${esc(label(p.ds))} · ${fmt.format(p.v)}</button>`).join("")}</div>` : ""}
      </li>`;
    }).join("");
  }

  function renderCandList() {
    const a = A();
    const q = state.busca.trim().toLowerCase();
    const sel = new Map(state.series.filter((s) => s.ds === state.active).map((s) => [s.nr, s.color]));
    const items = rankActive().filter(([nr]) => {
      const c = a.candByNr.get(nr); if (!c) return false;
      if (state.partido !== TODOS && c[2] !== state.partido) return false;
      if (q && !(c[1].toLowerCase().includes(q) || nr.startsWith(q))) return false;
      return true;
    }).slice(0, 300);
    $("#listaCand").innerHTML = items.map(([nr, v], i) => {
      const c = a.candByNr.get(nr), sg = a.partidoNome.get(c[2]) || c[2];
      const col = sel.get(nr);
      return `<li data-nr="${nr}" class="${col ? "sel" : ""}" ${col ? `style="--c:${col}"` : ""}><span class="pos">${i + 1}</span>` +
        `<span class="nm" title="${esc(c[1])}">${col ? `<span class="dot" style="--c:${col}"></span> ` : ""}${esc(c[1])}<small>${esc(nr.length > 2 ? nr + " · " + sg : sg)}</small></span>` +
        `<span class="v">${fmt.format(v)}</span></li>`;
    }).join("") || `<li class="muted">Nenhum candidato neste recorte.</li>`;
  }

  // --------------------------------------------------------- unidades
  function buildUnits() {
    const lvl = effLevel(), units = new Map(), n = state.series.length;
    for (const id of involved()) {
      D(id).locais.forEach((l, i) => {
        if (!munIn(l[L.MUN])) return;
        const x = unitOf(l, lvl);
        let u = units.get(x.k);
        if (!u) units.set(x.k, u = { ...x, val: {}, el: {}, nl: {}, locs: [], v: new Array(n).fill(0), lat: 0, lon: 0, nc: 0 });
        u.val[id] = (u.val[id] || 0) + l[L.VALIDOS];
        u.el[id] = (u.el[id] || 0) + l[L.ELEIT];
        u.nl[id] = (u.nl[id] || 0) + 1;
        u.locs.push([id, i]);
        if (l[L.LAT] != null) { u.lat += l[L.LAT]; u.lon += l[L.LON]; u.nc++; }
      });
    }
    state.series.forEach((s, si) => {
      const d = D(s.ds);
      s.votes.forEach((q, i) => { const l = d.locais[i]; if (munIn(l[L.MUN])) units.get(unitOf(l, lvl).k).v[si] += q; });
    });
    const out = [...units.values()];
    out.forEach((u) => {
      if (u.nc) { u.lat /= u.nc; u.lon /= u.nc; } else u.lat = u.lon = null;
      u.sh = state.series.map((s, si) => (u.val[s.ds] != null ? pct(u.v[si], u.val[s.ds]) : null));
    });
    return out;
  }

  // ---------------------------------------------------------- mapa
  function unitStyle(u, ctx) {
    const n = state.series.length;
    if (!n) {
      const v = u.val[state.active] || 0;
      return { fill: "#0f6b4f", op: 0.15 + 0.6 * (v / ctx.maxV), size: v / ctx.maxV, any: v > 0 };
    }
    const top = Math.max(...u.v);
    if (!top) return { fill: "#9aa49f", op: 0.2, size: 0, any: false };
    if (n === 1) return { fill: ramp((u.sh[0] || 0) / ctx.maxShare), op: 0.8, size: top / ctx.maxV, any: true };
    // quem teve a maior % dos válidos na unidade (justo entre eleições diferentes); opacidade = folga sobre o 2º
    const order = u.sh.map((x, i) => [x ?? -1, i]).sort((a, b) => b[0] - a[0]);
    const [best, bi] = order[0], second = order[1] ? Math.max(0, order[1][0]) : 0;
    const margin = best > 0 ? (best - second) / best : 0;
    return { fill: state.series[bi].color, op: 0.35 + 0.5 * margin, size: top / ctx.maxV, any: true };
  }

  function drawMap(fit) {
    layer.clearLayers();
    const lvl = effLevel(), units = state.units, n = state.series.length, ll = [];
    const ctx = {
      maxV: Math.max(1, ...units.map((u) => (n ? Math.max(...u.v) : u.val[state.active] || 0))),
      maxShare: Math.max(0.0001, ...units.map((u) => u.sh[0] || 0)),
    };
    state.shareMax = ctx.maxShare;
    const fc = capView() && (lvl === "regioes" || lvl === "bairros") ? state.geo[lvl === "regioes" ? "regiao" : "bairro"] : null;
    const drawn = new Set(), llPoly = [];

    if (fc) {
      const byName = new Map(units.map((u) => [u.b, u]));
      window.L.geoJSON(fc, {
        renderer: svgRenderer,
        filter: (f) => byName.has(f.properties.nome),
        style: (f) => {
          const st = unitStyle(byName.get(f.properties.nome), ctx);
          return { color: "#1b1f1d", weight: 1.2, opacity: 0.7, fillColor: st.fill, fillOpacity: st.any ? st.op : 0.08 };
        },
        onEachFeature: (f, lyr) => {
          const u = byName.get(f.properties.nome); drawn.add(u.k);
          lyr.bindTooltip(() => tipHtml(u), { sticky: true, className: "tip", opacity: 1 });
          lyr.on("mouseover", () => lyr.setStyle({ weight: 3 }));
          lyr.on("mouseout", () => lyr.setStyle({ weight: 1.2 }));
          lyr.on("click", () => onUnit(u));
        },
      }).eachLayer((lyr) => { lyr.addTo(layer); const bb = lyr.getBounds(); llPoly.push(bb.getNorthEast(), bb.getSouthWest()); });
    }
    // bolhas: locais de votação, ou unidades sem contorno (cidades, bairros do interior, distritos…)
    units.forEach((u) => {
      if (drawn.has(u.k) || u.lat == null) return;
      const st = unitStyle(u, ctx);
      const r = lvl === "locais" ? 3 + 14 * Math.sqrt(st.size) : 5 + 22 * Math.sqrt(st.size);
      const mk = window.L.circleMarker([u.lat, u.lon], {
        renderer: svgRenderer, bubblingMouseEvents: false,
        radius: st.any ? r : 2.5, fillColor: st.fill, color: n ? "#333" : "#0b4f3a", weight: st.any ? 0.7 : 0,
        fillOpacity: st.any ? Math.max(st.op, n ? 0.75 : 0.55) : 0.35,
      });
      mk.bindTooltip(() => tipHtml(u), { sticky: true, className: "tip", opacity: 1 });
      mk.on("click", () => onUnit(u));
      mk.addTo(layer); ll.push([u.lat, u.lon]);
    });
    const fitTo = llPoly.length ? llPoly : ll;   // com contornos, enquadra a área urbana (distritos ficam fora do quadro)
    if (fit) {
      if (!capView() && state.mun === TODOS && state.msBounds) map.fitBounds(state.msBounds, { padding: [10, 10] });
      else if (fitTo.length) map.fitBounds(window.L.latLngBounds(fitTo), { padding: [24, 24], maxZoom: 14 });
    }
    renderLegend(fc);
  }

  function tipHtml(u) {
    const a = A(), n = state.series.length;
    let head, addr = "";
    if (u.g === "local") {
      const [id, i] = u.locs[0], l = D(id).locais[i];
      head = l[L.NOME];
      addr = `${esc(l[L.END])}<br>${esc(l[L.BO] ? `${l[L.BO]} · Região ${l[L.REG]}` : l[L.BAIRRO])} · ${esc(l[L.MUN])}`;
    } else if (u.g === "regiao") { head = "Região " + u.b; addr = esc(u.m); }
    else if (u.g === "bairro") { head = u.b; addr = `Região ${esc(u.r)} · ${esc(u.m)}`; }
    else if (u.g === "cidade") { head = u.m; }
    else { head = u.b; addr = esc(u.m); }
    const nl = u.nl[state.active] ?? Object.values(u.nl)[0] ?? 0;
    let body;
    if (n) {
      body = `<table>${state.series.map((s, si) => `<tr><td><span class="dot" style="--c:${s.color}"></span>${esc(shortName(seriesName(s)))}</td>` +
        `<td>${esc(label(s.ds))}</td><td class="n">${fmt.format(u.v[si])}</td><td class="n">${u.sh[si] != null ? fmtPct(u.sh[si]) : "—"}</td></tr>`).join("")}` +
        (n === 2 ? `<tr><td colspan="2"><b>${esc(deltaLabel())}</b></td><td class="n"><b>${fmtDelta(u.v[1] - u.v[0])}</b></td><td></td></tr>` : "") + `</table>`;
    } else {
      const val = u.val[state.active] || 0;
      body = `<table>${unitTop(a, u).slice(0, 6).map(([nr, v]) => `<tr><td>${esc(shortName(a.candByNr.get(nr)?.[1] || nr))}</td>` +
        `<td class="n">${fmt.format(v)}</td><td class="n">${fmtPct(pct(v, val))}</td></tr>`).join("")}</table>`;
    }
    const val = u.val[state.active] ?? Object.values(u.val)[0] ?? 0;
    return `<h3>${esc(head)}</h3>${addr ? `<div class="addr">${addr}</div>` : ""}` +
      `<div class="small" style="margin-bottom:4px">${u.g !== "local" ? fmt.format(nl) + " locais · " : ""}${fmt.format(val)} votos válidos</div>${body}`;
  }

  function renderLegend(fc) {
    const el = $("#legend"), n = state.series.length, lvl = effLevel();
    const unit = { regioes: "região", bairros: "bairro", locais: "local", cidades: "cidade" }[lvl];
    if (n === 1) {
      el.innerHTML = `<b>${esc(seriesName(state.series[0]))}</b><div class="bar"></div><div class="ends"><span>0%</span><span>${fmtPct(state.shareMax || 0)} dos válidos</span></div>` +
        `<div class="muted">Cor = % dos válidos em cada ${unit}${fc ? "" : " · tamanho = votos"}</div>`;
    } else if (n > 1) {
      el.innerHTML = `<b>Mais forte em cada ${unit}</b>` + state.series.map((s) =>
        `<div class="it"><span class="dot" style="--c:${s.color}"></span>${esc(shortName(seriesName(s)))} <span class="muted">· ${esc(label(s.ds))}</span></div>`).join("") +
        `<div class="muted">Cor = maior % dos válidos · cor mais forte = vantagem maior${fc ? "" : " · tamanho = votos"}</div>`;
    } else {
      el.innerHTML = `<b>${LVLNAME[lvl]}</b><div class="bar acc"></div><div class="muted">${fc ? "Cor" : "Tamanho"} = votos válidos. Passe o mouse para ver o ranking; clique para abrir na tabela.</div>`;
    }
  }

  function onUnit(u) {
    focus(u.locs);
    if (!state.series.length) { state.detail = { ...u }; renderTable(); renderChart(); }
  }

  // --------------------------------------------------------- resumo
  function renderTable() {
    const lvl = effLevel(), n = state.series.length, a = A();
    const showMun = lvl === "cidades" || (!capView() && state.mun === TODOS);
    const where = state.mun !== TODOS ? state.mun : { estado: "MS inteiro", capital: "Campo Grande", interior: "Interior" }[state.scope];
    const geoCols = lvl === "regioes" ? [["b", "Região"]]
      : lvl === "cidades" ? [["m", "Cidade"]]
      : lvl === "locais" ? [...(showMun ? [["m", "Município"]] : []), ["b", "Local de votação"], ["bb", "Bairro"]]
      : [...(showMun ? [["m", "Município"]] : []), ["b", "Bairro"], ...(capView() ? [["r", "Região"]] : [])];
    let cols, rows, titulo, sub, total = null;
    $("#voltar").hidden = !state.detail;

    if (state.detail) {
      const u = state.detail;
      const nome = u.g === "regiao" ? "Região " + u.b : u.g === "cidade" ? u.m : `${u.b} · ${u.m}`;
      titulo = nome;
      const val = u.val[state.active] || 0;
      sub = `${label(state.active)} · ${fmt.format(val)} votos válidos · clique num candidato para adicioná-lo à comparação`;
      cols = [["pos", "#", true], ["nome", "Candidato"], ["part", "Partido"], ["v", "Votos", true], ["p", "% válidos", true]];
      rows = unitTop(a, u).slice(0, 50).map(([nr, v], i) => {
        const c = a.candByNr.get(nr) || [nr, nr, nr.slice(0, 2)];
        return { pos: i + 1, nome: c[1], part: a.partidoNome.get(c[2]) || c[2], v, p: pct(v, val), _nr: nr, _lab: c[1] };
      });
    } else {
      const units = state.units;
      titulo = `${LVLNAME[lvl]} · ${where}`;
      if (!n) {
        sub = `${label(state.active)} · clique numa linha (ou no mapa) para ver o ranking completo`;
        cols = [...geoCols, ...(lvl !== "locais" ? [["nl", "Locais", true]] : []), ["e", "Eleitores", true], ["v", "Válidos", true], ["lider", "Mais votado"], ["lv", "Votos", true]];
        rows = units.map((u) => {
          const lead = unitTop(a, u)[0];
          const c = lead && a.candByNr.get(lead[0]);
          return { m: u.m, b: u.b, r: u.r || "", bb: u.bb || "", nl: u.nl[state.active] || 0, e: u.el[state.active] || 0, v: u.val[state.active] || 0,
            p: null, lider: c ? c[1] : "—", lv: lead ? lead[1] : 0, _u: u };
        });
        total = { nl: sum(rows, "nl"), e: sum(rows, "e"), v: sum(rows, "v"), lider: "", lv: null };
        const tv = total.v; rows.forEach((r) => { r.p = pct(r.v, tv); });
      } else {
        sub = (n === 1 ? "% = participação nos votos válidos de cada linha · % cand. = parte da votação total do candidato"
          : "% = participação nos votos válidos da eleição de cada candidato, na mesma linha") +
          (n === 2 ? ` · ${deltaLabel()} = eleição mais recente menos a mais antiga` : "") + " · colunas em ordem cronológica";
        cols = [...geoCols];
        const multiDs = involved().length > 1;
        state.series.forEach((s, si) => {
          const nm = shortName(seriesName(s));
          cols.push([`v${si}`, `<span class="dot" style="--c:${s.color}"></span>${esc(nm)}${multiDs ? esc(` · ${label(s.ds)}`) : ""}`, true, s.color]);
          cols.push([`p${si}`, "%", true, s.color]);
        });
        if (n === 1) cols.push(["pc", "% cand.", true]);
        if (n === 2) cols.push(["d", deltaLabel(), true]);
        const totS = state.series.map((s) => seriesTotal(s));
        rows = units.filter((u) => u.v.some((x) => x > 0)).map((u) => {
          const r = { m: u.m, b: u.b, r: u.r || "", bb: u.bb || "", _u: u };
          state.series.forEach((s, si) => { r[`v${si}`] = u.v[si]; r[`p${si}`] = u.sh[si]; });
          if (n === 1) r.pc = pct(u.v[0], totS[0]);
          if (n === 2) r.d = u.v[1] - u.v[0];
          return r;
        });
        total = {};
        state.series.forEach((s, si) => {
          total[`v${si}`] = totS[si];
          const vt = units.reduce((acc, u) => acc + (u.val[s.ds] || 0), 0);
          total[`p${si}`] = pct(totS[si], vt);
        });
        if (n === 1) total.pc = 100;
        if (n === 2) total.d = totS[1] - totS[0];
      }
      const k = state.sort.key && cols.some((c) => c[0] === state.sort.key) ? state.sort.key : (n ? "v0" : "v");
      const dir = state.sort.key ? state.sort.dir : -1;
      rows.sort((x, y) => {
        const a1 = x[k], b1 = y[k];
        if (typeof a1 === "number" || typeof b1 === "number") return ((a1 ?? -Infinity) - (b1 ?? -Infinity)) * dir;
        return String(a1).localeCompare(String(b1), "pt-BR") * dir;
      });
      rows.forEach((r) => { r._lab = lvl === "cidades" ? r.m : (showMun && lvl !== "regioes" ? `${r.b} (${r.m})` : r.b); });
    }
    if (!rows.length && !state.detail) sub = "Nada a mostrar neste recorte" + (involved().every((id) => onlyCapital(D(id))) ? " — esta eleição cobre só Campo Grande." : ".");

    if (total) { total._total = true; total[cols[0][0]] = "Total"; }
    state.rows = total ? [total, ...rows] : rows; state.cols = cols;
    $("#detTitulo").textContent = titulo;
    $("#detSub").textContent = sub;
    const maxP = {};
    cols.forEach(([key]) => { if (/^p\d?$/.test(key)) maxP[key] = Math.max(1, ...rows.map((r) => r[key] || 0)); });
    $("#tabela thead").innerHTML = "<tr>" + cols.map(([key, t, num]) => `<th data-k="${key}" class="${num ? "n" : ""}">${t}</th>`).join("") + "</tr>";
    $("#tabela tbody").innerHTML = state.rows.slice(0, 2500).map((r, ri) => `<tr data-ri="${ri}" class="${r._total ? "total" : ""}">` + cols.map(([key, , num, color]) => {
      let v = r[key];
      if (v == null) v = "";
      else if (/^p\d?$/.test(key)) v = (!r._total ? `<span class="pct-bar" style="width:${Math.round(28 * v / maxP[key])}px;${color ? `--c:${color}` : ""}"></span>` : "") + fmtPct(v);
      else if (key === "pc") v = fmtPct(v);
      else if (key === "d") return `<td class="n ${v > 0 ? "pos-d" : v < 0 ? "neg-d" : ""}">${fmtDelta(v)}</td>`;
      else if (num && typeof v === "number") v = fmt.format(v);
      else v = esc(v);
      return `<td class="${num ? "n" : ""}">${v}</td>`;
    }).join("") + "</tr>").join("");
  }
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

  // --------------------------------------------------------- gráfico
  let chart = null;
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function renderChart() {
    if (!window.Chart) { $("#chartSub").textContent = "Não foi possível carregar a biblioteca de gráficos."; return; }
    const rows = state.rows.filter((r) => !r._total).slice(0, CHART_MAX);
    const total = state.rows.filter((r) => !r._total).length;
    const n = state.series.length, m = state.metric;
    const labels = rows.map((r) => r._lab ?? r.b ?? r.m);
    let datasets;
    if (state.detail || !n) {
      const key = m === "p" ? "p" : "v";
      datasets = [{ label: state.detail ? (m === "p" ? "% dos válidos" : "Votos") : (m === "p" ? "% do total de válidos" : "Votos válidos"),
        data: rows.map((r) => r[key] ?? 0), backgroundColor: cssVar("--accent") || "#0f6b4f", borderRadius: 3 }];
    } else {
      datasets = state.series.map((s, si) => ({
        label: `${shortName(seriesName(s))}${involved().length > 1 ? " · " + label(s.ds) : ""}`,
        data: rows.map((r) => r[(m === "p" ? "p" : "v") + si] ?? 0), backgroundColor: s.color, borderRadius: 3,
      }));
    }
    $("#chartTitulo").textContent = "Gráfico · " + $("#detTitulo").textContent;
    $("#chartSub").textContent = total > CHART_MAX
      ? `Mostrando as ${CHART_MAX} primeiras linhas, na ordem da tabela (clique no cabeçalho da tabela para mudar a ordem).`
      : "Mesmas linhas e ordem da tabela.";
    const ink = cssVar("--muted") || "#66706b", grid = cssVar("--line") || "#e2e5e0";
    const cfg = {
      type: "bar",
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false, animation: { duration: 250 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: datasets.length > 1, labels: { color: ink, boxWidth: 12 } },
          tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${m === "p" ? fmtPct(c.parsed.y) : fmt.format(c.parsed.y)}` } },
        },
        scales: {
          x: { ticks: { color: ink, autoSkip: false, maxRotation: 60, minRotation: 0, font: { size: 11 },
            callback: function (v) { const s = this.getLabelForValue(v); return s.length > 22 ? s.slice(0, 21) + "…" : s; } }, grid: { display: false } },
          y: { beginAtZero: true, ticks: { color: ink, callback: (v) => (m === "p" ? v + "%" : fmt.format(v)) }, grid: { color: grid } },
        },
      },
    };
    if (chart) chart.destroy();
    chart = new window.Chart($("#chart"), cfg);
  }

  // -------------------------------------------------------------- ações
  function focus(locs) {
    const ll = locs.map(([id, i]) => D(id).locais[i]).filter((l) => l[L.LAT] != null).map((l) => [l[L.LAT], l[L.LON]]);
    if (ll.length) map.fitBounds(ll, { padding: [40, 40], maxZoom: 16 });
  }

  function updateHash() {
    const p = new URLSearchParams();
    p.set("e", state.active);
    if (state.series.length) p.set("s", state.series.map((s) => `${s.ds}:${s.nr}`).join(","));
    if (state.scope !== "estado") p.set("g", state.scope);
    if (state.level !== "bairros") p.set("n", state.level);
    if (state.levelCap !== "regioes") p.set("nc", state.levelCap);
    if (state.metric !== "v") p.set("m", state.metric);
    history.replaceState(null, "", "#" + p.toString());
  }

  function exportCSV() {
    const strip = (h) => h.replace(/<[^>]+>/g, "");
    const lines = [state.cols.map((c) => strip(c[1])), ...state.rows.map((r) => state.cols.map(([k]) => {
      const v = r[k];
      return typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : v ?? "";
    }))].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `votacao_${state.active}_${state.scope}_${effLevel()}${state.series.length ? "_comparacao" : ""}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------- eventos
  $("#tabs").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b && b.dataset.id !== state.active) setActive(b.dataset.id); });
  $("#listaCand").addEventListener("click", (e) => { const li = e.target.closest("li[data-nr]"); if (li) addSeries(state.active, li.dataset.nr); });
  $("#chips").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"), ad = e.target.closest("[data-add]");
    if (rm) { state.series.splice(+rm.dataset.rm, 1); renderAll(false); }
    else if (ad) { const [d, nr] = ad.dataset.add.split(":"); ds(d).then(() => addSeries(d, nr)); }
  });
  $("#limpar").addEventListener("click", () => { state.series = []; renderAll(false); });
  $("#fBusca").addEventListener("input", (e) => { state.busca = e.target.value; renderCandList(); });
  $("#fPartido").addEventListener("change", (e) => { state.partido = e.target.value; renderCandList(); });
  $("#fMun").addEventListener("change", (e) => { state.mun = e.target.value; state.detail = null; renderAll(true); });
  $("#segScope").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    state.scope = b.dataset.v; state.mun = TODOS; state.detail = null; state.sort = { key: null, dir: -1 }; renderAll(true);
  });
  $("#segLevel").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    if (capView()) state.levelCap = b.dataset.v; else state.level = b.dataset.v;
    state.detail = null; state.sort = { key: null, dir: -1 }; renderAll(true);
  });
  $("#segMetric").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    state.metric = b.dataset.v; renderControls(); renderChart(); updateHash();
  });
  $("#voltar").addEventListener("click", () => { state.detail = null; renderTable(); renderChart(); });
  $("#csv").addEventListener("click", exportCSV);
  $("#tabela thead").addEventListener("click", (e) => {
    const th = e.target.closest("th"); if (!th || state.detail) return;
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (th.classList.contains("n") ? -1 : 1) };
    renderTable(); renderChart();
  });
  $("#tabela tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const r = state.rows[+tr.dataset.ri]; if (!r) return;
    if (r._nr) { addSeries(state.active, r._nr); return; }
    if (r._u) onUnit(r._u);
  });

  init();
})();
