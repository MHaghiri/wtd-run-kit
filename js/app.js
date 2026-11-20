/* WTD Run Kit — front end. Builds a zip in the browser; no server needed. */
(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const CONUS = { south: 24.5, north: 49.5, west: -125.0, east: -66.5 };

  // ---------- Map ----------
  const map = L.map("map").setView([39.2, -105.25], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const drawn = new L.FeatureGroup().addTo(map);
  map.addControl(new L.Control.Draw({
    draw: { polyline: false, polygon: false, circle: false, marker: false, circlemarker: false, rectangle: { shapeOptions: { color: "#1f6f8b" } } },
    edit: { featureGroup: drawn, remove: false },
  }));

  let rect = null;
  function setRect(bounds) {
    if (rect) drawn.removeLayer(rect);
    rect = L.rectangle(bounds, { color: "#1f6f8b", weight: 2 });
    drawn.addLayer(rect);
  }
  function boundsToInputs(b) {
    $("south").value = b.getSouth().toFixed(4);
    $("north").value = b.getNorth().toFixed(4);
    $("west").value = b.getWest().toFixed(4);
    $("east").value = b.getEast().toFixed(4);
    update();
  }
  map.on(L.Draw.Event.CREATED, (e) => { setRect(e.layer.getBounds()); boundsToInputs(e.layer.getBounds()); map.fitBounds(e.layer.getBounds(), { padding: [20, 20] }); });
  map.on(L.Draw.Event.EDITED, (e) => e.layers.eachLayer((l) => boundsToInputs(l.getBounds())));

  ["south", "north", "west", "east"].forEach((id) => $(id).addEventListener("change", () => {
    const c = readConfig();
    if (c.valid) setRect([[c.south, c.west], [c.north, c.east]]);
    update();
  }));

  // ---------- Model choice ----------
  document.querySelectorAll("input[name=model]").forEach((r) => r.addEventListener("change", () => {
    document.querySelectorAll(".opts").forEach((o) => { o.hidden = o.dataset.for !== currentModel(); });
    update();
  }));
  document.querySelectorAll(".opts input, #runname").forEach((i) => i.addEventListener("input", update));

  function currentModel() { return document.querySelector("input[name=model]:checked").value; }

  function readConfig() {
    const n = (id) => parseFloat($(id).value);
    const c = {
      model: currentModel(),
      runname: ($("runname").value || "my_wtd_run").trim().replace(/[^A-Za-z0-9_-]+/g, "_"),
      south: n("south"), north: n("north"), west: n("west"), east: n("east"),
      pf: { start: $("pf-start").value, end: $("pf-end").value, p: parseInt($("pf-p").value, 10) || 1, q: parseInt($("pf-q").value, 10) || 1 },
      mf: { cell: n("mf-cell"), k: n("mf-k"), rch: n("mf-rch"), thk: n("mf-thk") },
    };
    c.valid = [c.south, c.north, c.west, c.east].every(Number.isFinite) && c.north > c.south && c.east > c.west &&
      c.south >= -90 && c.north <= 90 && c.west >= -180 && c.east <= 180;
    const midLat = (c.south + c.north) / 2;
    c.widthKm = (c.east - c.west) * 111.32 * Math.cos(midLat * Math.PI / 180);
    c.heightKm = (c.north - c.south) * 110.57;
    c.areaKm2 = c.widthKm * c.heightKm;
    c.inConus = c.south >= CONUS.south && c.north <= CONUS.north && c.west >= CONUS.west && c.east <= CONUS.east;
    return c;
  }

  function fmt(x) { return Math.round(x).toLocaleString(); }

  function update() {
    const c = readConfig();
    const area = $("area-info"), size = $("size-info"), btn = $("download");
    area.className = "info"; size.className = "info";
    if (!c.valid) {
      area.textContent = "Bounds are not valid (north must be > south, east > west).";
      area.className = "info warn"; btn.disabled = true; renderList(null); return;
    }
    btn.disabled = false;
    area.textContent = `Region ≈ ${c.widthKm.toFixed(1)} km × ${c.heightKm.toFixed(1)} km (${fmt(c.areaKm2)} km²).`;

    let msg = "", warn = false;
    if (c.model === "parflow") {
      const cols = c.areaKm2; // CONUS2 grid is 1 km
      const cells = cols * 10;
      msg = `≈ ${fmt(cols)} columns × 10 layers = ${fmt(cells)} cells on the 1 km CONUS2 grid. `;
      if (!c.inConus) { msg += "⚠ Region is outside the contiguous US — ParFlow-CONUS2 data won't cover it. Choose MODFLOW or the global map instead."; warn = true; }
      else if (cols < 400) msg += "Small domain: a laptop is fine.";
      else if (cols < 20000) msg += "Medium domain: a workstation with several cores is recommended (raise P × Q).";
      else { msg += "⚠ Large domain: plan to run on a cluster (HPC)."; warn = true; }
      if (c.pf.start && c.pf.end && c.pf.end <= c.pf.start) { msg += " ⚠ End date must be after start date."; warn = true; }
    } else if (c.model === "modflow") {
      const cell = c.mf.cell > 0 ? c.mf.cell : 250;
      const cells = (c.widthKm * 1000 / cell) * (c.heightKm * 1000 / cell);
      msg = `≈ ${fmt(cells)} grid cells at ${cell} m. `;
      if (cells > 1e6) { msg += "⚠ Very large: increase the cell size (the script also coarsens automatically above 1 M cells)."; warn = true; }
      else if (cells > 2.5e5) msg += "Expect minutes to an hour on a laptop.";
      else msg += "Should run in seconds to minutes on a laptop.";
      msg += c.inConus ? " US region: the DEM is downloaded automatically (USGS 3DEP)." : " Outside the US: you will supply a DEM GeoTIFF (instructions in the README).";
    } else {
      msg = "No simulation needed — the script clips the published global map (~1 km) to your region.";
    }
    size.textContent = msg;
    if (warn) size.className = "info warn";
    renderList(c);
  }

  function renderList(c) {
    const ul = $("file-list");
    ul.innerHTML = "";
    if (!c) return;
    Object.keys(WTDTemplates.build(c)).forEach((f) => {
      const li = document.createElement("li"); li.textContent = `${c.runname}/${f}`; ul.appendChild(li);
    });
  }

  // ---------- Download ----------
  $("download").addEventListener("click", async () => {
    const c = readConfig();
    if (!c.valid) return;
    const files = WTDTemplates.build(c);
    const zip = new JSZip();
    const folder = zip.folder(c.runname);
    Object.entries(files).forEach(([name, content]) => folder.file(name, content));
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${c.runname}_${c.model}_kit.zip`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });

  // initial state
  const c0 = readConfig();
  setRect([[c0.south, c0.west], [c0.north, c0.east]]);
  update();
})();
