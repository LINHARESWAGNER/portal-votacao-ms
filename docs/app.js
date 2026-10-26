/* Portal de Votação MS — lê os JSON gerados por pipeline/build.py */
(() => {
  "use strict";

  // índices do array de locais (ver build.py)
  const L = { ID: 0, NOME: 1, END: 2, BAIRRO: 3, MUN: 4, LAT: 5, LON: 6, ELEIT: 7, SECOES: 8, VALIDOS: 9, BRANCOS: 10, NULOS: 11, TOP: 12 };
  const TODOS = "__todos__";
  const CAPITAL = "Campo Grande";
  const COLORS = ["#2563eb", "#dc2626", "#059669", "#9333ea"];
  const MAX_SERIES = 4;

  const $ = (s) => document.querySelector(s);
  const fmt = new Intl.NumberFormat("pt-BR");
  const pct = (a, b) => (b ? (100 * a / b) : 0);
  const fmtPct = (x) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
  const fmtDelta = (x) => (x > 0 ? "+" : "") + fmt.format(x);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normName = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z ]/g, " ").replace(/\s+/g, " ").trim();
  const shortName = (s) => { const p = s.split(" "); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : s; };

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
    series: [],                 // [{ds, nr, color, votes: Map(localIdx -> votos)}]
    persons: new Map(),         // nome normalizado -> [{ds, nr, v}]
    scope: "estado", level: "bairros", mun: TODOS, partido: TODOS, busca: "",
    detail: null,               // {key, m, b} quando vendo o ranking de um bairro/cidade
    sort: { key: null, dir: -1 }, rows: [], cols: [],
  };

  // ------------------------------------------------------------------ mapa
  const map = window.L.map("map", { preferCanvas: true }).setView([-20.47, -54.62], 12);
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const layer = window.L.layerGroup().addTo(map);

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
    const D = {
      id, meta: state.datasets.find((d) => d.id === id), locais, candidatos, partidos, bairros, municipios,
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
  const label = (id) => (state.datasets.find((d) => d.id === id)?.titulo || id).split(" · ")[0];

  async function candVotes(dsId, nr) {
    const d = await ds(dsId);
    if (!d.votes.has(nr)) d.votes.set(nr, new Map(await getJSON(`data/${dsId}/cand/${nr}.json`)));
    return d.votes.get(nr);
  }

  async function init() {
    try { state.datasets = await getJSON("data/datasets.json"); }
    catch (e) { loading("Sem dados ainda. Rode pipeline/build.py e sirva a pasta docs/ por um servidor HTTP."); return; }
    if (!state.datasets.length) { loading("Nenhum conjunto de dados gerado ainda."); return; }

    $("#tabs").innerHTML = state.datasets.map((d) => `<button data-id="${d.id}" aria-pressed="false">${esc(d.titulo)}</button>`).join("");

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
    if (["bairros", "cidades"].includes(h.get("n"))) state.level = h.get("n");
    const start = state.datasets.find((d) => d.id === h.get("e")) || state.datasets[0];
    await setActive(start.id, false);
    const ser = (h.get("s") || "").split(",").filter(Boolean).map((x) => x.split(":"));
    for (const [d, nr] of ser.slice(0, MAX_SERIES)) {
      if (state.datasets.some((m) => m.id === d)) { try { await addSeries(d, nr, false); } catch (e) { /* ignora */ } }
    }
    renderAll(true);
  }

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
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 3500); }

  // ------------------------------------------------------------ recorte
  const onlyCapital = (d) => Object.keys(d.municipios).length === 1 && d.municipios[CAPITAL];
  const involved = () => (state.series.length ? [...new Set(state.series.map((s) => s.ds))] : [state.active]);
  const effLevel = () => (state.scope === "capital" || state.mun !== TODOS ? "bairros" : state.level);
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

  // ---------------------------------------------------------- comparação
  async function addSeries(dsId, nr, render = true) {
    const ix = state.series.findIndex((s) => s.ds === dsId && s.nr === nr);
    if (ix >= 0) { state.series.splice(ix, 1); if (render) renderAll(false); return; }
    if (state.series.length >= MAX_SERIES) { toast(`Máximo de ${MAX_SERIES} candidatos na comparação. Remova um para adicionar outro.`); return; }
    loading("Carregando votos…");
    const votes = await candVotes(dsId, nr);
    const used = new Set(state.series.map((s) => s.color));
    state.series.push({ ds: dsId, nr, color: COLORS.find((c) => !used.has(c)), votes });
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
    renderControls(); renderKPIs(); renderChips(); renderCandList(); drawMap(fit); renderTable(); updateHash();
  }

  function renderControls() {
    const a = A();
    const capOnly = involved().every((id) => onlyCapital(D(id)));
    if (capOnly && state.scope === "interior") state.scope = "capital";
    document.querySelectorAll("#segScope button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.v === state.scope));
      b.disabled = capOnly && b.dataset.v === "interior";
      b.title = b.disabled ? "Esta eleição cobre só Campo Grande" : "";
    });
    const lvl = effLevel();
    document.querySelectorAll("#segLevel button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.v === lvl));
      b.disabled = state.scope === "capital" || state.mun !== TODOS || capOnly;
    });
    const muns = Object.keys(a.municipios).filter((m) => state.scope === "estado" || (state.scope === "capital" ? m === CAPITAL : m !== CAPITAL))
      .sort((x, y) => x.localeCompare(y, "pt-BR"));
    if (state.mun !== TODOS && !muns.includes(state.mun)) state.mun = TODOS;
    $("#fMun").innerHTML = (muns.length > 1 ? `<option value="${TODOS}">Todos (${muns.length})</option>` : "") +
      muns.map((m) => `<option ${m === state.mun ? "selected" : ""}>${esc(m)}</option>`).join("");
    $("#fMun").disabled = muns.length <= 1;
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
        .filter((p) => !state.series.some((x) => x.ds === p.ds && x.nr === p.nr)) : [];
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
      const c = a.candByNr.get(nr), sigla = a.partidoNome.get(c[2]) || c[2];
      const col = sel.get(nr);
      return `<li data-nr="${nr}" class="${col ? "sel" : ""}" ${col ? `style="--c:${col}"` : ""}><span class="pos">${i + 1}</span>` +
        `<span class="nm" title="${esc(c[1])}">${col ? `<span class="dot" style="--c:${col}"></span> ` : ""}${esc(c[1])}<small>${esc(nr.length > 2 ? nr + " · " + sigla : sigla)}</small></span>` +
        `<span class="v">${fmt.format(v)}</span></li>`;
    }).join("") || `<li class="muted">Nenhum candidato neste recorte.</li>`;
  }

  // ---------------------------------------------------------- mapa
  function buildPoints() {
    // une locais de eleições diferentes pela coordenada (mesma escola)
    const n = state.series.length, pts = new Map();
    const dsIds = involved();
    for (const id of dsIds) {
      const d = D(id);
      d.locais.forEach((l, i) => {
        if (!munIn(l[L.MUN]) || l[L.LAT] == null) return;
        const key = l[L.LAT].toFixed(4) + "," + l[L.LON].toFixed(4);
        let p = pts.get(key);
        if (!p) pts.set(key, p = { lat: l[L.LAT], lon: l[L.LON], ref: [id, i], refs: [], v: new Array(n).fill(0), val: {} });
        p.refs.push([id, i]);
        p.val[id] = (p.val[id] || 0) + l[L.VALIDOS];
      });
    }
    state.series.forEach((s, si) => {
      const d = D(s.ds);
      s.votes.forEach((q, i) => {
        const l = d.locais[i];
        if (!munIn(l[L.MUN]) || l[L.LAT] == null) return;
        const p = pts.get(l[L.LAT].toFixed(4) + "," + l[L.LON].toFixed(4));
        if (p) p.v[si] += q;
      });
    });
    return [...pts.values()];
  }

  function drawMap(fit) {
    layer.clearLayers();
    const pts = buildPoints(), n = state.series.length, ll = [];
    if (!n) {
      const maxV = Math.max(1, ...pts.map((p) => p.val[state.active] || 0));
      pts.forEach((p) => {
        const v = p.val[state.active] || 0;
        add(p, { radius: 3 + 12 * Math.sqrt(v / maxV), fillColor: "#0f6b4f", color: "#0b4f3a", weight: 0.6, fillOpacity: 0.55 });
      });
    } else {
      const maxV = Math.max(1, ...pts.map((p) => Math.max(...p.v)));
      let maxShare = 0.0001;
      if (n === 1) pts.forEach((p) => { maxShare = Math.max(maxShare, pct(p.v[0], p.val[state.series[0].ds])); });
      state.shareMax = maxShare;
      pts.forEach((p) => {
        const top = Math.max(...p.v);
        if (!top) { add(p, { radius: 2.5, fillColor: "#9aa49f", weight: 0, fillOpacity: 0.35 }); return; }
        let fill, stroke = "#333";
        if (n === 1) { fill = ramp(pct(p.v[0], p.val[state.series[0].ds]) / maxShare); stroke = "#7c2d12"; }
        else {
          // quem teve a maior fatia dos votos válidos do local (justo entre eleições diferentes)
          let best = -1, bi = 0;
          state.series.forEach((s, si) => { const sh = pct(p.v[si], p.val[s.ds]); if (sh > best) { best = sh; bi = si; } });
          fill = state.series[bi].color;
        }
        add(p, { radius: 3 + 14 * Math.sqrt(top / maxV), fillColor: fill, color: stroke, weight: 0.6, fillOpacity: 0.85 });
      });
    }
    function add(p, opts) {
      const mk = window.L.circleMarker([p.lat, p.lon], opts);
      mk.bindPopup(() => popupHtml(p), { maxWidth: 340 });
      mk.addTo(layer); ll.push([p.lat, p.lon]);
    }
    if (fit && ll.length) map.fitBounds(ll, { padding: [24, 24], maxZoom: 14 });
    renderLegend(pts);
  }

  function popupHtml(p) {
    const [id, i] = p.ref, l = D(id).locais[i];
    let body;
    if (state.series.length) {
      body = `<table>${state.series.map((s, si) => {
        const c = D(s.ds).candByNr.get(s.nr), val = p.val[s.ds];
        return `<tr><td><span class="dot" style="--c:${s.color}"></span> ${esc(shortName(c[1]))}</td><td>${esc(label(s.ds))}</td>` +
          `<td class="n">${fmt.format(p.v[si])}</td><td class="n">${val != null ? fmtPct(pct(p.v[si], val)) : "—"}</td></tr>`;
      }).join("")}</table>`;
    } else {
      const d = A();
      body = `<table>${l[L.TOP].map(([nr, v]) => `<tr><td>${esc(d.candByNr.get(nr)?.[1] || nr)}</td><td class="n">${fmt.format(v)}</td><td class="n">${fmtPct(pct(v, l[L.VALIDOS]))}</td></tr>`).join("")}</table>`;
    }
    return `<div class="pop"><h3>${esc(l[L.NOME])}</h3><div class="addr">${esc(l[L.END])}<br>${esc(l[L.BAIRRO])} · ${esc(l[L.MUN])}</div>` +
      `<div class="small">${fmt.format(l[L.ELEIT])} eleitores · ${fmt.format(p.val[id] || 0)} votos válidos (${esc(label(id))})</div>${body}</div>`;
  }

  function renderLegend(pts) {
    const el = $("#legend"), n = state.series.length;
    if (n === 1) {
      const c = D(state.series[0].ds).candByNr.get(state.series[0].nr);
      el.innerHTML = `<b>${esc(c[1])}</b><div class="bar"></div><div class="ends"><span>0%</span><span>${fmtPct(state.shareMax || 0)} dos válidos</span></div>` +
        `<div class="muted">Tamanho = nº de votos no local</div>`;
    } else if (n > 1) {
      el.innerHTML = `<b>Mais forte em cada local</b>` + state.series.map((s) => {
        const c = D(s.ds).candByNr.get(s.nr);
        return `<div class="it"><span class="dot" style="--c:${s.color}"></span>${esc(shortName(c[1]))} <span class="muted">· ${esc(label(s.ds))}</span></div>`;
      }).join("") + `<div class="muted">Cor = maior % dos válidos no local · tamanho = votos</div>`;
    } else {
      const sem = A().locais.filter((l) => munIn(l[L.MUN]) && l[L.LAT] == null).length;
      el.innerHTML = `<b>Locais de votação</b><div class="muted">Tamanho = votos válidos. Clique num local para ver o ranking.</div>` +
        (sem ? `<div class="muted">${sem} locais sem coordenada no cadastro do TSE</div>` : "");
    }
  }

  // --------------------------------------------------------- resumo
  function buildUnits() {
    const lvl = effLevel(), units = new Map(), n = state.series.length;
    const keyOf = (l) => (lvl === "cidades" ? l[L.MUN] : l[L.MUN] + "|" + l[L.BAIRRO]);
    for (const id of involved()) {
      D(id).locais.forEach((l, i) => {
        if (!munIn(l[L.MUN])) return;
        const k = keyOf(l);
        let u = units.get(k);
        if (!u) units.set(k, u = { k, m: l[L.MUN], b: lvl === "cidades" ? "" : l[L.BAIRRO], val: {}, el: {}, nl: {}, locs: [], v: new Array(n).fill(0) });
        u.val[id] = (u.val[id] || 0) + l[L.VALIDOS];
        u.el[id] = (u.el[id] || 0) + l[L.ELEIT];
        u.nl[id] = (u.nl[id] || 0) + 1;
        u.locs.push([id, i]);
      });
    }
    state.series.forEach((s, si) => {
      const d = D(s.ds);
      s.votes.forEach((q, i) => { const l = d.locais[i]; if (munIn(l[L.MUN])) units.get(keyOf(l)).v[si] += q; });
    });
    return [...units.values()];
  }

  function renderTable() {
    const lvl = effLevel(), n = state.series.length, a = A();
    const showMun = lvl === "cidades" || (state.scope !== "capital" && state.mun === TODOS);
    const where = state.mun !== TODOS ? state.mun : { estado: "MS inteiro", capital: "Campo Grande", interior: "Interior" }[state.scope];
    const geoCols = [...(showMun ? [["m", lvl === "cidades" ? "Cidade" : "Município"]] : []), ...(lvl === "bairros" ? [["b", "Bairro"]] : [])];
    let cols, rows, titulo, sub, total = null;
    $("#voltar").hidden = !state.detail;

    if (state.detail) {
      const u = state.detail;
      titulo = u.b ? `${u.b} · ${u.m}` : u.m;
      const top = u.b ? (a.bairros[a.bairroIdx.get(u.m + "|" + u.b)]?.top || []) : (a.municipios[u.m] || []).slice(0, 50);
      const val = u.val;
      sub = `${label(state.active)} · ${fmt.format(val)} votos válidos · clique num candidato para adicioná-lo à comparação`;
      cols = [["pos", "#", true], ["nome", "Candidato"], ["part", "Partido"], ["v", "Votos", true], ["p", "% válidos", true]];
      rows = top.map(([nr, v], i) => {
        const c = a.candByNr.get(nr) || [nr, nr, nr.slice(0, 2)];
        return { pos: i + 1, nome: c[1], part: a.partidoNome.get(c[2]) || c[2], v, p: pct(v, val), _nr: nr };
      });
    } else {
      const units = buildUnits();
      titulo = `${lvl === "cidades" ? "Cidades" : "Bairros"} · ${where}`;
      if (!n) {
        sub = `${label(state.active)} · clique numa linha para ver o ranking completo`;
        cols = [...geoCols, ["nl", "Locais", true], ["e", "Eleitores", true], ["v", "Válidos", true], ["lider", "Mais votado"], ["lv", "Votos", true]];
        rows = units.map((u) => {
          let lead;
          if (lvl === "cidades") lead = (a.municipios[u.m] || [])[0];
          else lead = a.bairros[a.bairroIdx.get(u.m + "|" + u.b)]?.top?.[0];
          const c = lead && a.candByNr.get(lead[0]);
          return { m: u.m, b: u.b, nl: u.nl[state.active] || 0, e: u.el[state.active] || 0, v: u.val[state.active] || 0,
            lider: c ? c[1] : "—", lv: lead ? lead[1] : 0, _u: u };
        });
        total = { m: "Total", b: "", nl: sum(rows, "nl"), e: sum(rows, "e"), v: sum(rows, "v"), lider: "", lv: null };
      } else {
        sub = n === 1 ? "% = participação nos votos válidos do bairro/cidade · % cand. = parte da votação total do candidato"
          : "% = participação nos votos válidos da eleição de cada candidato, no mesmo bairro/cidade" + (n === 2 ? " · Δ = diferença de votos (2º − 1º)" : "");
        cols = [...geoCols];
        state.series.forEach((s, si) => {
          const nm = shortName(D(s.ds).candByNr.get(s.nr)[1]);
          const tag = involved().length > 1 ? ` · ${label(s.ds)}` : "";
          cols.push([`v${si}`, `<span class="dot" style="--c:${s.color}"></span>${esc(nm)}${esc(tag)}`, true, s.color]);
          cols.push([`p${si}`, "%", true, s.color]);
        });
        if (n === 1) cols.push(["pc", "% cand.", true]);
        if (n === 2) cols.push(["d", "Δ votos", true]);
        const totS = state.series.map((s) => seriesTotal(s));
        rows = units.filter((u) => u.v.some((x) => x > 0)).map((u) => {
          const r = { m: u.m, b: u.b, _u: u };
          state.series.forEach((s, si) => { r[`v${si}`] = u.v[si]; r[`p${si}`] = u.val[s.ds] != null ? pct(u.v[si], u.val[s.ds]) : null; });
          if (n === 1) r.pc = pct(u.v[0], totS[0]);
          if (n === 2) r.d = u.v[1] - u.v[0];
          return r;
        });
        total = { m: "Total", b: "" };
        state.series.forEach((s, si) => {
          total[`v${si}`] = totS[si];
          const vt = units.reduce((acc, u) => acc + (u.val[s.ds] || 0), 0);
          total[`p${si}`] = pct(totS[si], vt);
        });
        if (n === 1) total.pc = 100;
        if (n === 2) total.d = totS[1] - totS[0];
      }
      // ordenação
      const k = state.sort.key && cols.some((c) => c[0] === state.sort.key) ? state.sort.key : (n ? "v0" : "v");
      const dir = state.sort.key ? state.sort.dir : -1;
      rows.sort((x, y) => {
        const a1 = x[k], b1 = y[k];
        if (typeof a1 === "number" || typeof b1 === "number") return ((a1 ?? -Infinity) - (b1 ?? -Infinity)) * dir;
        return String(a1).localeCompare(String(b1), "pt-BR") * dir;
      });
    }
    if (!rows.length && !state.detail) sub = "Nada a mostrar neste recorte" + (involved().every((id) => onlyCapital(D(id))) ? " — esta eleição cobre só Campo Grande." : ".");

    state.rows = total ? [total, ...rows] : rows; state.cols = cols;
    $("#detTitulo").textContent = titulo;
    $("#detSub").textContent = sub;
    const maxP = {};
    cols.forEach(([key]) => { if (key[0] === "p") maxP[key] = Math.max(1, ...rows.map((r) => r[key] || 0)); });
    $("#tabela thead").innerHTML = "<tr>" + cols.map(([key, t, num]) => `<th data-k="${key}" class="${num ? "n" : ""}">${t}</th>`).join("") + "</tr>";
    $("#tabela tbody").innerHTML = state.rows.slice(0, 2000).map((r, ri) => `<tr data-ri="${ri}" class="${r === total ? "total" : ""}">` + cols.map(([key, , num, color]) => {
      let v = r[key];
      if (v == null) v = "";
      else if (/^p\d$|^p$/.test(key)) v = (r !== total ? `<span class="pct-bar" style="width:${Math.round(28 * v / maxP[key])}px;${color ? `--c:${color}` : ""}"></span>` : "") + fmtPct(v);
      else if (key === "pc") v = fmtPct(v);
      else if (key === "d") return `<td class="n ${v > 0 ? "pos-d" : v < 0 ? "neg-d" : ""}">${fmtDelta(v)}</td>`;
      else if (num && typeof v === "number") v = fmt.format(v);
      else v = esc(v);
      return `<td class="${num ? "n" : ""}">${v}</td>`;
    }).join("") + "</tr>").join("");
  }
  const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);

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
    state.level = b.dataset.v; state.detail = null; state.sort = { key: null, dir: -1 }; renderAll(false);
  });
  $("#voltar").addEventListener("click", () => { state.detail = null; renderTable(); });
  $("#csv").addEventListener("click", exportCSV);
  $("#tabela thead").addEventListener("click", (e) => {
    const th = e.target.closest("th"); if (!th || state.detail) return;
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (th.classList.contains("n") ? -1 : 1) };
    renderTable();
  });
  $("#tabela tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const r = state.rows[+tr.dataset.ri]; if (!r) return;
    if (r._nr) { addSeries(state.active, r._nr); return; }
    if (!r._u) return;
    focus(r._u.locs);
    if (!state.series.length) { state.detail = { m: r._u.m, b: r._u.b, val: r._u.val[state.active] || 0 }; renderTable(); }
  });

  init();
})();
