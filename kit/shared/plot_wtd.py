"""Make a publication-style figure of a water table depth (WTD) map.

Usage:
    python plot_wtd.py outputs/wtd.tif
    python plot_wtd.py outputs/wtd.npy --title "ParFlow-CONUS2, Oct 2003"

The figure has a map (log colour scale: blue = shallow, sand = deep) and a
histogram with the share of the area in common depth classes.
"""
import argparse
import os

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import LinearSegmentedColormap, LogNorm

# blue (shallow / wet) -> teal -> sand -> brown (deep / dry)
WTD_CMAP = LinearSegmentedColormap.from_list(
    "wtd", ["#08306b", "#2171b5", "#41b6c4", "#c7e9b4", "#f6e8c3", "#d8b365", "#8c510a"])
CLASSES = [(0, 1, "< 1 m"), (1, 5, "1–5 m"), (5, 20, "5–20 m"), (20, 100, "20–100 m"), (100, np.inf, "> 100 m")]


def load(path):
    """Return (array, extent, origin, units-label)."""
    if path.endswith(".npy"):
        arr = np.load(path).astype(float)
        # ParFlow / hf_hydrodata arrays have row 0 at the south edge
        origin = "lower" if "parflow" in os.path.basename(path) else "upper"
        return arr, None, origin, ("grid column", "grid row")
    import rioxarray  # noqa: F401
    import xarray as xr
    with xr.open_dataarray(path, engine="rasterio", mask_and_scale=True) as raw:
        da = raw.squeeze(drop=True).load()
    b = da.rio.bounds()
    geo = da.rio.crs is not None and da.rio.crs.is_geographic
    labels = ("Longitude (°)", "Latitude (°)") if geo else ("Easting (m)", "Northing (m)")
    return da.values.astype(float), (b[0], b[2], b[1], b[3]), "upper", labels


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("path")
    ap.add_argument("--title", default=None)
    ap.add_argument("--vmax", type=float, default=None, help="upper limit of colour scale (m)")
    args = ap.parse_args()

    wtd, extent, origin, (xl, yl) = load(args.path)
    wtd = np.where(np.isfinite(wtd) & (wtd > -1e10) & (wtd < 1e10), wtd, np.nan)
    valid = wtd[np.isfinite(wtd)]
    if valid.size == 0:
        raise SystemExit("No valid WTD values in " + args.path)

    vmax = args.vmax or max(10.0, float(np.nanpercentile(valid, 99)))
    shown = np.clip(wtd, 0.1, vmax)

    fig = plt.figure(figsize=(11, 5.6))
    gs = fig.add_gridspec(1, 2, width_ratios=[2.2, 1], wspace=0.28)
    ax = fig.add_subplot(gs[0])
    im = ax.imshow(shown, cmap=WTD_CMAP, norm=LogNorm(vmin=0.1, vmax=vmax), extent=extent,
                   origin=origin, interpolation="nearest")
    cb = fig.colorbar(im, ax=ax, shrink=0.85, pad=0.02)
    cb.set_label("Water table depth (m below land surface)")
    ax.set_xlabel(xl)
    ax.set_ylabel(yl)
    ax.ticklabel_format(useOffset=False, style="plain") if extent else None
    ax.locator_params(nbins=5)
    ax.set_title(args.title or os.path.splitext(os.path.basename(args.path))[0].replace("_", " "),
                 loc="left", fontsize=12, fontweight="bold")

    # histogram + depth classes
    hx = fig.add_subplot(gs[1])
    bins = np.logspace(-1, np.log10(vmax), 40)
    hx.hist(np.clip(valid, 0.1, vmax), bins=bins, color="#2a9d8f", edgecolor="white", linewidth=0.4)
    hx.set_xscale("log")
    hx.set_xlabel("WTD (m)")
    hx.set_ylabel("Number of cells")
    hx.set_title("Distribution", loc="left", fontsize=12, fontweight="bold")
    lines = [f"{lab:>9}: {100 * np.mean((valid >= lo) & (valid < hi)):5.1f} %" for lo, hi, lab in CLASSES]
    stats = (f"cells  {valid.size:,}\nmedian {np.median(valid):.1f} m\nmean   {valid.mean():.1f} m\n\n"
             + "\n".join(lines))
    hx.text(0.03, 0.97, stats, transform=hx.transAxes, ha="left", va="top", family="monospace", fontsize=8,
            bbox=dict(boxstyle="round,pad=0.4", fc="white", ec="#cccccc", alpha=0.9))
    for a in (ax, hx):
        a.spines[["top", "right"]].set_visible(False)

    out = os.path.splitext(args.path)[0] + ".png"
    fig.savefig(out, dpi=160, bbox_inches="tight")
    print("Saved", out)


if __name__ == "__main__":
    main()
