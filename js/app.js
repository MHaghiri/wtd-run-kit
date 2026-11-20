/* WTD Run Kit — website logic: catalog, chart, table, map builder, zip download. */
(function () {
  "use strict";
  const { MODELS, COVERAGE } = window.WTDModels;
  const $ = (id) => document.getElementById(id);
  const byId = Object.fromEntries(MODELS.map((m) => [m.id, m]));
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  let current = byId.parflow;

  // ================================================================ catalog
  function renderCards(filter) {
    const grid = $("model-grid");
    grid.innerHTML = "";
    MODELS.filter((m) => filter === "all"
      || (filter === "Regional" ? (m.scale === "Regional" || m.scale === "Any region") : m.scale === filter)
      || m.access.includes(filter))
      .forEach((m) => {
        const el = document.createElement("article");
        el.className = "mcard";
        el.style.setProperty("--c", m.color);
        el.innerHTML = `
          <div class="top"><div><h3>${esc(m.name)}</h3><p class="auth">${esc(m.authors)}</p></div>
          <span class="scale">${esc(m.scale)}</span></div>
          <p class="blurb">${esc(m.blurb)}</p>
          <dl class="meta">
            <dt>Coverage</dt><dd>${esc(COVERAGE[m.coverage].label)}</dd>
            <dt>Resolution</dt><dd>${esc(m.resolution)}</dd>
            <dt>Approach</dt><dd>${esc(m.approach)}</dd>
          </dl>
          <div class="foot">
            <div>${m.access.includes("run") ? '<span class="tag run">Run model</span> ' : ""}${m.access.includes("data") ? '<span class="tag data">Get results</span>' : ""}</div>
            <button class="use" data-id="${m.id}">Use this model →</button>
          </div>
          <div class="links small">${m.code ? `<a href="${m.code}" target="_blank" rel="noopener">Code ↗</a>` : ""}${m.data ? `<a href="${m.data}" target="_blank" rel="noopener">Data / paper ↗</a>` : ""}</div>`;
        grid.appendChild(el);
      });
    grid.querySelectorAll(".use").forEach((b) => b.addEventListener("click", () => {
      selectModel(b.dataset.id);
      $("build").scrollIntoView({ behavior: "smooth" });
    }));
  }
  document.querySelectorAll(".chip").forEach((c) => c.addEventListener("click", () => {
    document.querySelectorAll(".chip").forEach((x) => x.classList.remove("active"));
    c.classList.add("active");
    renderCards(c.dataset.filter);
  }));

  // ================================================================ table
  let sortKey = null, sortDir = 1;
  function renderTable() {
    const rows = MODELS.slice();
    if (sortKey) rows.sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])) * sortDir);
    $("model-table").querySelector("tbody").innerHTML = rows.map((m) => `
      <tr><td><span class="dot" style="background:${m.color}"></span><b>${esc(m.short)}</b></td>
      <td>${esc(m.scale === "Any region" ? "Any" : m.scale)} · ${esc(COVERAGE[m.coverage].label)}</td>
      <td>${esc(m.resolution)}</td><td>${esc(m.authors)}</td>
      <td class="yes">✓</td>
      <td>${m.code ? `<a href="${m.code}" target="_blank" rel="noopener">link</a>` : '<span class="no">—</span>'}</td>
      <td>${m.access.includes("data") ? `<a href="${m.data}" target="_blank" rel="noopener">link</a>` : '<span class="no">run it</span>'}</td></tr>`).join("");
  }
  $("model-table").querySelectorAll("th[data-k]").forEach((th) => th.addEventListener("click", () => {
    sortDir = sortKey === th.dataset.k ? -sortDir : 1;
    sortKey = th.dataset.k;
    renderTable();
  }));

  // ================================================================ chart (resolution vs coverage)
  const AREA = { global: 1.35e8, na: 2.45e7, conus: 8.1e6, nz: 2.68e5 };
  function areaKm2(cov) {
    if (AREA[cov]) return AREA[cov];
    const c = COVERAGE[cov];
    const lat = (c.south + c.north) / 2;
    return Math.abs((c.east - c.west) * 111.32 * Math.cos(lat * Math.PI / 180) * (c.north - c.south) * 110.57);
  }
  function renderChart() {
    const pts = MODELS.filter((m) => m.resKm).map((m) => ({ m, x: areaKm2(m.coverage), y: m.resKm }));
    const W = 900, H = 340, P = { l: 70, r: 30, t: 20, b: 52 };
    const lx = (v) => Math.log10(v), xmin = 4.8, xmax = 8.5, ymin = -1, ymax = 1.3;
    const X = (v) => P.l + (lx(v) - xmin) / (xmax - xmin) * (W - P.l - P.r);
    const Y = (v) => P.t + (lx(v) - ymin) / (ymax - ymin) * (H - P.t - P.b);   // finer grid at top
    const nudge = { fan: [-16, -10], globgm: [14, 18], g3m: [-16, -10], degraaf: [14, 18], parflow: [14, -12], westerhoff: [14, -12] };
    const jitter = { fan: -9, globgm: 9, g3m: -9, degraaf: 9 };
    let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Scatter of model grid resolution against coverage area">`;
    [0.1, 1, 10].forEach((v) => {
      s += `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="#e3ebea"/>`;
      s += `<text x="${P.l - 10}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="#5c6e78">${v < 1 ? v * 1000 + " m" : v + " km"}</text>`;
    });
    [[1e5, "100k km²"], [1e6, "1M km²"], [1e7, "10M km²"], [1e8, "100M km²"]].forEach(([v, t]) => {
      s += `<line x1="${X(v)}" x2="${X(v)}" y1="${P.t}" y2="${H - P.b}" stroke="#eef3f2"/>`;
      s += `<text x="${X(v)}" y="${H - P.b + 18}" text-anchor="middle" font-size="12" fill="#5c6e78">${t}</text>`;
    });
    [["New Zealand", 2.7e5], ["Contiguous US", 8.1e6], ["Globe", 1.35e8]].forEach(([t, v]) => {
      s += `<text x="${X(v)}" y="${P.t + 12}" text-anchor="middle" font-size="11" fill="#9fb3ba" font-style="italic">${t}</text>`;
    });
    s += `<text x="${(W + P.l) / 2}" y="${H - 10}" text-anchor="middle" font-size="12.5" fill="#15242e" font-weight="600">Coverage area (log scale)</text>`;
    s += `<text transform="translate(16 ${(H - P.b + P.t) / 2}) rotate(-90)" text-anchor="middle" font-size="12.5" fill="#15242e" font-weight="600">Grid size: finer ↑</text>`;
    pts.forEach(({ m, x, y }) => {
      const cx = X(x) + (jitter[m.id] || 0), cy = Y(y), [dx, dy] = nudge[m.id] || [10, -10];
      s += `<g class="pt" data-id="${m.id}" style="cursor:pointer">
        <circle cx="${cx}" cy="${cy}" r="9" fill="${m.color}" stroke="#fff" stroke-width="2.5"/>
        <text x="${cx + dx}" y="${cy + dy}" font-size="12.5" font-weight="600" fill="#15242e" text-anchor="${dx < 0 ? "end" : "start"}">${esc(m.short)}</text></g>`;
    });
    $("res-chart").innerHTML = s + "</svg>";
    const tip = $("tooltip");
    $("res-chart").querySelectorAll(".pt").forEach((g) => {
      const m = byId[g.dataset.id];
      g.addEventListener("mousemove", (e) => {
        tip.innerHTML = `<b>${esc(m.name)}</b><br>${esc(m.resolution)} · ${esc(COVERAGE[m.coverage].label)}<br><span style="opacity:.8">click to use</span>`;
        tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 14 + "px"; tip.style.opacity = 1;
      });
      g.addEventListener("mouseleave", () => { tip.style.opacity = 0; });
      g.addEventListener("click", () => { selectModel(m.id); $("build").scrollIntoView({ behavior: "smooth" }); });
    });
  }

  // ================================================================ map
  const map = L.map("map", { worldCopyJump: true }).setView([39.2, -105.25], 7);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "&copy; OpenStreetMap contributors" }).addTo(map);
  const drawn = new L.FeatureGroup().addTo(map);
  map.addControl(new L.Control.Draw({
    draw: { polyline: false, polygon: false, circle: false, marker: false, circlemarker: false, rectangle: { shapeOptions: { color: "#0b2e4a", weight: 2 } } },
    edit: { featureGroup: drawn, remove: false },
  }));
  let rect = null, covLayer = null;
  function setRect(bounds) {
    if (rect) drawn.removeLayer(rect);
    rect = L.rectangle(bounds, { color: "#0b2e4a", weight: 2, fillOpacity: 0.12 });
    drawn.addLayer(rect);
  }
  function drawCoverage() {
    if (covLayer) map.removeLayer(covLayer);
    const c = COVERAGE[current.coverage];
    if (current.coverage === "any") { covLayer = null; return; }
    covLayer = L.rectangle([[c.south, c.west], [c.north, c.east]],
      { color: current.color, weight: 1.5, dashArray: "6 5", fillColor: current.color, fillOpacity: 0.07, interactive: false }).addTo(map);
  }
  function boundsToInputs(b) {
    $("south").value = b.getSouth().toFixed(4); $("north").value = b.getNorth().toFixed(4);
    $("west").value = b.getWest().toFixed(4); $("east").value = b.getEast().toFixed(4);
    update();
  }
  map.on(L.Draw.Event.CREATED, (e) => { setRect(e.layer.getBounds()); boundsToInputs(e.layer.getBounds()); });
  map.on(L.Draw.Event.EDITED, (e) => e.layers.eachLayer((l) => boundsToInputs(l.getBounds())));
  ["south", "north", "west", "east"].forEach((id) => $(id).addEventListener("change", () => {
    const c = readConfig(); if (c.valid) setRect([[c.south, c.west], [c.north, c.east]]); update();
  }));
  document.querySelectorAll(".presets button").forEach((b) => b.addEventListener("click", () => {
    const [s, n, w, e] = b.dataset.box.split(",").map(Number);
    $("south").value = s; $("north").value = n; $("west").value = w; $("east").value = e;
    setRect([[s, w], [n, e]]); map.fitBounds([[s, w], [n, e]], { padding: [30, 30] }); update();
  }));

  // ================================================================ builder
  const sel = $("model-select");
  sel.innerHTML = MODELS.map((m) => `<option value="${m.id}">${esc(m.name)}</option>`).join("");
  sel.addEventListener("change", () => selectModel(sel.value));
  document.querySelectorAll(".opts input, .opts select, #runname").forEach((i) => i.addEventListener("input", update));

  function selectModel(id) {
    current = byId[id]; sel.value = id;
    document.querySelectorAll(".opts").forEach((o) => { o.hidden = o.dataset.for !== current.options; });
    const s = $("model-summary");
    s.style.setProperty("--c", current.color);
    s.innerHTML = `<b>${esc(current.short)}</b> · ${esc(current.authors)}
      <div class="row">${esc(COVERAGE[current.coverage].label)} · ${esc(current.resolution)}</div>
      <div class="row">${esc(current.runtime)}</div>`;
    drawCoverage(); update();
  }

  function readConfig() {
    const n = (id) => parseFloat($(id).value);
    const c = {
      runname: ($("runname").value || "my_wtd_run").trim().replace(/[^A-Za-z0-9_-]+/g, "_"),
      south: n("south"), north: n("north"), west: n("west"), east: n("east"),
      pf: { grid: $("pf-grid").value, start: $("pf-start").value, end: $("pf-end").value, p: parseInt($("pf-p").value, 10) || 1, q: parseInt($("pf-q").value, 10) || 1 },
      mf: { cell: n("mf-cell"), k: n("mf-k"), rch: n("mf-rch"), thk: n("mf-thk") },
    };
    c.valid = [c.south, c.north, c.west, c.east].every(Number.isFinite) && c.north > c.south && c.east > c.west
      && c.south >= -90 && c.north <= 90 && c.west >= -180 && c.east <= 180;
    const lat = (c.south + c.north) / 2;
    c.wKm = (c.east - c.west) * 111.32 * Math.cos(lat * Math.PI / 180);
    c.hKm = (c.north - c.south) * 110.57;
    c.area = c.wKm * c.hKm;
    return c;
  }
  const fmt = (x) => Math.round(x).toLocaleString();

  let buildTimer = null;
  function update() {
    const c = readConfig(), m = current, cov = COVERAGE[m.coverage];
    const area = $("area-info"), size = $("size-info"), btn = $("download");
    area.className = "info"; size.className = "info";
    if (!c.valid) { area.textContent = "⚠ Bounds are not valid (north > south and east > west)."; area.className = "info warn"; btn.disabled = true; return; }
    btn.disabled = false;
    area.textContent = `Region ≈ ${c.wKm.toFixed(1)} × ${c.hKm.toFixed(1)} km (${fmt(c.area)} km²).`;

    const inside = c.south >= cov.south && c.north <= cov.north && c.west >= cov.west && c.east <= cov.east;
    const msgs = [];
    let warn = false;
    if (!inside) { msgs.push(`⚠ Your box is outside ${m.short}'s coverage (${cov.label}). Pick another model or move the box.`); warn = true; }
    if (m.id === "parflow") {
      const cols = c.area / (c.pf.grid === "conus1" ? 1 : 1);
      msgs.push(`≈ ${fmt(cols)} columns × ${c.pf.grid === "conus1" ? 5 : 10} layers on the 1 km grid.`);
      if (cols > 20000) { msgs.push("Large domain: plan to run on a cluster (raise P × Q)."); warn = true; }
      else if (cols > 400) msgs.push("Medium domain: a multi-core workstation is recommended.");
      else msgs.push("Small domain: a laptop is fine.");
      if (c.pf.end <= c.pf.start) { msgs.push("⚠ End date must be after start date."); warn = true; }
    } else if (m.id === "modflow") {
      const cell = c.mf.cell > 0 ? c.mf.cell : 250, cells = (c.wKm * 1000 / cell) * (c.hKm * 1000 / cell);
      msgs.push(`≈ ${fmt(cells)} cells at ${cell} m. ${cells > 1e6 ? "The script will coarsen the grid automatically." : "Seconds to minutes on a laptop."}`);
    } else if (m.resKm) {
      msgs.push(`≈ ${fmt(Math.max(1, c.area / (m.resKm * m.resKm)))} cells on the published grid (${m.resolution}).`);
    }
    if (inside) msgs.unshift(`✓ Inside ${m.short} coverage (${cov.label}).`);
    if (!warn && inside) size.className = "info good";
    if (warn) size.className = "info warn";
    size.textContent = msgs.join(" ");
    clearTimeout(buildTimer);
    buildTimer = setTimeout(refreshPreview, 250);
  }

  // ---------------------------------------------------------------- files
  const cache = {};
  async function fetchText(path) {
    if (cache[path]) return cache[path];
    const r = await fetch(path, { cache: "no-cache" });
    if (!r.ok) throw new Error(`Could not load ${path} (HTTP ${r.status})`);
    return (cache[path] = await r.text());
  }
  let lastFiles = null, activeFile = "README.md";
  async function makeFiles() {
    const c = readConfig();
    return WTDKits.build(current, c, COVERAGE[current.coverage], fetchText);
  }
  async function refreshPreview() {
    try {
      lastFiles = await makeFiles();
      $("dl-msg").textContent = "";
    } catch (err) {
      $("dl-msg").textContent = "⚠ " + err.message + " (open the site through a web server, e.g. GitHub Pages or python -m http.server).";
      return;
    }
    const ul = $("file-list");
    const names = Object.keys(lastFiles).sort((a, b) => (a === "README.md" ? -1 : b === "README.md" ? 1 : a.localeCompare(b)));
    if (!lastFiles[activeFile]) activeFile = "README.md";
    ul.innerHTML = names.map((n) => `<li data-f="${esc(n)}" class="${n === activeFile ? "active" : ""}">${esc(n)}</li>`).join("");
    ul.querySelectorAll("li").forEach((li) => li.addEventListener("click", () => { activeFile = li.dataset.f; showFile(); ul.querySelectorAll("li").forEach((x) => x.classList.toggle("active", x === li)); }));
    showFile();
  }
  function showFile() { $("file-view").firstChild.textContent = lastFiles[activeFile] || ""; }

  $("download").addEventListener("click", async () => {
    const c = readConfig(); if (!c.valid) return;
    try {
      const files = await makeFiles();
      const zip = new JSZip(), folder = zip.folder(c.runname);
      Object.entries(files).forEach(([n, t]) => folder.file(n, t));
      const blob = await zip.generateAsync({ type: "blob" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${c.runname}_${current.id}_kit.zip`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $("dl-msg").textContent = `✓ ${a.download} downloaded: ${Object.keys(files).length} files. Start with README.md.`;
    } catch (err) { $("dl-msg").textContent = "⚠ " + err.message; }
  });

  // ================================================================ init
  $("stat-models").textContent = MODELS.length;
  renderCards("all"); renderTable(); renderChart();
  const c0 = readConfig(); setRect([[c0.south, c0.west], [c0.north, c0.east]]);
  selectModel("parflow");
})();
