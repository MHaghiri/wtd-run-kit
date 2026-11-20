"""Clip the Fan, Li & Miguez-Macho (2013) global equilibrium water table depth
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
