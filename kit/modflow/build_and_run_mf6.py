"""Build and run a steady-state MODFLOW 6 model that predicts water table depth.

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
