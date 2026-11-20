"""Prepare a land-surface elevation grid (DEM) for your region - the main input
of most water table models (WTM, G3M, GLOBGM, MODFLOW ...).

    python prepare_dem.py                       # US: downloads USGS 3DEP
    python prepare_dem.py --dem global_dem.tif  # anywhere: clip your own DEM
    python prepare_dem.py --res 1000 --utm      # resample to 1 km in UTM metres

Output: outputs/dem_<runname>.tif  (and .png preview)
"""
import argparse
import json
import os

import numpy as np
import rioxarray  # noqa: F401
import xarray as xr
from rasterio.enums import Resampling

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "config.json")) as f:
    cfg = json.load(f)
b = cfg["bbox"]

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--dem", help="DEM GeoTIFF covering the region (any CRS)")
ap.add_argument("--res", type=float, default=None, help="output resolution (degrees, or metres with --utm)")
ap.add_argument("--utm", action="store_true", help="reproject to the local UTM zone (metres)")
args = ap.parse_args()

if args.dem:
    dem = xr.open_dataarray(args.dem, engine="rasterio", mask_and_scale=True).squeeze(drop=True)
    dem = dem.rio.clip_box(minx=b["west"], miny=b["south"], maxx=b["east"], maxy=b["north"], crs="EPSG:4326")
else:
    try:
        import py3dep
    except ImportError:
        raise SystemExit("py3dep not installed and no --dem given. Install py3dep (US only) or pass --dem.")
    print("Downloading DEM from USGS 3DEP ...")
    dem = py3dep.get_dem((b["west"], b["south"], b["east"], b["north"]), resolution=90, crs=4326)

if args.utm:
    dem = dem.rio.reproject(dem.rio.estimate_utm_crs(), resolution=args.res or 1000, resampling=Resampling.average)
elif args.res:
    dem = dem.rio.reproject(dem.rio.crs, resolution=args.res, resampling=Resampling.average)

os.makedirs(os.path.join(here, "outputs"), exist_ok=True)
out = os.path.join(here, "outputs", f"dem_{cfg['runname']}.tif")
dem.astype("float32").rio.to_raster(out)
v = dem.values[np.isfinite(dem.values)]
print(f"DEM {dem.shape[0]} x {dem.shape[1]} cells, elevation {v.min():.0f}-{v.max():.0f} m -> {out}")
