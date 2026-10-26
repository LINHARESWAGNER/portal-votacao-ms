/* Portal de Votação MS — lê os JSON gerados por pipeline/build.py */
(() => {
  "use strict";

  // índices do array de locais (ver build.py)
  const L = { ID: 0, NOME: 1, END: 2, BAIRRO: 3, MUN: 4, LAT: 5, LON: 6, ELEIT: 7, SECOES: 8, VALIDOS: 9, BRANCOS: 10, NULOS: 11, TOP: 12 };
  const TODOS = "__todos__";

  const $ = (s) => document.querySelector(s);
  const fmt = new Intl.NumberFormat("pt-BR");
  const pct = (a, b) => (b ? (100 * a / b) : 0);
  const fmtPct = (x) => x.toLocaleString("pt-BR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + "%";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const state = {
    datasets: [], ds: null,
    locais: [], candidatos: [], candByNr: new Map(), partidos: [], partidoNome: new Map(),
    bairros: [], municipios: {},
    mun: TODOS, partido: TODOS, busca: "",
    cand: null, candVotes: null,          // Map(localIdx -> votos)
    bairroSel: null,                      // índice em state.bairros
    sort: { key: null, dir: -1 },
    rows: [], cols: [],
  };

  // ------------------------------------------------------------------ mapa
  const map = L_map();
  function L_map() {
    const m = window.L.map("map", { preferCanvas: true, zoomControl: true }).setView([-20.47, -54.62], 12);
    window.L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(m);
    return m;
  }
  const layer = window.L.layerGroup().addTo(map);
  const markers = new Map(); // localIdx -> circleMarker

  const ramp = (t) => { // 0..1 -> laranja claro..escuro
    const a = [253, 231, 214], b = [194, 65, 12];
    const c = a.map((v, i) => Math.round(v + (b[i] - v) * Math.min(1, Math.max(0, t))));
    return `rgb(${c.join(",")})`;
  };

  // ------------------------------------------------------------------ dados
  async function getJSON(path) {
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
    return r.json();
  }

  async function init() {
    try {
      state.datasets = await getJSON("data/datasets.json");
    } catch (e) {
      loading("Sem dados ainda. Rode pipeline/build.py e sirva a pasta web/ por um servidor HTTP.");
      return;
    }
    if (!state.datasets.length) { loading("Nenhum conjunto de dados gerado ainda."); return; }
    const tabs = $("#tabs");
    tabs.innerHTML = state.datasets.map((d) => `<button data-id="${d.id}" aria-pressed="false">${esc(d.titulo)}</button>`).join("");
    tabs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) loadDataset(b.dataset.id); });
    const fromHash = new URLSearchParams(location.hash.slice(1));
    const start = state.datasets.find((d) => d.id === fromHash.get("e")) || state.datasets[0];
    await loadDataset(start.id, fromHash.get("c"));
  }

  async function loadDataset(id, candInicial) {
    loading("Carregando…");
    const base = `data/${id}/`;
    const [locais, candidatos, partidos, bairros, municipios] = await Promise.all(
      ["locais", "candidatos", "partidos", "bairros", "municipios"].map((n) => getJSON(base + n + ".json")));
    Object.assign(state, {
      ds: state.datasets.find((d) => d.id === id), locais, candidatos, partidos, bairros, municipios,
      mun: TODOS, partido: TODOS, busca: "", cand: null, candVotes: null, bairroSel: null, sort: { key: null, dir: -1 },
    });
    state.candByNr = new Map(candidatos.map((c) => [c[0], c]));
    state.partidoNome = new Map(partidos.map((p) => [p[0], p[1]]));
    document.querySelectorAll("#tabs button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.id === id)));

    const muns = Object.keys(municipios).sort((a, b) => a.localeCompare(b, "pt-BR"));
    $("#fMun").innerHTML = (muns.length > 1 ? `<option value="${TODOS}">Todos (${muns.length})</option>` : "") +
      muns.map((m) => `<option>${esc(m)}</option>`).join("");
    if (muns.length === 1) state.mun = muns[0];
    $("#fMun").disabled = muns.length === 1;
    $("#fPartido").innerHTML = `<option value="${TODOS}">Todos</option>` +
      partidos.map((p) => `<option value="${p[0]}">${esc(p[1])} (${p[0]})</option>`).join("");
    $("#fBusca").value = "";

    drawMarkers(true);
    renderAll();
    if (candInicial && state.candByNr.has(candInicial)) await selectCand(candInicial);
    loading(null);
  }

  function loading(msg) { const el = $("#loading"); el.hidden = !msg; if (msg) el.textContent = msg; }

  // -------------------------------------------------------------- filtros
  const localVisible = (i) => state.mun === TODOS || state.locais[i][L.MUN] === state.mun;

  function candTotals() {
    // ranking de candidatos no recorte atual
    if (state.mun === TODOS) return state.candidatos.map((c) => [c[0], c[3]]);
    return state.municipios[state.mun] || [];
  }

  // ------------------------------------------------------------- render
  function renderAll() { renderKPIs(); renderCandList(); renderTable(); renderLegend(); updateHash(); }

  function renderKPIs() {
    let validos = 0, eleit = 0, nLoc = 0, brancos = 0, nulos = 0;
    state.locais.forEach((l, i) => {
      if (!localVisible(i)) return;
      nLoc++; validos += l[L.VALIDOS]; eleit += l[L.ELEIT]; brancos += l[L.BRANCOS]; nulos += l[L.NULOS];
    });
    let k;
    if (state.cand) {
      const c = state.candByNr.get(state.cand);
      let v = 0, nLocVotou = 0;
      state.candVotes.forEach((q, i) => { if (localVisible(i)) { v += q; nLocVotou++; } });
      k = [[fmt.format(v), "votos de " + c[1].split(" ")[0]], [fmtPct(pct(v, validos)), "dos votos válidos"],
        [fmt.format(nLocVotou), "locais com voto"], [fmt.format(nLoc), "locais no recorte"]];
    } else {
      k = [[fmt.format(validos), "votos válidos"], [fmt.format(eleit), "eleitores aptos"],
        [fmt.format(nLoc), "locais de votação"], [fmt.format(brancos + nulos), "brancos + nulos"]];
    }
    $("#kpis").innerHTML = k.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join("");
  }

  function renderCandList() {
    const q = state.busca.trim().toLowerCase();
    const items = candTotals().filter(([nr]) => {
      const c = state.candByNr.get(nr); if (!c) return false;
      if (state.partido !== TODOS && c[2] !== state.partido) return false;
      if (q && !(c[1].toLowerCase().includes(q) || nr.startsWith(q))) return false;
      return true;
    }).slice(0, 300);
    $("#listaCand").innerHTML = items.map(([nr, v], i) => {
      const c = state.candByNr.get(nr);
      const sigla = state.partidoNome.get(c[2]) || c[2];
      return `<li data-nr="${nr}" class="${nr === state.cand ? "sel" : ""}"><span class="pos">${i + 1}</span>` +
        `<span class="nm" title="${esc(c[1])}">${esc(c[1])}<small>${esc(nr.length > 2 ? nr + " · " + sigla : sigla)}</small></span>` +
        `<span class="v">${fmt.format(v)}</span></li>`;
    }).join("") || `<li class="muted">Nenhum candidato encontrado.</li>`;
    $("#limpar").hidden = !state.cand;
  }

  function drawMarkers(fit) {
    layer.clearLayers(); markers.clear();
    const pts = [];
    let maxV = 1, maxShare = 0.0001;
    state.locais.forEach((l, i) => {
      if (!localVisible(i) || l[L.LAT] == null) return;
      if (state.cand) {
        const v = state.candVotes.get(i) || 0;
        maxV = Math.max(maxV, v); maxShare = Math.max(maxShare, pct(v, l[L.VALIDOS]));
      } else maxV = Math.max(maxV, l[L.VALIDOS]);
    });
    state.shareMax = maxShare;
    state.locais.forEach((l, i) => {
      if (!localVisible(i) || l[L.LAT] == null) return;
      let opts;
      if (state.cand) {
        const v = state.candVotes.get(i) || 0;
        const share = pct(v, l[L.VALIDOS]);
        opts = {
          radius: v ? 3 + 14 * Math.sqrt(v / maxV) : 2.5,
          fillColor: v ? ramp(share / maxShare) : "#9aa49f",
          color: v ? "#7c2d12" : "#9aa49f", weight: v ? 0.6 : 0, fillOpacity: v ? 0.85 : 0.35,
        };
      } else {
        opts = { radius: 3 + 12 * Math.sqrt(l[L.VALIDOS] / maxV), fillColor: "#0f6b4f", color: "#0b4f3a", weight: 0.6, fillOpacity: 0.55 };
      }
      const mk = window.L.circleMarker([l[L.LAT], l[L.LON]], opts);
      mk.bindPopup(() => popupHtml(i), { maxWidth: 320 });
      mk.addTo(layer); markers.set(i, mk); pts.push([l[L.LAT], l[L.LON]]);
    });
    if (fit && pts.length) map.fitBounds(pts, { padding: [24, 24], maxZoom: 14 });
  }

  function popupHtml(i) {
    const l = state.locais[i];
    let extra = "";
    if (state.cand) {
      const v = state.candVotes.get(i) || 0;
      const c = state.candByNr.get(state.cand);
      extra = `<p><b>${esc(c[1])}</b>: ${fmt.format(v)} votos (${fmtPct(pct(v, l[L.VALIDOS]))} do local)</p>`;
    }
    const top = l[L.TOP].map(([nr, v]) => {
      const c = state.candByNr.get(nr);
      return `<tr><td>${esc(c ? c[1] : nr)}</td><td class="n">${fmt.format(v)}</td><td class="n">${fmtPct(pct(v, l[L.VALIDOS]))}</td></tr>`;
    }).join("");
    return `<div class="pop"><h3>${esc(l[L.NOME])}</h3><div class="addr">${esc(l[L.END])}<br>${esc(l[L.BAIRRO])} · ${esc(l[L.MUN])}</div>` +
      `<div>${fmt.format(l[L.ELEIT])} eleitores · ${l[L.SECOES]} seções · ${fmt.format(l[L.VALIDOS])} votos válidos</div>${extra}` +
      `<table>${top}</table></div>`;
  }

  function renderLegend() {
    const el = $("#legend");
    if (state.cand) {
      el.innerHTML = `<b>${esc(state.candByNr.get(state.cand)[1])}</b><div class="bar"></div>` +
        `<div class="ends"><span>0%</span><span>${fmtPct(state.shareMax || 0)} dos válidos</span></div>` +
        `<div class="muted">Tamanho = nº de votos no local</div>`;
    } else {
      const sem = state.locais.filter((l, i) => localVisible(i) && l[L.LAT] == null).length;
      el.innerHTML = `<b>Locais de votação</b><div class="muted">Tamanho = votos válidos. Clique para ver o ranking do local.</div>` +
        (sem ? `<div class="muted">${sem} locais sem coordenada no cadastro do TSE</div>` : "");
    }
  }

  // ------------------------------------------------------------- tabela
  function bairroVisible(b) { return state.mun === TODOS || b.m === state.mun; }

  function renderTable() {
    const showMun = state.mun === TODOS;
    let cols, rows, titulo, sub;
    if (state.bairroSel != null) {
      const b = state.bairros[state.bairroSel];
      titulo = b.b; sub = `${b.m} · ${b.l.length} locais · ${fmt.format(b.v)} votos válidos · ← clique no título "Bairros" para voltar`;
      cols = [["pos", "#", true], ["nome", "Candidato"], ["part", "Partido"], ["v", "Votos", true], ["p", "% bairro", true]];
      rows = b.top.map(([nr, v], i) => {
        const c = state.candByNr.get(nr) || [nr, nr, nr.slice(0, 2)];
        return { pos: i + 1, nome: c[1], part: state.partidoNome.get(c[2]) || c[2], v, p: pct(v, b.v), _nr: nr };
      });
      // lista de locais do bairro abaixo
      b.l.forEach((li) => {
        const l = state.locais[li];
        rows.push({ pos: "", nome: "📍 " + l[L.NOME], part: "local", v: l[L.VALIDOS], p: null, _local: li });
      });
    } else if (state.cand) {
      const c = state.candByNr.get(state.cand);
      titulo = "Bairros · " + c[1];
      sub = "Onde o candidato teve mais votos. % bairro = participação nos votos válidos do bairro.";
      let total = 0; state.candVotes.forEach((q, i) => { if (localVisible(i)) total += q; });
      cols = [...(showMun ? [["m", "Município"]] : []), ["b", "Bairro"], ["v", "Votos", true], ["p", "% bairro", true], ["pc", "% do cand.", true]];
      rows = [];
      state.bairros.forEach((b, bi) => {
        if (!bairroVisible(b)) return;
        let v = 0; b.l.forEach((li) => { v += state.candVotes.get(li) || 0; });
        if (v) rows.push({ m: b.m, b: b.b, v, p: pct(v, b.v), pc: pct(v, total), _bi: bi });
      });
      if (!state.sort.key) rows.sort((a, z) => z.v - a.v);
    } else {
      titulo = "Bairros"; sub = "Clique em um bairro para ver o ranking completo, ou escolha um candidato à esquerda.";
      cols = [...(showMun ? [["m", "Município"]] : []), ["b", "Bairro"], ["nl", "Locais", true], ["v", "Válidos", true], ["lider", "Mais votado"], ["lv", "Votos", true]];
      rows = [];
      state.bairros.forEach((b, bi) => {
        if (!bairroVisible(b)) return;
        const [nr, lv] = b.top[0] || ["", 0];
        const c = state.candByNr.get(nr);
        rows.push({ m: b.m, b: b.b, nl: b.l.length, v: b.v, lider: c ? c[1] : "—", lv, _bi: bi });
      });
      if (!state.sort.key) rows.sort((a, z) => z.v - a.v);
    }
    if (state.sort.key && cols.some((c) => c[0] === state.sort.key) && state.bairroSel == null) {
      const k = state.sort.key, d = state.sort.dir;
      rows.sort((a, z) => (typeof a[k] === "number" ? (a[k] - z[k]) : String(a[k]).localeCompare(String(z[k]), "pt-BR")) * d);
    }
    state.rows = rows; state.cols = cols;
    $("#detTitulo").textContent = titulo;
    $("#detTitulo").style.cursor = state.bairroSel != null ? "pointer" : "default";
    $("#detSub").textContent = sub;
    const maxP = Math.max(1, ...rows.map((r) => r.p || 0));
    $("#tabela thead").innerHTML = "<tr>" + cols.map(([k, t, n]) => `<th data-k="${k}" class="${n ? "n" : ""}">${t}</th>`).join("") + "</tr>";
    $("#tabela tbody").innerHTML = rows.slice(0, 1500).map((r, ri) => "<tr data-ri=\"" + ri + "\">" + cols.map(([k, , n]) => {
      let v = r[k];
      if (k === "p" || k === "pc") v = v == null ? "" : (k === "p" ? `<span class="pct-bar" style="width:${Math.round(30 * v / maxP)}px"></span>` : "") + fmtPct(v);
      else if (n && typeof v === "number") v = fmt.format(v);
      else v = esc(v);
      return `<td class="${n ? "n" : ""}">${v}</td>`;
    }).join("") + "</tr>").join("");
  }

  // -------------------------------------------------------------- ações
  async function selectCand(nr) {
    if (!nr || nr === state.cand) { state.cand = null; state.candVotes = null; }
    else {
      loading("Carregando votos…");
      const rows = await getJSON(`data/${state.ds.id}/cand/${nr}.json`);
      state.cand = nr; state.candVotes = new Map(rows);
      loading(null);
    }
    state.bairroSel = null; state.sort = { key: null, dir: -1 };
    drawMarkers(false); renderAll();
  }

  function focusLocais(idxs) {
    const pts = idxs.map((i) => state.locais[i]).filter((l) => l[L.LAT] != null).map((l) => [l[L.LAT], l[L.LON]]);
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 16 });
  }

  function updateHash() {
    const p = new URLSearchParams();
    if (state.ds) p.set("e", state.ds.id);
    if (state.cand) p.set("c", state.cand);
    history.replaceState(null, "", "#" + p.toString());
  }

  function exportCSV() {
    const head = state.cols.map((c) => c[1]);
    const lines = [head, ...state.rows.map((r) => state.cols.map(([k]) => {
      const v = r[k];
      return typeof v === "number" ? String(Math.round(v * 100) / 100).replace(".", ",") : v ?? "";
    }))].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(";"));
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.ds.id}${state.cand ? "_" + state.cand : ""}${state.bairroSel != null ? "_bairro" : ""}.csv`;
    a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  // ------------------------------------------------------------- eventos
  $("#listaCand").addEventListener("click", (e) => { const li = e.target.closest("li[data-nr]"); if (li) selectCand(li.dataset.nr); });
  $("#limpar").addEventListener("click", () => selectCand(null));
  $("#fBusca").addEventListener("input", (e) => { state.busca = e.target.value; renderCandList(); });
  $("#fPartido").addEventListener("change", (e) => { state.partido = e.target.value; renderCandList(); });
  $("#fMun").addEventListener("change", (e) => { state.mun = e.target.value; state.bairroSel = null; drawMarkers(true); renderAll(); });
  $("#csv").addEventListener("click", exportCSV);
  $("#detTitulo").addEventListener("click", () => { if (state.bairroSel != null) { state.bairroSel = null; renderTable(); } });
  $("#tabela thead").addEventListener("click", (e) => {
    const th = e.target.closest("th"); if (!th || state.bairroSel != null) return;
    const k = th.dataset.k;
    state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : (th.classList.contains("n") ? -1 : 1) };
    renderTable();
  });
  $("#tabela tbody").addEventListener("click", (e) => {
    const tr = e.target.closest("tr"); if (!tr) return;
    const r = state.rows[+tr.dataset.ri];
    if (r._bi != null) { state.bairroSel = r._bi; renderTable(); focusLocais(state.bairros[r._bi].l); }
    else if (r._local != null) { focusLocais([r._local]); markers.get(r._local)?.openPopup(); }
    else if (r._nr) selectCand(r._nr);
  });

  init();
})();
