/* WTD Run Kit — package templates.
 * WTDTemplates.build(config) returns { "relative/path": "file contents" }.
 * Scripts read their settings from config.json, so the Python files are static.
 */
(function (root) {
  "use strict";

  // ------------------------------------------------------------------ shared
  const PLOT_PY = String.raw`"""Plot a water table depth (WTD) array saved as .npy or a GeoTIFF.

Usage:
    python plot_wtd.py outputs/wtd.npy
    python plot_wtd.py outputs/wtd.tif
"""
import sys

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LogNorm


def load(path):
    if path.endswith(".npy"):
        return np.load(path), None
    import rioxarray  # noqa: F401  (registers .rio)
    import xarray as xr
    da = xr.open_dataarray(path, engine="rasterio").squeeze(drop=True)
    b = da.rio.bounds()
    return da.values.astype(float), (b[0], b[2], b[1], b[3])


def main(path):
    wtd, extent = load(path)
    wtd = np.where(np.isfinite(wtd), wtd, np.nan)
    shown = np.clip(wtd, 0.1, None)
    fig, ax = plt.subplots(figsize=(8, 6))
    origin = "lower" if path.endswith(".npy") and "parflow" in path else "upper"
    im = ax.imshow(shown, cmap="viridis_r", norm=LogNorm(vmin=0.1, vmax=max(1.0, np.nanpercentile(shown, 99))),
                   extent=extent, origin=origin)
    fig.colorbar(im, ax=ax, label="Water table depth (m below land surface, log scale)")
    from matplotlib.ticker import MaxNLocator
    ax.xaxis.set_major_locator(MaxNLocator(4))
    ax.yaxis.set_major_locator(MaxNLocator(5))
    if extent is None:
        ax.set_xlabel("grid column"); ax.set_ylabel("grid row")
    ax.set_title(f"Water table depth\nmedian {np.nanmedian(wtd):.1f} m, mean {np.nanmean(wtd):.1f} m")
    out = path.rsplit(".", 1)[0] + ".png"
    fig.savefig(out, dpi=150, bbox_inches="tight")
    print("Saved", out)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        sys.exit(__doc__)
    main(sys.argv[1])
`;

  const GITIGNORE = `outputs/
parflow_run/
mf6_run/
__pycache__/
*.pfb
*.dist
`;

  function configJson(c) {
    return JSON.stringify({
      runname: c.runname,
      model: c.model,
      bbox: { south: c.south, north: c.north, west: c.west, east: c.east },
      parflow: { start: c.pf.start, end: c.pf.end, P: c.pf.p, Q: c.pf.q, grid: "conus2" },
      modflow: { cell_size_m: c.mf.cell, k_m_per_day: c.mf.k, recharge_mm_per_yr: c.mf.rch, aquifer_thickness_m: c.mf.thk },
      created_with: "WTD Run Kit",
      created: new Date().toISOString(),
    }, null, 2) + "\n";
  }

  function bboxLine(c) {
    return `South ${c.south}, North ${c.north}, West ${c.west}, East ${c.east}`;
  }

  // ------------------------------------------------------------------ ParFlow
  const PF_ENV = `name: wtd-parflow
channels:
  - conda-forge
dependencies:
  - python=3.11
  - numpy
  - matplotlib
  - pip
  - pip:
      - hf_hydrodata
      - subsettools
      - pftools[all]
`;

  const PF_COMMON = String.raw`import json
import os


def load_config():
    with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")) as f:
        return json.load(f)


def register_hydroframe():
    """Register your HydroFrame API PIN (needed once per machine / 2 days).

    Set HF_EMAIL and HF_PIN environment variables, or run
    hf_hydrodata.register_api_pin("you@example.com", "1234") yourself first.
    """
    import hf_hydrodata as hf
    email, pin = os.environ.get("HF_EMAIL"), os.environ.get("HF_PIN")
    if email and pin:
        hf.register_api_pin(email, pin)
    else:
        print("HF_EMAIL / HF_PIN not set - assuming your PIN is already registered.")
`;

  const PF_QUICK = String.raw`"""Step 1 (fast, no model run): download water table depth already simulated
by the national ParFlow-CONUS2 model for your region and dates.

    python 01_quick_simulated_wtd.py
"""
import os
import sys

import hf_hydrodata as hf
import numpy as np

from common import load_config, register_hydroframe

cfg = load_config()
b, pf = cfg["bbox"], cfg["parflow"]
register_hydroframe()

options = {
    "dataset": "conus2_baseline",
    "variable": "water_table_depth",
    "temporal_resolution": "daily",
    "start_time": pf["start"],
    "end_time": pf["end"],
    "latlng_bounds": [b["south"], b["west"], b["north"], b["east"]],
}
print("Requesting:", options)
try:
    data = np.asarray(hf.get_gridded_data(options), dtype=float)
except Exception as err:  # show what IS available so you can edit the options above
    print("\nRequest failed:", err)
    print("\nVariables in conus2_baseline:", hf.get_variables({"dataset": "conus2_baseline"}))
    print("Edit 'options' in this script (dataset / temporal_resolution / dates) and retry.")
    sys.exit(1)

wtd = np.nanmean(data, axis=0) if data.ndim == 3 else data
os.makedirs("outputs", exist_ok=True)
out = "outputs/wtd_parflow_conus2_simulated.npy"
np.save(out, wtd)
print(f"Saved {out}  shape={wtd.shape}  min={np.nanmin(wtd):.2f} m  "
      f"mean={np.nanmean(wtd):.2f} m  max={np.nanmax(wtd):.2f} m")
print("Plot it with:  python plot_wtd.py", out)
`;

  const PF_BUILD = String.raw`"""Step 2: build a ParFlow-CLM run for your region with HydroFrame subsettools
and (optionally) run it.

    python 02_build_and_run_parflow.py            # build + run
    python 02_build_and_run_parflow.py --build-only

Needs ParFlow installed and PARFLOW_DIR set (see README). Written for
subsettools 2.x; if a function name changed, compare with the examples at
https://hydroframe-subsettools.readthedocs-hosted.com/
"""
import argparse
import json
import os
from datetime import datetime

import subsettools as st

from common import load_config, register_hydroframe

ap = argparse.ArgumentParser()
ap.add_argument("--build-only", action="store_true", help="prepare inputs but do not run ParFlow")
args = ap.parse_args()

cfg = load_config()
b, pf, runname = cfg["bbox"], cfg["parflow"], cfg["runname"]
grid = pf.get("grid", "conus2")
P, Q = int(pf["P"]), int(pf["Q"])

base = os.path.abspath("parflow_run")
static_dir = os.path.join(base, "static")
forcing_dir = os.path.join(base, "forcing")
run_dir = os.path.join(base, "outputs")
for d in (static_dir, forcing_dir, run_dir):
    os.makedirs(d, exist_ok=True)

register_hydroframe()

# 1. Domain: lat/lon box -> grid indices + mask
ij_bounds, mask = st.define_latlon_domain(
    latlon_bounds=[[b["south"], b["west"]], [b["north"], b["east"]]], grid=grid)
print("Grid index bounds (imin, jmin, imax, jmax):", ij_bounds)
with open(os.path.join(base, "domain.json"), "w") as f:
    json.dump({"grid": grid, "ij_bounds": [int(v) for v in ij_bounds]}, f, indent=2)

# 2. Static inputs (topography, slopes, subsurface, mask/solid file)
st.write_mask_solid(mask=mask, grid=grid, write_dir=static_dir)
st.subset_static(ij_bounds, dataset="conus2_domain", write_dir=static_dir)
st.config_clm(ij_bounds, start=pf["start"], end=pf["end"], dataset="conus2_baseline", write_dir=static_dir)

# 3. Initial pressure from the national baseline simulation
init_press = st.subset_press_init(ij_bounds, dataset="conus2_baseline", date=pf["start"],
                                  write_dir=static_dir, time_zone="UTC")

# 4. Climate forcing (CW3E) for the run period
st.subset_forcing(ij_bounds, grid=grid, start=pf["start"], end=pf["end"], dataset="CW3E",
                  write_dir=forcing_dir)

# 5. Run script from template, edited for this subset
ref = st.get_template_runscript(grid, "transient", "solid", run_dir)
runscript = st.edit_runscript_for_subset(ij_bounds, runscript_path=ref, runname=runname,
                                         forcing_dir=forcing_dir)
st.copy_files(read_dir=static_dir, write_dir=run_dir)
runscript = st.change_filename_values(runscript_path=runscript,
                                      init_press=os.path.basename(str(init_press)))
st.dist_run(topo_p=P, topo_q=Q, runscript_path=runscript, working_dir=run_dir,
            dist_clim_forcing=True)
print("Run script:", runscript)

if args.build_only:
    print("Build finished. Run later with:  python 02_build_and_run_parflow.py")
    raise SystemExit

# 6. Run
from parflow import Run  # noqa: E402

hours = int((datetime.fromisoformat(pf["end"]) - datetime.fromisoformat(pf["start"])).total_seconds() // 3600)
run = Run.from_definition(runscript)
run.TimingInfo.StopTime = hours
print(f"Running ParFlow for {hours} hours on {P}x{Q} processors ...")
run.run(working_directory=run_dir)
print("Done. Next:  python 03_wtd_from_parflow.py")
`;

  const PF_POST = String.raw`"""Step 3: compute water table depth from your ParFlow run's pressure output.

    python 03_wtd_from_parflow.py
"""
import glob
import os

import numpy as np
from parflow import Run
from parflow.tools.hydrology import calculate_water_table_depth

from common import load_config

cfg = load_config()
run_dir = os.path.abspath(os.path.join("parflow_run", "outputs"))
yamls = sorted(glob.glob(os.path.join(run_dir, "*.yaml")))
mine = [y for y in yamls if os.path.basename(y).startswith(cfg["runname"])]
if not (mine or yamls):
    raise SystemExit("No run definition (*.yaml) found in parflow_run/outputs - run step 2 first.")
run = Run.from_definition((mine or yamls)[0])
data = run.data_accessor

wtds = []
for t in data.times:
    data.time = t
    try:
        wtds.append(calculate_water_table_depth(data.pressure, data.saturation, data.dz))
    except (TypeError, ValueError):  # skip timesteps that were not written
        continue
if not wtds:
    raise SystemExit("No pressure/saturation outputs found.")

wtd_mean = np.nanmean(np.stack(wtds), axis=0)
os.makedirs("outputs", exist_ok=True)
np.save("outputs/wtd_parflow_run_mean.npy", wtd_mean)
np.save("outputs/wtd_parflow_run_last.npy", wtds[-1])
print(f"{len(wtds)} timesteps. Mean WTD over domain: {np.nanmean(wtd_mean):.2f} m")
print("Plot:  python plot_wtd.py outputs/wtd_parflow_run_mean.npy")
`;

  function pfReadme(c) {
    return `# ${c.runname} — ParFlow (CONUS2) water table depth kit

Region: ${bboxLine(c)}
Period: ${c.pf.start} to ${c.pf.end}  ·  Processors: ${c.pf.p} × ${c.pf.q}

Generated by **WTD Run Kit**. All settings live in \`config.json\`; edit it to change the region or dates.

## What's inside

| File | What it does |
|---|---|
| \`01_quick_simulated_wtd.py\` | Downloads WTD **already simulated** by ParFlow-CONUS2 for your box (minutes, no model run). |
| \`02_build_and_run_parflow.py\` | Uses HydroFrame **subsettools** to cut all inputs (topography, subsurface, initial pressure, CW3E forcing) and runs ParFlow-CLM. |
| \`03_wtd_from_parflow.py\` | Turns your run's pressure output into WTD (mean + last timestep). |
| \`plot_wtd.py\` | Makes a PNG map of any WTD \`.npy\` / \`.tif\`. |
| \`environment.yml\` | Python environment. |

## Steps

1. **HydroFrame account** (free): sign up at https://hydrogen.princeton.edu/ and create an API PIN. Then:
   \`\`\`bash
   export HF_EMAIL="you@example.com"
   export HF_PIN="1234"
   \`\`\`
2. **Python environment**
   \`\`\`bash
   conda env create -f environment.yml
   conda activate wtd-parflow
   \`\`\`
3. **Quick answer** (no simulation):
   \`\`\`bash
   python 01_quick_simulated_wtd.py
   python plot_wtd.py outputs/wtd_parflow_conus2_simulated.npy
   \`\`\`
4. **Your own ParFlow run** — install ParFlow first (one of):
   - Docker: \`docker pull parflow/parflow\` (see https://github.com/parflow/parflow)
   - Build from source / use your cluster's module, then \`export PARFLOW_DIR=/path/to/parflow\`

   \`\`\`bash
   python 02_build_and_run_parflow.py
   python 03_wtd_from_parflow.py
   python plot_wtd.py outputs/wtd_parflow_run_mean.npy
   \`\`\`

## Notes
- CONUS2 is a 1 km grid with 10 layers covering the contiguous US only.
- Short runs start from the national baseline pressure, so results reflect that initial state; for a fresh equilibrium you need a long spin-up.
- Large domains: raise P × Q in \`config.json\` and run on a cluster.
- Script calls were written for subsettools 2.x / hf_hydrodata 1.x. If an API changed, compare with the official examples: https://github.com/hydroframe/subsettools

## Credits
ParFlow (parflow.org) · HydroFrame subsettools & hf_hydrodata (hydroframe.org) · ParFlow-CONUS2 (Yang et al., 2023).
`;
  }

  // ------------------------------------------------------------------ MODFLOW
  const MF_ENV = `name: wtd-modflow
channels:
  - conda-forge
dependencies:
  - python=3.11
  - numpy
  - matplotlib
  - flopy
  - rioxarray
  - xarray
  - rasterio
  - py3dep
`;

  const MF_PY = String.raw`"""Build and run a steady-state MODFLOW 6 model that predicts water table depth.

Concept: one unconfined layer, uniform recharge, and a drain in every cell at
land surface. Where the water table would rise above the ground it discharges
(springs, streams, wetlands), so the water table settles at a physically
consistent depth. WTD = land surface - simulated head.

    python build_and_run_mf6.py                 # US: DEM downloaded from USGS 3DEP
    python build_and_run_mf6.py --dem mydem.tif # anywhere: your own DEM GeoTIFF
"""
import argparse
import json
import os
import shutil

import flopy
import numpy as np
import rioxarray  # noqa: F401  (registers .rio)
import xarray as xr
from rasterio.enums import Resampling

MAX_CELLS = 1_000_000

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "config.json")) as f:
    cfg = json.load(f)
b, mf, name = cfg["bbox"], cfg["modflow"], cfg["runname"][:16] or "wtd"

ap = argparse.ArgumentParser()
ap.add_argument("--dem", help="GeoTIFF DEM covering the region (any CRS)")
args = ap.parse_args()

cell = float(mf["cell_size_m"])
K = float(mf["k_m_per_day"])
recharge = float(mf["recharge_mm_per_yr"]) / 1000.0 / 365.25  # m/day
thickness = float(mf["aquifer_thickness_m"])

# ---------------------------------------------------------------- 1. DEM
if args.dem:
    dem = xr.open_dataarray(args.dem, engine="rasterio", mask_and_scale=True).squeeze(drop=True)
    dem = dem.rio.clip_box(minx=b["west"], miny=b["south"], maxx=b["east"], maxy=b["north"], crs="EPSG:4326")
else:
    import py3dep
    print("Downloading DEM from USGS 3DEP ...")
    dem = py3dep.get_dem((b["west"], b["south"], b["east"], b["north"]), resolution=max(10.0, cell), crs=4326)

utm = dem.rio.estimate_utm_crs()
dem_p = dem.rio.reproject(utm, resolution=cell, resampling=Resampling.average)
while dem_p.size > MAX_CELLS:
    cell *= 1.5
    print(f"Grid too large, coarsening to {cell:.0f} m")
    dem_p = dem.rio.reproject(utm, resolution=cell, resampling=Resampling.average)

top = dem_p.values.astype(float)
if dem_p.rio.nodata is not None:
    top[top == dem_p.rio.nodata] = np.nan
active = np.isfinite(top)
top = np.where(active, top, np.nanmean(top))
nrow, ncol = top.shape
print(f"Grid: {nrow} rows x {ncol} cols at {cell:.0f} m ({active.sum():,} active cells)")

# ---------------------------------------------------------------- 2. MODFLOW 6
def find_or_get_mf6():
    exe = shutil.which("mf6") or next((p for p in (os.path.join(here, "bin", "mf6"), os.path.join(here, "bin", "mf6.exe"))
                                       if os.path.exists(p)), None)
    if exe:
        return exe
    print("mf6 not found - downloading MODFLOW 6 ...")
    try:
        flopy.utils.get_modflow(":python", subset="mf6")
        if shutil.which("mf6"):
            return shutil.which("mf6")
    except Exception as err:  # GitHub API limits etc. -> direct release download
        print("flopy get-modflow failed (", err, ") - trying direct download")
    import platform, urllib.request, zipfile, stat
    sysname, mach = platform.system(), platform.machine().lower()
    asset = {"Linux": "linux.zip", "Windows": "win64.zip"}.get(
        sysname, "macarm.zip" if mach in ("arm64", "aarch64") else "mac.zip")
    url = f"https://github.com/MODFLOW-ORG/executables/releases/latest/download/{asset}"
    zpath = os.path.join(here, asset)
    urllib.request.urlretrieve(url, zpath)
    bindir = os.path.join(here, "bin")
    with zipfile.ZipFile(zpath) as z:
        for m in z.namelist():
            if os.path.basename(m).split(".")[0] in ("mf6", "libmf6"):
                z.extract(m, bindir)
    exe = next(os.path.join(r, f) for r, _, fs in os.walk(bindir) for f in fs if f in ("mf6", "mf6.exe"))
    os.chmod(exe, os.stat(exe).st_mode | stat.S_IEXEC)
    return exe


exe = find_or_get_mf6()

ws = os.path.join(here, "mf6_run")
sim = flopy.mf6.MFSimulation(sim_name=name, sim_ws=ws, exe_name=exe)
flopy.mf6.ModflowTdis(sim, time_units="DAYS", nper=1, perioddata=[(1.0, 1, 1.0)])
flopy.mf6.ModflowIms(sim, complexity="COMPLEX", outer_maximum=500, inner_maximum=500,
                     outer_dvclose=1e-2, inner_dvclose=1e-3, linear_acceleration="BICGSTAB")
gwf = flopy.mf6.ModflowGwf(sim, modelname=name, newtonoptions="UNDER_RELAXATION", save_flows=True)
flopy.mf6.ModflowGwfdis(gwf, nlay=1, nrow=nrow, ncol=ncol, delr=cell, delc=cell,
                        top=top, botm=top - thickness, idomain=active.astype(int))
flopy.mf6.ModflowGwfnpf(gwf, icelltype=1, k=K)
flopy.mf6.ModflowGwfic(gwf, strt=top)
flopy.mf6.ModflowGwfrcha(gwf, recharge=recharge)
cond = K * cell * cell / 1.0  # drain conductance: K * area / 1 m
rows, cols = np.nonzero(active)
drains = [((0, int(i), int(j)), float(top[i, j]), cond) for i, j in zip(rows, cols)]
flopy.mf6.ModflowGwfdrn(gwf, stress_period_data={0: drains})
flopy.mf6.ModflowGwfoc(gwf, head_filerecord=f"{name}.hds", saverecord=[("HEAD", "LAST")])

sim.write_simulation(silent=True)
ok, _ = sim.run_simulation(silent=False)
if not ok:
    raise SystemExit("MODFLOW did not converge. Try a larger cell size, higher K or lower recharge.")

# ---------------------------------------------------------------- 3. WTD
head = gwf.output.head().get_data()[0]
wtd = top - head
wtd[(~active) | (np.abs(head) > 1e20) | (head <= top - thickness)] = np.nan
wtd = np.clip(wtd, 0, None)

os.makedirs(os.path.join(here, "outputs"), exist_ok=True)
out = dem_p.copy(data=wtd.astype("float32"))
out.rio.write_nodata(np.nan, inplace=True)
tif = os.path.join(here, "outputs", "wtd_modflow.tif")
out.rio.to_raster(tif)
np.save(os.path.join(here, "outputs", "wtd_modflow.npy"), wtd)
print(f"WTD: median {np.nanmedian(wtd):.2f} m, mean {np.nanmean(wtd):.2f} m -> {tif}")
print("Plot:  python plot_wtd.py outputs/wtd_modflow.tif")
`;

  function mfReadme(c) {
    return `# ${c.runname} — MODFLOW 6 water table depth kit

Region: ${bboxLine(c)}
Cell size ${c.mf.cell} m · K ${c.mf.k} m/day · Recharge ${c.mf.rch} mm/yr · Aquifer thickness ${c.mf.thk} m

Generated by **WTD Run Kit**. Edit \`config.json\` to change parameters.

## How the model works
A single unconfined layer with uniform recharge and a drain in every cell at land surface. Wherever the water table would rise above ground, water leaves through the drain (like springs, streams and wetlands), so the water table settles at a consistent depth. **WTD = land surface − simulated head.** Edges are no-flow.

## Steps
\`\`\`bash
conda env create -f environment.yml
conda activate wtd-modflow

# US region: DEM is downloaded automatically from USGS 3DEP
python build_and_run_mf6.py

# Outside the US: download a DEM GeoTIFF (e.g. Copernicus GLO-30 from
# https://portal.opentopography.org) covering your box, then:
python build_and_run_mf6.py --dem path/to/dem.tif

python plot_wtd.py outputs/wtd_modflow.tif
\`\`\`
The MODFLOW 6 executable is downloaded automatically by FloPy if \`mf6\` isn't on your PATH.

## Tuning
- **K / recharge ratio** controls depth: higher K or lower recharge → deeper water table.
- Calibrate K against observed wells (e.g. USGS NWIS) before trusting absolute depths.
- Uniform K and recharge are a starting point; replace them with maps (e.g. GLHYMPS for K) for real studies.

## Credits
MODFLOW 6 (USGS) · FloPy · py3dep / HyRiver · rioxarray.
`;
  }

  // ------------------------------------------------------------------ Global (Fan et al. 2013)
  const GL_ENV = `name: wtd-global
channels:
  - conda-forge
dependencies:
  - python=3.11
  - numpy
  - matplotlib
  - xarray
  - netcdf4
  - rioxarray
  - rasterio
`;

  const GL_PY = String.raw`"""Clip the Fan, Li & Miguez-Macho (2013) global equilibrium water table depth
map to your region.

    python clip_global_wtd.py --file path/to/continent_wtd.nc
    python clip_global_wtd.py --remote wtd_Europe_and_Asia_CF.nc   # subset on the server

--remote uses the THREDDS NetCDF Subset Service, so only your box is downloaded.
"""
import argparse
import json
import os
import urllib.request

import numpy as np
import rioxarray  # noqa: F401
import xarray as xr

NCSS = "https://vortices.npm.ac.uk/thredds/ncss/grid/usc/water-table-depth/"

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "config.json")) as f:
    cfg = json.load(f)
b = cfg["bbox"]

ap = argparse.ArgumentParser()
g = ap.add_mutually_exclusive_group(required=True)
g.add_argument("--file", help="local NetCDF file downloaded from the dataset page")
g.add_argument("--remote", help="file name on the THREDDS server, e.g. wtd_Europe_and_Asia_CF.nc")
args = ap.parse_args()

os.makedirs(os.path.join(here, "outputs"), exist_ok=True)
if args.remote:
    url = (f"{NCSS}{args.remote}?var=wtd&north={b['north']}&south={b['south']}"
           f"&west={b['west']}&east={b['east']}&horizStride=1&accept=netcdf")
    path = os.path.join(here, "outputs", "wtd_subset_download.nc")
    print("Downloading", url)
    urllib.request.urlretrieve(url, path)
else:
    path = args.file

ds = xr.open_dataset(path)
var = next((v for v in ds.data_vars if v.lower() == "wtd"), None) or list(ds.data_vars)[0]
da = ds[var].squeeze(drop=True)
lat = next(c for c in da.dims if c.lower() in ("lat", "latitude", "y"))
lon = next(c for c in da.dims if c.lower() in ("lon", "longitude", "x"))
lat_slice = slice(b["north"], b["south"]) if da[lat][0] > da[lat][-1] else slice(b["south"], b["north"])
da = da.sel({lat: lat_slice, lon: slice(b["west"], b["east"])})
if da.size == 0:
    raise SystemExit("Region not covered by this file - pick the file for your continent.")

wtd = np.abs(da.values.astype(float))  # depth in metres (some files store it as negative)
da = da.copy(data=wtd).rename({lat: "y", lon: "x"})
if da.y[0] < da.y[-1]:
    da = da.isel(y=slice(None, None, -1))
da = da.rio.write_crs("EPSG:4326")
tif = os.path.join(here, "outputs", "wtd_fan2013.tif")
da.astype("float32").rio.to_raster(tif)
np.save(os.path.join(here, "outputs", "wtd_fan2013.npy"), da.values)
print(f"WTD: median {np.nanmedian(wtd):.2f} m, mean {np.nanmean(wtd):.2f} m -> {tif}")
print("Plot:  python plot_wtd.py outputs/wtd_fan2013.tif")
`;

  function glReadme(c) {
    return `# ${c.runname} — Global WTD map (Fan et al. 2013) kit

Region: ${bboxLine(c)}

Generated by **WTD Run Kit**. No simulation: this clips the published ~1 km global equilibrium water table depth map.

## Steps
\`\`\`bash
conda env create -f environment.yml
conda activate wtd-global
\`\`\`

**Option A — subset on the server (small download).** The data are served by a THREDDS server at
\`https://vortices.npm.ac.uk/thredds/\` (folder \`usc/water-table-depth\`). Open the catalog, find your
continent's file name (for example \`wtd_Europe_and_Asia_CF.nc\`), then:
\`\`\`bash
python clip_global_wtd.py --remote <file_name.nc>
\`\`\`

**Option B — local file.** Download your continent's NetCDF from the dataset page and run:
\`\`\`bash
python clip_global_wtd.py --file path/to/file.nc
\`\`\`

Then plot:
\`\`\`bash
python plot_wtd.py outputs/wtd_fan2013.tif
\`\`\`

## Notes
- This is a long-term equilibrium estimate, good as a baseline or for comparing with ParFlow / MODFLOW kits.
- If the server location has moved, search for "Fan Li Miguez-Macho 2013 global water table depth data".

## Citation
Fan, Y., Li, H., & Miguez-Macho, G. (2013). Global patterns of groundwater table depth. *Science*, 339(6122), 940–943.
`;
  }

  // ------------------------------------------------------------------ build
  function build(c) {
    const files = { "config.json": configJson(c), "plot_wtd.py": PLOT_PY, ".gitignore": GITIGNORE };
    if (c.model === "parflow") {
      Object.assign(files, {
        "README.md": pfReadme(c),
        "environment.yml": PF_ENV,
        "common.py": PF_COMMON,
        "01_quick_simulated_wtd.py": PF_QUICK,
        "02_build_and_run_parflow.py": PF_BUILD,
        "03_wtd_from_parflow.py": PF_POST,
      });
    } else if (c.model === "modflow") {
      Object.assign(files, {
        "README.md": mfReadme(c),
        "environment.yml": MF_ENV,
        "build_and_run_mf6.py": MF_PY,
      });
    } else {
      Object.assign(files, {
        "README.md": glReadme(c),
        "environment.yml": GL_ENV,
        "clip_global_wtd.py": GL_PY,
      });
    }
    return files;
  }

  const api = { build };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WTDTemplates = api;
})(this);
