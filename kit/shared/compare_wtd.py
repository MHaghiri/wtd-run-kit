"""Compare two water table depth maps (e.g. ParFlow vs GLOBGM, or MODFLOW vs Fan).

    python compare_wtd.py outputs/wtd_A.tif outputs/wtd_B.tif --labels "ParFlow" "Fan 2013"

Map B is resampled onto the grid of map A. Writes a 4-panel figure (A, B,
difference B - A, scatter) and prints bias, RMSE and correlation of log10(WTD).
"""
import argparse
import os

import matplotlib.pyplot as plt
import numpy as np
import rioxarray  # noqa: F401
import xarray as xr
from matplotlib.colors import LinearSegmentedColormap, LogNorm, TwoSlopeNorm
from rasterio.enums import Resampling

WTD_CMAP = LinearSegmentedColormap.from_list(
    "wtd", ["#08306b", "#2171b5", "#41b6c4", "#c7e9b4", "#f6e8c3", "#d8b365", "#8c510a"])

ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument("a")
ap.add_argument("b")
ap.add_argument("--labels", nargs=2, default=None)
args = ap.parse_args()
la, lb = args.labels or [os.path.splitext(os.path.basename(p))[0] for p in (args.a, args.b)]


def open_tif(p):
    return xr.open_dataarray(p, engine="rasterio", mask_and_scale=True).squeeze(drop=True)


A = open_tif(args.a)
B = open_tif(args.b).rio.reproject_match(A, resampling=Resampling.average)
a, bv = A.values.astype(float), B.values.astype(float)
ok = np.isfinite(a) & np.isfinite(bv)
if ok.sum() < 3:
    raise SystemExit("The two maps hardly overlap.")
la10, lb10 = np.log10(np.clip(a[ok], 0.1, None)), np.log10(np.clip(bv[ok], 0.1, None))
bias = float(np.mean(bv[ok] - a[ok]))
rmse = float(np.sqrt(np.mean((bv[ok] - a[ok]) ** 2)))
r = float(np.corrcoef(la10, lb10)[0, 1])
print(f"Overlapping cells: {ok.sum():,}")
print(f"Bias ({lb} - {la}): {bias:.2f} m   RMSE: {rmse:.2f} m   r(log10 WTD): {r:.3f}")

b0 = A.rio.bounds()
ext = (b0[0], b0[2], b0[1], b0[3])
vmax = max(10.0, float(np.nanpercentile(np.r_[a[ok], bv[ok]], 99)))
fig, axs = plt.subplots(1, 4, figsize=(18, 4.6), layout="constrained",
                        gridspec_kw={"width_ratios": [1, 1, 1, 0.9]})
for ax, arr, lab in ((axs[0], a, la), (axs[1], bv, lb)):
    im = ax.imshow(np.clip(arr, 0.1, vmax), cmap=WTD_CMAP, norm=LogNorm(0.1, vmax), extent=ext)
    ax.set_title(lab, loc="left", fontweight="bold")
fig.colorbar(im, ax=axs[:2], shrink=0.8, label="WTD (m)")
diff = np.where(ok, bv - a, np.nan)
lim = max(1.0, float(np.nanpercentile(np.abs(diff), 95)))
im2 = axs[2].imshow(diff, cmap="RdBu_r", norm=TwoSlopeNorm(0, -lim, lim), extent=ext)
axs[2].set_title(f"{lb} − {la}", loc="left", fontweight="bold")
fig.colorbar(im2, ax=axs[2], shrink=0.8, label="Δ WTD (m)   red = B deeper")
axs[3].set_box_aspect(1)
axs[3].hexbin(la10, lb10, gridsize=40, cmap="Blues", mincnt=1)
lo, hi = min(la10.min(), lb10.min()), max(la10.max(), lb10.max())
axs[3].plot([lo, hi], [lo, hi], "k--", lw=1)
axs[3].set_xlabel(f"log10 WTD {la}")
axs[3].set_ylabel(f"log10 WTD {lb}")
axs[3].set_title(f"r = {r:.2f}, bias = {bias:.1f} m", loc="left", fontweight="bold")
for ax in axs[:3]:
    ax.locator_params(nbins=4)
os.makedirs("outputs", exist_ok=True)
out = os.path.join("outputs", "compare_wtd.png")
fig.savefig(out, dpi=150, bbox_inches="tight")
print("Saved", out)
