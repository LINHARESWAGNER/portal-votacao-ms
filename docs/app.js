/* Portal de Votação MS — lê os JSON gerados por pipeline/build.py */
(() => {
  "use strict";

  // índices do array de locais (ver build.py)
  const L = { ID: 0, NOME: 1, END: 2, BAIRRO: 3, MUN: 4, LAT: 5, LON: 6, ELEIT: 7, SECOES: 8, VALIDOS: 9, BRANCOS: 10, NULOS: 11, TOP: 12, BO: 13, REG: 14 };
  const CAPITAL = "Campo Grande";
  const COLORS = ["#2563eb", "#dc2626", "#059669", "#9333ea"];
  const MAX_SERIES = 4;
  const CHART_MAX = 30;
  const LS_KEY = "votacao-ms:apelidos";

  const $ = (s) => document.querySelector(s);
  const fmt = new Intl.NumberFormat("pt-BR");
  const pct = (a, b) => (b ? (100 * a / b) : 0);
  const fmtPct = (x) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
  const fmtDelta = (x) => (x > 0 ? "+" : "") + fmt.format(x);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const normName = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const shortName = (s) => { const p = String(s).split(" "); return p.length > 2 ? `${p[0]} ${p[p.length - 1]}` : s; };
  const coordKey = (l) => (l[L.LAT] == null ? null : l[L.LAT].toFixed(4) + "," + l[L.LON].toFixed(4));
  const lsGet = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } };

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
  const sigla = (nome) => {
    const n = normName(nome); const hit = SIGLAS.find(([k]) => n.includes(k));
    return hit ? hit[1] : nome;
  };

  const state = {
    datasets: [], cache: new Map(),
    eleicoes: new Set(),        // eleições selecionadas
    muns: new Set(),            // municípios selecionados (vazio = todos do recorte)
    partidos: new Set(),        // siglas selecionadas (vazio = todos)
    series: [], seq: 0,         // comparação: [{ds, nr, color, ord, votes}] em ordem cronológica
    persons: new Map(),         // nome civil normalizado -> [{ds, nr, v}]
    apelidos: {}, apelidosLocal: {},
    geo: { bairro: null, regiao: null, mun: null, regms: null }, regDe: new Map(),
    scope: "estado", level: "cidades", levelCap: "regioes", busca: "", metric: "v",
    detail: null, sort: { key: null, dir: -1 }, rows: [], cols: [], units: [],
  };

  // ------------------------------------------------------------------ mapa
  const MS_BOUNDS = window.L.latLngBounds([-24.2, -58.3], [-17.0, -50.8]);
  const map = window.L.map("map", { maxBounds: MS_BOUNDS.pad(0.08), maxBoundsViscosity: 1.0, minZoom: 5 }).fitBounds(MS_BOUNDS);
  map.createPane("mascara"); map.getPane("mascara").style.zIndex = 350; map.getPane("mascara").style.pointerEvents = "none";
  window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  const layer = window.L.layerGroup().addTo(map);
  const svgRenderer = window.L.svg();

  // botão "centralizar" (volta ao enquadramento padrão do recorte)
  const Centro = window.L.Control.extend({
    options: { position: "topleft" },
    onAdd() {
      const div = window.L.DomUtil.create("div", "leaflet-bar leaflet-control leaflet-control-centro");
      const a = window.L.DomUtil.create("a", "", div);
      a.href = "#"; a.title = "Centralizar"; a.setAttribute("role", "button"); a.setAttribute("aria-label", "Centralizar o mapa"); a.innerHTML = "⌖";
      window.L.DomEvent.on(a, "click", (e) => { window.L.DomEvent.stop(e); fitDefault(); });
      return div;
    },
  });
  new Centro().addTo(map);

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
      id, locais, candidatos, partidos, bairros, municipios,
      cg: { bairro: new Map(cg.bairro.map((x) => [(x.m || CAPITAL) + "|" + x.b, x])), regiao: new Map(cg.regiao.map((x) => [x.b, x])) },
      rankReg: new Map(),
      candByNr: new Map(candidatos.map((c) => [c[0], c])),
      partidoNome: new Map(partidos.map((p) => [p[0], sigla(p[1])])),
      bairroIdx: new Map(bairros.map((b, i) => [b.m + "|" + b.b, i])),
      votes: new Map(),
    };
    state.cache.set(id, D);
    return D;
  }
  const D = (id) => state.cache.get(id);
  const meta = (id) => state.datasets.find((d) => d.id === id) || {};
  const label = (id) => (meta(id).titulo || id).split(" · ")[0];
  const yearOf = (id) => +meta(id).ano || 0;
  const chrono = (ids) => [...ids].sort((a, b) => yearOf(a) - yearOf(b) || state.datasets.findIndex((d) => d.id === a) - state.datasets.findIndex((d) => d.id === b));
  const selEleicoes = () => chrono(state.eleicoes);
  const principal = () => { const s = selEleicoes(); return s[s.length - 1]; };   // a mais recente selecionada
  const A = () => D(principal());

  // nome exibido: ajuste local > apelidos.json > nome de urna > nome civil
  function displayName(dsId, nr) {
    const c = D(dsId)?.candByNr.get(nr);
    if (!c) return nr;
    if (nr.length <= 2) return c[1];
    const k = normName(c[1]);
    return state.apelidosLocal[k] || state.apelidos[k] || c[4] || c[1];
  }

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

    const geo = await Promise.all(["ms_bairros", "cg_regioes", "ms", "ms_municipios", "ms_regioes"].map((n) => getJSON(`data/geo/${n}.geojson`).catch(() => null)));
    state.geo.bairro = geo[0]; state.geo.regiao = geo[1]; state.geo.mun = geo[3]; state.geo.regms = geo[4];
    // município -> região do estado
    (geo[4]?.features || []).forEach((f) => f.properties.municipios.forEach((m) => state.regDe.set(normName(m), f.properties.nome)));
    if (geo[2]) maskOutsideMS(geo[2]);
    state.apelidos = await getJSON("data/apelidos.json").catch(() => ({}));
    state.apelidosLocal = lsGet(LS_KEY) || {};

    // carrega todas as eleições (são pequenas) e monta o índice de pessoas entre eleições
    await Promise.all(state.datasets.map((m) => ds(m.id)));
    state.datasets.forEach((m) => D(m.id).candidatos.forEach(([nr, nome, , v]) => {
      if (nr.length <= 2) return;
      const k = normName(nome);
      if (!state.persons.has(k)) state.persons.set(k, []);
      state.persons.get(k).push({ ds: m.id, nr, v });
    }));

    const h = new URLSearchParams(location.hash.slice(1));
    const ids = (h.get("e") || "").split(",").filter((x) => state.datasets.some((d) => d.id === x));
    state.eleicoes = new Set(ids.length ? ids : [state.datasets[state.datasets.length - 1].id]);
    if (["estado", "capital", "interior"].includes(h.get("g"))) state.scope = h.get("g");
    if (["regioes", "bairros", "cidades"].includes(h.get("n"))) state.level = h.get("n");
    const nc = h.get("nc") === "tse" ? "locais" : h.get("nc");
    if (["regioes", "bairros", "locais"].includes(nc)) state.levelCap = nc;
    if (["v", "p"].includes(h.get("m"))) state.metric = h.get("m");
    (h.get("mu") || "").split("|").filter(Boolean).forEach((m) => state.muns.add(m));
    (h.get("pa") || "").split(",").filter(Boolean).forEach((p) => state.partidos.add(p));
    const ser = (h.get("s") || "").split(",").filter(Boolean).map((x) => x.split(":"));
    for (const [d, nr] of ser.slice(0, MAX_SERIES)) {
      if (state.datasets.some((m) => m.id === d) && D(d).candByNr.has(nr)) await addSeries(d, nr, false);
    }
    loading(null);
    renderAll(true);
  }

  function setTopHeight() { document.documentElement.style.setProperty("--top-h", $(".top").offsetHeight + "px"); }
  window.addEventListener("resize", setTopHeight);

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
    map.setMinZoom(Math.max(4, map.getBoundsZoom(b, false)));
  }

  function loading(msg) { const el = $("#loading"); el.hidden = !msg; if (msg) el.textContent = msg; }
  let toastT;
  function toast(msg) { const el = $("#toast"); el.textContent = msg; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { el.hidden = true; }, 4500); }

  // ------------------------------------------------------- seleção múltipla
  // seletor com caixas de marcação e a opção "Todos"; seleção vazia = todos
  function multiSelect(el, { allLabel, search, minOne }) {
    el.innerHTML = `<button type="button" aria-haspopup="listbox"></button><div class="ms-pop" hidden>${search ? '<input type="search" placeholder="Filtrar…">' : ""}<div class="ms-list"></div></div>`;
    const btn = el.querySelector("button"), pop = el.querySelector(".ms-pop"), list = el.querySelector(".ms-list"), q = el.querySelector("input");
    let opts = [], sel = new Set(), onChange = () => {};
    const summary = () => {
      if (!sel.size || sel.size === opts.length) return `${allLabel} (${opts.length})`;
      if (sel.size === 1) return opts.find((o) => o.v === [...sel][0])?.t || [...sel][0];
      return `${sel.size} selecionados`;
    };
    const draw = () => {
      const f = q ? normName(q.value) : "";
      const all = !sel.size || sel.size === opts.length;
      list.innerHTML = `<label class="all"><input type="checkbox" data-all ${all ? "checked" : ""}> ${esc(allLabel)}</label>` +
        opts.filter((o) => !f || normName(o.t).includes(f)).map((o) =>
          `<label><input type="checkbox" value="${esc(o.v)}" ${sel.has(o.v) && !all ? "checked" : ""}> ${esc(o.t)}</label>`).join("");
      btn.textContent = summary();
    };
    btn.addEventListener("click", () => { pop.hidden = !pop.hidden; if (!pop.hidden) { draw(); q?.focus(); } });
    q?.addEventListener("input", draw);
    list.addEventListener("change", (e) => {
      const cb = e.target;
      if (cb.dataset.all !== undefined) sel = new Set(minOne && !cb.checked ? [opts[opts.length - 1].v] : []);
      else {
        if (!sel.size || sel.size === opts.length) sel = new Set();
        if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
        if (sel.size === opts.length) sel = new Set();
        if (!sel.size && minOne) sel = new Set(opts.map((o) => o.v));
      }
      draw(); onChange(new Set(sel));
    });
    document.addEventListener("click", (e) => { if (!el.contains(e.target)) pop.hidden = true; });
    return {
      set(options, selected, disabled) { opts = options; sel = new Set([...selected].filter((v) => opts.some((o) => o.v === v))); btn.disabled = !!disabled; draw(); },
      onChange(fn) { onChange = fn; },
    };
  }
  const msEleicao = multiSelect($("#fEleicao"), { allLabel: "Todas", minOne: true });
  const msMun = multiSelect($("#fMun"), { allLabel: "Todos", search: true });
  const msPartido = multiSelect($("#fPartido"), { allLabel: "Todos", search: true });

  // ------------------------------------------------------------ recorte
  const onlyCapital = (d) => Object.keys(d.municipios).length === 1 && d.municipios[CAPITAL];
  const involved = () => (state.series.length ? chrono(new Set(state.series.map((s) => s.ds))) : selEleicoes());
  const capView = () => state.scope === "capital" || (state.muns.size === 1 && state.muns.has(CAPITAL));
  const LEVELS_CAP = [["regioes", "Regiões"], ["bairros", "Bairros"], ["locais", "Locais de votação"]];
  const LEVELS_EST = [["regioes", "Regiões"], ["cidades", "Cidades"], ["bairros", "Bairros"]];
  const regTur = (m) => state.regDe.get(normName(m)) || "Sem região";
  function effLevel() {
    if (capView()) return state.levelCap;
    if (state.muns.size === 1 && state.level !== "bairros") return "bairros";
    return state.level === "locais" ? "cidades" : state.level;
  }
  const LVLNAME = { regioes: "Regiões", bairros: "Bairros", locais: "Locais de votação", cidades: "Cidades" };
  function munIn(m) {
    if (state.muns.size) return state.muns.has(m);
    if (state.scope === "capital") return m === CAPITAL;
    if (state.scope === "interior") return m !== CAPITAL;
    return true;
  }
  const whereLabel = () => (state.muns.size === 1 ? [...state.muns][0] : state.muns.size ? `${state.muns.size} municípios`
    : { estado: "MS inteiro", capital: "Campo Grande", interior: "Interior" }[state.scope]);

  // unidade (linha da tabela / forma no mapa) de um local
  function unitOf(l, lvl) {
    const m = l[L.MUN], cg = m === CAPITAL && l[L.BO];
    if (lvl === "cidades") return { k: m, m, b: "", g: "cidade" };
    if (lvl === "regioes") {
      if (capView()) return cg ? { k: "R|" + l[L.REG], m, b: l[L.REG], g: "regiao" } : { k: m, m, b: "", g: "cidade" };
      const r = regTur(m);
      return { k: "RT|" + r, m: r, b: r, g: "regms" };
    }
    if (lvl === "locais") return { k: "L|" + (coordKey(l) || l[L.ID]), m, b: l[L.NOME], bb: l[L.BO] || l[L.BAIRRO], g: "local" };
    if (l[L.BO]) return { k: "B|" + m + "|" + l[L.BO], m, b: l[L.BO], r: cg ? l[L.REG] : regTur(m), g: "bairro" };
    return { k: m + "|" + l[L.BAIRRO], m, b: l[L.BAIRRO], g: "tse" };
  }
  // população residente (Censo 2022) dos bairros oficiais do IBGE
  const popOf = (u) => (u.g === "bairro" ? D(principal())?.cg.bairro.get(u.m + "|" + u.b)?.pop
    ?? state.datasets.map((m) => D(m.id)?.cg.bairro.get(u.m + "|" + u.b)?.pop).find((x) => x != null) : null);
  function unitTop(d, u) {
    if (u.g === "cidade") return d.municipios[u.m] || [];
    if (u.g === "regiao") return d.cg.regiao.get(u.b)?.top || [];
    if (u.g === "bairro") return d.cg.bairro.get(u.m + "|" + u.b)?.top || [];
    if (u.g === "regms") {
      // soma o ranking dos municípios da região que estão no recorte
      const key = u.b + "|" + state.scope + "|" + [...state.muns].join(",");
      if (!d.rankReg.has(key)) {
        const acc = new Map();
        Object.entries(d.municipios).forEach(([m, lst]) => {
          if (regTur(m) !== u.b || !munIn(m)) return;
          lst.forEach(([nr, v]) => acc.set(nr, (acc.get(nr) || 0) + v));
        });
        d.rankReg.set(key, [...acc.entries()].sort((a, b) => b[1] - a[1]));
      }
      return d.rankReg.get(key);
    }
    if (u.g === "local") { const ref = u.locs.find(([id]) => id === d.id); return ref ? d.locais[ref[1]][L.TOP] : []; }
    return d.bairros[d.bairroIdx.get(u.m + "|" + u.b)]?.top || [];
  }

  // ranking de uma eleição no recorte atual
  function rankOf(d) {
    let muns = null;
    if (state.muns.size) muns = [...state.muns];
    else if (state.scope === "capital") muns = [CAPITAL];
    if (muns) {
      const acc = new Map();
      muns.forEach((m) => (d.municipios[m] || []).forEach(([nr, v]) => acc.set(nr, (acc.get(nr) || 0) + v)));
      return [...acc.entries()];
    }
    const tot = d.candidatos.map((c) => [c[0], c[3]]);
    if (state.scope === "estado") return tot;
    const cap = new Map(d.municipios[CAPITAL] || []);
    return tot.map(([nr, v]) => [nr, v - (cap.get(nr) || 0)]).filter((x) => x[1] > 0);
  }

  function seriesTotal(s) {
    const d = D(s.ds); let v = 0;
    s.votes.forEach((q, i) => { if (munIn(d.locais[i][L.MUN])) v += q; });
    return v;
  }
  const seriesName = (s) => displayName(s.ds, s.nr);
  const partySigla = (d, nr) => { const c = d.candByNr.get(nr); return c ? d.partidoNome.get(c[2]) || c[2] : ""; };

  // ---------------------------------------------------------- comparação
  const sortSeries = () => state.series.sort((a, b) => yearOf(a.ds) - yearOf(b.ds) || a.ord - b.ord);
  function deltaLabel() {
    const [a, b] = state.series; const ya = yearOf(a.ds), yb = yearOf(b.ds);
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
    const ids = involved();
    if (render && state.scope === "estado" && !state.muns.size && ids.some((id) => onlyCapital(D(id))) && ids.some((id) => !onlyCapital(D(id)))) {
      state.scope = "capital";
      toast("Recorte ajustado para Campo Grande, a área que as eleições comparadas têm em comum. Troque para Estado se quiser.");
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
    const capOnly = involved().every((id) => onlyCapital(D(id)));
    if (capOnly && state.scope !== "capital") { state.scope = "capital"; state.muns.clear(); }
    document.querySelectorAll("#segScope button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.v === state.scope));
      b.disabled = capOnly && b.dataset.v !== "capital";
      b.title = b.disabled ? "As eleições selecionadas cobrem só Campo Grande" : "";
    });
    const lvl = effLevel(), opts = capView() ? LEVELS_CAP : LEVELS_EST;
    $("#segLevel").innerHTML = opts.map(([v, t]) =>
      `<button data-v="${v}" aria-pressed="${v === lvl}" ${!capView() && state.muns.size === 1 && v !== "bairros" ? "disabled" : ""}>${t}</button>`).join("");

    msEleicao.set(chrono(state.datasets.map((d) => d.id)).map((id) => ({ v: id, t: meta(id).titulo })), state.eleicoes.size === state.datasets.length ? new Set() : state.eleicoes);
    const muns = new Set();
    selEleicoes().forEach((id) => Object.keys(D(id).municipios).forEach((m) => {
      if (state.scope === "estado" || (state.scope === "capital" ? m === CAPITAL : m !== CAPITAL)) muns.add(m);
    }));
    [...state.muns].forEach((m) => { if (!muns.has(m)) state.muns.delete(m); });
    msMun.set([...muns].sort((x, y) => x.localeCompare(y, "pt-BR")).map((m) => ({ v: m, t: m })), state.muns, muns.size <= 1);
    const sgs = new Set();
    selEleicoes().forEach((id) => D(id).partidos.forEach((p) => sgs.add(sigla(p[1]))));
    msPartido.set([...sgs].sort((x, y) => x.localeCompare(y, "pt-BR")).map((s) => ({ v: s, t: s })), state.partidos);
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
    const nota = $("#kpiNota");
    nota.hidden = state.eleicoes.size < 2;
    nota.textContent = `Números do topo: ${meta(principal()).titulo} (a mais recente selecionada).`;
  }

  function renderChips() {
    $("#cmpBlock").hidden = !state.series.length;
    $("#chips").innerHTML = state.series.map((s, si) => {
      const d = D(s.ds), c = d.candByNr.get(s.nr);
      const outras = c && s.nr.length > 2 ? (state.persons.get(normName(c[1])) || [])
        .filter((p) => !state.series.some((x) => x.ds === p.ds && x.nr === p.nr))
        .sort((x, y) => yearOf(x.ds) - yearOf(y.ds)) : [];
      return `<li class="chip" style="--c:${s.color}">
        <div class="chip-top"><span class="nm" title="${esc(c?.[1])}">${esc(seriesName(s))}</span>
          <span class="v">${fmt.format(seriesTotal(s))}</span>
          <button class="x" data-rm="${si}" title="Remover">×</button></div>
        <div class="meta">${esc(label(s.ds))} · ${esc(s.nr)} · ${esc(partySigla(d, s.nr))}</div>
        ${outras.length ? `<div class="outras">${outras.map((p) =>
          `<button data-add="${p.ds}:${p.nr}" title="Adicionar à comparação">+ ${esc(label(p.ds))} · ${fmt.format(p.v)}</button>`).join("")}</div>` : ""}
      </li>`;
    }).join("");
  }

  function renderCandList() {
    const q = normName(state.busca), multi = state.eleicoes.size > 1;
    const sel = new Map(state.series.map((s) => [s.ds + ":" + s.nr, s.color]));
    let items = [];
    selEleicoes().forEach((id) => {
      const d = D(id);
      rankOf(d).forEach(([nr, v]) => {
        const c = d.candByNr.get(nr); if (!c) return;
        const sg = partySigla(d, nr);
        if (state.partidos.size && !state.partidos.has(sg)) return;
        const nm = displayName(id, nr);
        if (q && !(normName(nm).includes(q) || normName(c[1]).includes(q) || nr.startsWith(q))) return;
        items.push({ id, nr, v, nm, sg });
      });
    });
    items.sort((a, b) => b.v - a.v);
    items = items.slice(0, 400);
    $("#listaCand").innerHTML = items.map((it, i) => {
      const col = sel.get(it.id + ":" + it.nr);
      return `<li data-ds="${it.id}" data-nr="${it.nr}" class="${col ? "sel" : ""}" ${col ? `style="--c:${col}"` : ""}><span class="pos">${i + 1}</span>` +
        `<span class="nm" title="${esc(D(it.id).candByNr.get(it.nr)[1])}">${col ? `<span class="dot" style="--c:${col}"></span> ` : ""}${esc(it.nm)}` +
        `<small>${esc(it.nr.length > 2 ? it.nr + " · " + it.sg : it.sg)}</small>${multi ? `<span class="tag">${esc(label(it.id))}</span>` : ""}</span>` +
        `<span class="v">${fmt.format(it.v)}</span></li>`;
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
    const n = state.series.length, p = principal();
    if (!n) {
      const v = u.val[p] || 0;
      return { fill: "#0f6b4f", op: 0.12 + 0.68 * Math.sqrt(v / ctx.maxV), size: v / ctx.maxV, any: v > 0 };
    }
    const top = Math.max(...u.v);
    if (!top) return { fill: "#9aa49f", op: 0.15, size: 0, any: false };
    if (n === 1) return { fill: ramp((u.sh[0] || 0) / ctx.maxShare), op: 0.82, size: top / ctx.maxV, any: true };
    const order = u.sh.map((x, i) => [x ?? -1, i]).sort((a, b) => b[0] - a[0]);
    const [best, bi] = order[0], second = order[1] ? Math.max(0, order[1][0]) : 0;
    const margin = best > 0 ? (best - second) / best : 0;
    return { fill: state.series[bi].color, op: 0.35 + 0.5 * margin, size: top / ctx.maxV, any: true };
  }

  // contornos disponíveis para o nível atual (municípios de MS; regiões e bairros de Campo Grande)
  function shapesFor(lvl) {
    if (lvl === "cidades" && state.geo.mun) return { fc: state.geo.mun, key: (u) => u.m };
    if (!capView() && lvl === "regioes" && state.geo.regms) return { fc: state.geo.regms, key: (u) => u.b };
    if (capView() && lvl === "regioes" && state.geo.regiao) return { fc: state.geo.regiao, key: (u) => u.b };
    // bairros oficiais do IBGE (Censo 2022), em qualquer município que os tenha
    if (lvl === "bairros" && state.geo.bairro) return { fc: state.geo.bairro, key: (u) => u.m + "|" + u.b, fkey: (f) => f.properties.mun + "|" + f.properties.nome };
    return null;
  }

  function drawMap(fit) {
    layer.clearLayers();
    const lvl = effLevel(), units = state.units, n = state.series.length, p = principal(), ll = [];
    const ctx = {
      maxV: Math.max(1, ...units.map((u) => (n ? Math.max(...u.v) : u.val[p] || 0))),
      maxShare: Math.max(0.0001, ...units.map((u) => u.sh[0] || 0)),
    };
    state.shareMax = ctx.maxShare;
    const sh = shapesFor(lvl), drawn = new Set(), llPoly = [];
    if (sh) {
      const byName = new Map(units.map((u) => [sh.key(u), u]));
      const fk = sh.fkey || ((f) => f.properties.nome);
      window.L.geoJSON(sh.fc, {
        renderer: svgRenderer,
        filter: (f) => byName.has(fk(f)),
        style: (f) => {
          const st = unitStyle(byName.get(fk(f)), ctx);
          return { color: "#1b1f1d", weight: lvl === "cidades" ? 0.8 : 1.2, opacity: 0.75, fillColor: st.fill, fillOpacity: st.any ? st.op : 0.06 };
        },
        onEachFeature: (f, lyr) => {
          const u = byName.get(fk(f)); drawn.add(u.k);
          const w = lvl === "cidades" ? 0.8 : 1.2;
          lyr.bindTooltip(() => tipHtml(u), { sticky: true, className: "tip", opacity: 1 });
          lyr.on("mouseover", () => { lyr.setStyle({ weight: 3 }); lyr.bringToFront(); });
          lyr.on("mouseout", () => lyr.setStyle({ weight: w }));
          lyr.on("click", () => onUnit(u));
        },
      }).eachLayer((lyr) => { lyr.addTo(layer); const bb = lyr.getBounds(); llPoly.push(bb.getNorthEast(), bb.getSouthWest()); });
    }
    // bolhas: locais de votação e unidades sem contorno (bairros do interior, distritos…)
    units.forEach((u) => {
      if (drawn.has(u.k) || u.lat == null) return;
      const st = unitStyle(u, ctx);
      const r = lvl === "locais" ? 3 + 14 * Math.sqrt(st.size) : 5 + 20 * Math.sqrt(st.size);
      const mk = window.L.circleMarker([u.lat, u.lon], {
        renderer: svgRenderer, bubblingMouseEvents: false,
        radius: st.any ? r : 2.5, fillColor: st.fill, color: n ? "#333" : "#0b4f3a", weight: st.any ? 0.7 : 0,
        fillOpacity: st.any ? Math.max(st.op, n ? 0.75 : 0.55) : 0.35,
      });
      mk.bindTooltip(() => tipHtml(u), { sticky: true, className: "tip", opacity: 1 });
      mk.on("click", () => onUnit(u));
      mk.addTo(layer); ll.push([u.lat, u.lon]);
    });
    state.fitTo = llPoly.length && lvl !== "cidades" ? llPoly : (llPoly.length ? llPoly.concat(ll) : ll);
    if (fit) fitDefault();
    renderLegend(sh);
  }

  function fitDefault() {
    if (!capView() && !state.muns.size && state.msBounds) { map.fitBounds(state.msBounds, { padding: [10, 10] }); return; }
    if (state.fitTo?.length) map.fitBounds(window.L.latLngBounds(state.fitTo), { padding: [24, 24], maxZoom: 14 });
  }

  function tipHtml(u) {
    const n = state.series.length, p = principal(), a = D(p);
    let head, addr = "";
    if (u.g === "local") {
      const [id, i] = u.locs[0], l = D(id).locais[i];
      head = l[L.NOME];
      addr = `${esc(l[L.END])}<br>${esc(l[L.BO] ? `${l[L.BO]} · Região ${l[L.REG]}` : l[L.BAIRRO])} · ${esc(l[L.MUN])}`;
    } else if (u.g === "regiao") { head = "Região " + u.b; addr = esc(u.m); }
    else if (u.g === "regms") {
      const ms = new Set(u.locs.map(([id, i]) => D(id).locais[i][L.MUN]));
      head = "Região " + u.b; addr = `${ms.size} município${ms.size > 1 ? "s" : ""}`;
    }
    else if (u.g === "bairro") { head = u.b; addr = `Região ${esc(u.r)} · ${esc(u.m)}`; }
    else if (u.g === "cidade") head = u.m;
    else { head = u.b; addr = esc(u.m); }
    const nl = u.nl[p] ?? Object.values(u.nl)[0] ?? 0;
    const val = u.val[p] ?? Object.values(u.val)[0] ?? 0;
    let body;
    if (n) {
      body = `<table>${state.series.map((s, si) => `<tr><td><span class="dot" style="--c:${s.color}"></span>${esc(shortName(seriesName(s)))}</td>` +
        `<td>${esc(label(s.ds))}</td><td class="n">${fmt.format(u.v[si])}</td><td class="n">${u.sh[si] != null ? fmtPct(u.sh[si]) : "—"}</td></tr>`).join("")}` +
        (n === 2 ? `<tr><td colspan="2"><b>${esc(deltaLabel())}</b></td><td class="n"><b>${fmtDelta(u.v[1] - u.v[0])}</b></td><td></td></tr>` : "") + `</table>`;
    } else {
      body = `<div class="small muted" style="margin:2px 0">${esc(label(p))}</div><table>${unitTop(a, u).slice(0, 6).map(([nr, v]) =>
        `<tr><td>${esc(shortName(displayName(p, nr)))}</td><td class="n">${fmt.format(v)}</td><td class="n">${fmtPct(pct(v, u.val[p] || 0))}</td></tr>`).join("")}</table>`;
    }
    return `<h3>${esc(head)}</h3>${addr ? `<div class="addr">${addr}</div>` : ""}` +
      `<div class="small" style="margin-bottom:4px">${u.g !== "local" ? fmt.format(nl) + (nl === 1 ? " local · " : " locais · ") : ""}${fmt.format(val)} votos válidos` +
      `${popOf(u) ? ` · ${fmt.format(popOf(u))} habitantes (Censo 2022)` : ""}</div>${body}`;
  }

  function renderLegend(sh) {
    const el = $("#legend"), n = state.series.length, lvl = effLevel();
    const unit = { regioes: "região", bairros: "bairro", locais: "local", cidades: "município" }[lvl];
    const tam = sh ? "" : " · tamanho = votos";
    if (n === 1) {
      el.innerHTML = `<b>${esc(seriesName(state.series[0]))}</b><div class="bar"></div><div class="ends"><span>0%</span><span>${fmtPct(state.shareMax || 0)} dos válidos</span></div>` +
        `<div class="muted">Cor = % dos válidos em cada ${unit}${tam}</div>`;
    } else if (n > 1) {
      el.innerHTML = `<b>Mais forte em cada ${unit}</b>` + state.series.map((s) =>
        `<div class="it"><span class="dot" style="--c:${s.color}"></span>${esc(shortName(seriesName(s)))} <span class="muted">· ${esc(label(s.ds))}</span></div>`).join("") +
        `<div class="muted">Cor = maior % dos válidos · cor mais forte = vantagem maior${tam}</div>`;
    } else {
      el.innerHTML = `<b>${LVLNAME[lvl]} · ${esc(label(principal()))}</b><div class="bar acc"></div><div class="muted">${sh ? "Tonalidade" : "Tamanho"} = votos válidos. Passe o mouse para ver o ranking; clique para abrir na tabela.</div>`;
    }
  }

  function onUnit(u) {
    focus(u.locs);
    if (!state.series.length) { state.detail = { ...u }; renderTable(); renderChart(); }
  }

  // --------------------------------------------------------- resumo
  function renderTable() {
    const lvl = effLevel(), n = state.series.length, eles = involved();
    const showMun = lvl === "cidades" || (!capView() && state.muns.size !== 1);
    const geoCols = lvl === "regioes" ? [["b", "Região"]]
      : lvl === "cidades" ? [["m", "Cidade"]]
      : lvl === "locais" ? [...(showMun ? [["m", "Município"]] : []), ["b", "Local de votação"], ["bb", "Bairro"]]
      : [...(showMun ? [["m", "Município"]] : []), ["b", "Bairro"], ["r", "Região"]];
    let cols, rows, titulo, sub, total = null;
    $("#voltar").hidden = !state.detail;

    if (state.detail) {
      const u = state.detail, p = principal(), a = D(p);
      titulo = u.g === "regiao" || u.g === "regms" ? "Região " + u.b : u.g === "cidade" ? u.m : `${u.b} · ${u.m}`;
      const val = u.val[p] || 0;
      sub = `${label(p)} · ${fmt.format(val)} votos válidos · clique num candidato para adicioná-lo à comparação`;
      cols = [["pos", "#", true], ["nome", "Candidato"], ["part", "Partido"], ["v", "Votos", true], ["p", "% válidos", true]];
      rows = unitTop(a, u).slice(0, 50).map(([nr, v], i) => {
        const nm = displayName(p, nr);
        return { pos: i + 1, nome: nm, part: partySigla(a, nr), v, p: pct(v, val), _nr: nr, _ds: p, _lab: nm };
      });
    } else {
      const units = state.units;
      titulo = `${LVLNAME[lvl]} · ${whereLabel()}`;
      if (!n) {
        const multi = eles.length > 1;
        sub = multi ? "Votos válidos e mais votado em cada eleição selecionada · clique numa linha para ver o ranking (da mais recente)"
          : `${label(eles[0])} · clique numa linha (ou no mapa) para ver o ranking completo`;
        cols = [...geoCols];
        if (!multi) {
          cols.push(...(lvl === "bairros" ? [["hab", "Habitantes", true]] : []), ...(lvl !== "locais" ? [["nl", "Locais", true]] : []), ["e", "Eleitores", true], ["v", "Válidos", true], ["lider", "Mais votado"], ["lv", "Votos", true]);
        } else {
          eles.forEach((id, k) => cols.push([`v_${k}`, `Válidos · ${esc(label(id))}`, true], [`l_${k}`, `Mais votado · ${esc(label(id))}`], [`lv_${k}`, "Votos", true]));
        }
        rows = units.map((u) => {
          const r = { m: u.m, b: u.b, r: u.r || "", bb: u.bb || "", _u: u };
          eles.forEach((id, k) => {
            const lead = unitTop(D(id), u)[0];
            const nm = lead ? displayName(id, lead[0]) : "—";
            if (!multi) Object.assign(r, { hab: popOf(u) ?? null, nl: u.nl[id] || 0, e: u.el[id] || 0, v: u.val[id] || 0, lider: nm, lv: lead ? lead[1] : 0 });
            else Object.assign(r, { [`v_${k}`]: u.val[id] ?? null, [`l_${k}`]: u.val[id] != null ? nm : "", [`lv_${k}`]: u.val[id] != null && lead ? lead[1] : null });
          });
          r.v_chart = u.val[principal()] || 0;
          return r;
        });
        total = {};
        if (!multi) Object.assign(total, { hab: lvl === "bairros" ? sum(rows, "hab") || null : null, nl: sum(rows, "nl"), e: sum(rows, "e"), v: sum(rows, "v") });
        else eles.forEach((id, k) => { total[`v_${k}`] = sum(rows, `v_${k}`); });
        const tv = sum(rows, "v_chart"); rows.forEach((r) => { r.p = pct(r.v_chart, tv); });
      } else {
        sub = (n === 1 ? "% = participação nos votos válidos de cada linha · % cand. = parte da votação total do candidato"
          : "% = participação nos votos válidos da eleição de cada candidato, na mesma linha") +
          (n === 2 ? ` · ${deltaLabel()} = eleição mais recente menos a mais antiga` : "") + " · colunas em ordem cronológica";
        cols = [...geoCols];
        const multiDs = involved().length > 1;
        state.series.forEach((s, si) => {
          cols.push([`v${si}`, `<span class="dot" style="--c:${s.color}"></span>${esc(shortName(seriesName(s)))}${multiDs ? esc(` · ${label(s.ds)}`) : ""}`, true, s.color]);
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
          total[`p${si}`] = pct(totS[si], units.reduce((acc, u) => acc + (u.val[s.ds] || 0), 0));
        });
        if (n === 1) total.pc = 100;
        if (n === 2) total.d = totS[1] - totS[0];
      }
      const defKey = n ? "v0" : (eles.length > 1 ? `v_${eles.length - 1}` : "v");
      const k = state.sort.key && cols.some((c) => c[0] === state.sort.key) ? state.sort.key : defKey;
      const dir = state.sort.key ? state.sort.dir : -1;
      rows.sort((x, y) => {
        const a1 = x[k], b1 = y[k];
        if (typeof a1 === "number" || typeof b1 === "number") return ((a1 ?? -Infinity) - (b1 ?? -Infinity)) * dir;
        return String(a1).localeCompare(String(b1), "pt-BR") * dir;
      });
      rows.forEach((r) => { r._lab = lvl === "cidades" ? r.m : (showMun && lvl !== "regioes" ? `${r.b} (${r.m})` : r.b); });
    }
    if (!rows.length && !state.detail) sub = "Nada a mostrar neste recorte" + (involved().every((id) => onlyCapital(D(id))) ? " — as eleições selecionadas cobrem só Campo Grande." : ".");

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
  const cssVar = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  function renderChart() {
    if (!window.Chart) { $("#chartSub").textContent = "Não foi possível carregar a biblioteca de gráficos."; return; }
    const all = state.rows.filter((r) => !r._total), rows = all.slice(0, CHART_MAX);
    const n = state.series.length, m = state.metric, eles = involved();
    const labels = rows.map((r) => r._lab ?? r.b ?? r.m);
    let datasets;
    if (state.detail) {
      datasets = [{ label: m === "p" ? "% dos válidos" : "Votos", data: rows.map((r) => r[m === "p" ? "p" : "v"] ?? 0), backgroundColor: cssVar("--accent") || "#0f6b4f", borderRadius: 3 }];
    } else if (!n) {
      if (eles.length > 1 && m === "v") {
        const pal = ["#94a3b8", "#64748b", "#0ea5e9", "#0f6b4f", "#f59e0b", "#7c3aed"];
        datasets = eles.map((id, k) => ({ label: `Válidos · ${label(id)}`, data: rows.map((r) => r[`v_${k}`] ?? 0), backgroundColor: pal[k % pal.length], borderRadius: 3 }));
      } else {
        datasets = [{ label: m === "p" ? `% do total de válidos · ${label(principal())}` : "Votos válidos", data: rows.map((r) => (m === "p" ? r.p : (r.v ?? r.v_chart)) ?? 0), backgroundColor: cssVar("--accent") || "#0f6b4f", borderRadius: 3 }];
      }
    } else {
      datasets = state.series.map((s, si) => ({
        label: `${shortName(seriesName(s))}${involved().length > 1 ? " · " + label(s.ds) : ""}`,
        data: rows.map((r) => r[(m === "p" ? "p" : "v") + si] ?? 0), backgroundColor: s.color, borderRadius: 3,
      }));
    }
    $("#chartTitulo").textContent = "Gráfico · " + $("#detTitulo").textContent;
    $("#chartSub").textContent = all.length > CHART_MAX
      ? `Mostrando as ${CHART_MAX} primeiras linhas, na ordem da tabela (clique no cabeçalho da tabela para mudar a ordem).`
      : "Mesmas linhas e ordem da tabela.";
    const ink = cssVar("--muted") || "#66706b", grid = cssVar("--line") || "#e2e5e0";
    if (chart) chart.destroy();
    chart = new window.Chart($("#chart"), {
      type: "bar", data: { labels, datasets },
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
    });
  }

  // ------------------------------------------------------ ajustes de nomes
  function openAjustes() { renderAjustes(); $("#dlgAjustes").showModal(); $("#ajBusca").focus(); }
  function renderAjustes() {
    const q = normName($("#ajBusca").value), so = $("#ajSoAjustados").checked;
    const people = [];
    state.persons.forEach((lst, k) => {
      const ref = lst[lst.length - 1], c = D(ref.ds).candByNr.get(ref.nr);
      const urna = lst.map((p) => D(p.ds).candByNr.get(p.nr)?.[4]).find(Boolean) || "";
      const aj = state.apelidosLocal[k] || state.apelidos[k] || "";
      if (so && !aj) return;
      if (q && !(k.includes(q) || normName(urna).includes(q) || normName(aj).includes(q) || lst.some((p) => p.nr.startsWith(q)))) return;
      const best = Math.max(...lst.map((p) => p.v));
      people.push({ k, nome: c[1], urna, aj, eles: lst, best });
    });
    people.sort((a, b) => b.best - a.best);
    $("#ajTabela tbody").innerHTML = people.slice(0, 200).map((p) =>
      `<tr><td class="small">${p.eles.map((e) => esc(label(e.ds)) + " · " + e.nr).join("<br>")}</td><td>${esc(p.nome)}</td><td>${esc(p.urna || "—")}</td>` +
      `<td><input data-k="${esc(p.k)}" class="${p.aj ? "set" : ""}" value="${esc(p.aj)}" placeholder="${esc(p.urna || p.nome)}"></td></tr>`).join("") ||
      `<tr><td colspan="4" class="muted">Nenhum candidato encontrado.</td></tr>`;
  }
  function saveApelido(k, v) {
    v = v.trim();
    if (v) state.apelidosLocal[k] = v; else delete state.apelidosLocal[k];
    lsSet(LS_KEY, state.apelidosLocal);
  }
  $("#btnAjustes").addEventListener("click", openAjustes);
  $("#ajBusca").addEventListener("input", renderAjustes);
  $("#ajSoAjustados").addEventListener("change", renderAjustes);
  $("#ajTabela").addEventListener("change", (e) => {
    const inp = e.target.closest("input[data-k]"); if (!inp) return;
    saveApelido(inp.dataset.k, inp.value); inp.classList.toggle("set", !!inp.value.trim());
  });
  $("#dlgAjustes").addEventListener("close", () => renderAll(false));
  $("#ajExportar").addEventListener("click", () => {
    const out = { ...state.apelidos, ...state.apelidosLocal };
    const blob = new Blob([JSON.stringify(out, null, 1)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "apelidos.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $("#ajImportar").addEventListener("click", () => $("#ajArquivo").click());
  $("#ajArquivo").addEventListener("change", async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { const obj = JSON.parse(await f.text()); Object.entries(obj).forEach(([k, v]) => saveApelido(k, String(v))); renderAjustes(); toast("Ajustes importados."); }
    catch (err) { toast("Arquivo inválido: use um apelidos.json exportado por aqui."); }
    e.target.value = "";
  });

  // -------------------------------------------------------------- ações
  function focus(locs) {
    const ll = locs.map(([id, i]) => D(id).locais[i]).filter((l) => l[L.LAT] != null).map((l) => [l[L.LAT], l[L.LON]]);
    if (ll.length) map.fitBounds(ll, { padding: [40, 40], maxZoom: 16 });
  }

  function updateHash() {
    const p = new URLSearchParams();
    p.set("e", selEleicoes().join(","));
    if (state.series.length) p.set("s", state.series.map((s) => `${s.ds}:${s.nr}`).join(","));
    if (state.scope !== "estado") p.set("g", state.scope);
    if (state.level !== "cidades") p.set("n", state.level);
    if (state.levelCap !== "regioes") p.set("nc", state.levelCap);
    if (state.muns.size) p.set("mu", [...state.muns].join("|"));
    if (state.partidos.size) p.set("pa", [...state.partidos].join(","));
    if (state.metric !== "v") p.set("m", state.metric);
    history.replaceState(null, "", "#" + p.toString());
  }

  function exportCSV() {
    const strip = (h) => h.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    const lines = [state.cols.map((c) => strip(c[1])), ...state.rows.map((r) => state.cols.map(([k]) => {
      const v = r[k];
      return typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : v ?? "";
    }))].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `votacao_${selEleicoes().join("-")}_${state.scope}_${effLevel()}${state.series.length ? "_comparacao" : ""}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------- eventos
  msEleicao.onChange((sel) => {
    state.eleicoes = sel.size ? sel : new Set(state.datasets.map((d) => d.id));
    state.detail = null; state.sort = { key: null, dir: -1 };
    renderAll(true);
  });
  msMun.onChange((sel) => { state.muns = sel; state.detail = null; state.sort = { key: null, dir: -1 }; renderAll(true); });
  msPartido.onChange((sel) => { state.partidos = sel; renderCandList(); updateHash(); });
  $("#listaCand").addEventListener("click", (e) => { const li = e.target.closest("li[data-nr]"); if (li) addSeries(li.dataset.ds, li.dataset.nr); });
  $("#chips").addEventListener("click", (e) => {
    const rm = e.target.closest("[data-rm]"), ad = e.target.closest("[data-add]");
    if (rm) { state.series.splice(+rm.dataset.rm, 1); renderAll(false); }
    else if (ad) { const [d, nr] = ad.dataset.add.split(":"); addSeries(d, nr); }
  });
  $("#limpar").addEventListener("click", () => { state.series = []; renderAll(false); });
  $("#fBusca").addEventListener("input", (e) => { state.busca = e.target.value; renderCandList(); });
  $("#segScope").addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b || b.disabled) return;
    state.scope = b.dataset.v; state.muns.clear(); state.detail = null; state.sort = { key: null, dir: -1 }; renderAll(true);
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
    if (r._nr) { addSeries(r._ds, r._nr); return; }
    if (r._u) onUnit(r._u);
  });

  init();
})();
