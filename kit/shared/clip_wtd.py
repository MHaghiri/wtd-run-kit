"""Clip any published or simulated water table depth (WTD) product to your region.

Works with GeoTIFF and NetCDF, in any coordinate system (e.g. the GLOBGM
GeoTIFFs, the New Zealand national water table in EPSG:2193, Fan et al. NetCDF,
CLM / VIC-WUR / WBM history files). Output is a GeoTIFF in lat/lon (EPSG:4326).

Examples:
    python clip_wtd.py --file globgm-wtd-ss.tif
    python clip_wtd.py --file nz_wtd.tif --name westerhoff_nz
    python clip_wtd.py --file clm_history.nc --var ZWT --time-mean
    python clip_wtd.py --file model.nc --var wtd --abs        # depths stored as negative numbers
"""
import argparse
import json
import os

import numpy as np
import rioxarray  # noqa: F401  (registers .rio)
import xarray as xr

here = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(here, "config.json")) as f:
    cfg = json.load(f)
b = cfg["bbox"]

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("--file", required=True, help="GeoTIFF or NetCDF with WTD")
ap.add_argument("--var", help="variable name in a NetCDF file (default: guessed)")
ap.add_argument("--time-mean", action="store_true", help="average over the time dimension")
ap.add_argument("--abs", action="store_true", help="take absolute value (depth stored as negative)")
ap.add_argument("--name", default=None, help="output name (default: from config model)")
ap.add_argument("--crs", default=None, help="CRS of the file if it has none, e.g. EPSG:4326")
args = ap.parse_args()

GUESS = ["wtd", "WTD", "ZWT", "zwt", "water_table_depth", "watertabledepth", "groundwater_depth", "gwd"]


def open_any(path):
    if path.lower().endswith((".tif", ".tiff", ".vrt")):
        return xr.open_dataarray(path, engine="rasterio", mask_and_scale=True).squeeze(drop=True)
    ds = xr.open_dataset(path, decode_times=False)
    var = args.var or next((v for v in GUESS if v in ds.data_vars), None)
    if var is None:
        raise SystemExit(f"Could not guess the WTD variable. Use --var. Variables: {list(ds.data_vars)}")
    da = ds[var]
    tdim = next((d for d in da.dims if d.lower() in ("time", "t", "month")), None)
    if tdim is not None:
        da = da.mean(tdim) if args.time_mean else da.isel({tdim: -1})
    da = da.squeeze(drop=True)
    xd = next((d for d in da.dims if d.lower() in ("lon", "longitude", "x", "lsmlon")), None)
    yd = next((d for d in da.dims if d.lower() in ("lat", "latitude", "y", "lsmlat")), None)
    if xd is None or yd is None:
        raise SystemExit(f"Need a gridded (lat/lon) variable; found dims {da.dims}. "
                         "For unstructured CLM output use a gridded h0 file.")
    if float(da[xd].max()) > 180:  # 0..360 longitudes -> -180..180
        da = da.assign_coords({xd: (((da[xd] + 180) % 360) - 180)}).sortby(xd)
    return da.rio.set_spatial_dims(x_dim=xd, y_dim=yd)


da = open_any(args.file)
if da.rio.crs is None:
    da = da.rio.write_crs(args.crs or "EPSG:4326")

# clip in the file's own CRS (handles projected products), then reproject to lat/lon
clipped = da.rio.clip_box(minx=b["west"], miny=b["south"], maxx=b["east"], maxy=b["north"], crs="EPSG:4326")
if not clipped.rio.crs.is_geographic:
    clipped = clipped.rio.reproject("EPSG:4326")
    clipped = clipped.rio.clip_box(minx=b["west"], miny=b["south"], maxx=b["east"], maxy=b["north"])

vals = clipped.values.astype("float32")
nod = clipped.rio.nodata
if nod is not None:
    vals[vals == nod] = np.nan
vals[(vals < -1e10) | (vals > 1e10)] = np.nan
if args.abs:
    vals = np.abs(vals)
if not np.isfinite(vals).any():
    raise SystemExit("Your region has no valid data in this file (check coverage / variable).")

out = clipped.copy(data=vals).rio.write_nodata(np.nan)
name = args.name or cfg.get("model", "wtd")
os.makedirs(os.path.join(here, "outputs"), exist_ok=True)
tif = os.path.join(here, "outputs", f"wtd_{name}.tif")
out.rio.to_raster(tif)
v = vals[np.isfinite(vals)]
print(f"Clipped {v.size:,} cells: median {np.median(v):.2f} m, mean {v.mean():.2f} m -> {tif}")
print(f"Plot:  python plot_wtd.py outputs/wtd_{name}.tif")
