"""Step 1 (fast, no model run): download water table depth already simulated
by the national ParFlow-CONUS model (CONUS1 or CONUS2, see config.json) for your region and dates.

    python 01_quick_simulated_wtd.py
"""
import os
import sys

import hf_hydrodata as hf
import numpy as np

from common import DATASETS, load_config, register_hydroframe

cfg = load_config()
b, pf = cfg["bbox"], cfg["parflow"]
grid = pf.get("grid", "conus2")
baseline = DATASETS[grid]["baseline"]
register_hydroframe()

options = {
    "dataset": baseline,
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
    print(f"\nVariables in {baseline}:", hf.get_variables({"dataset": baseline}))
    print("Edit 'options' in this script (dataset / temporal_resolution / dates) and retry.")
    sys.exit(1)

wtd = np.nanmean(data, axis=0) if data.ndim == 3 else data
os.makedirs("outputs", exist_ok=True)
out = f"outputs/wtd_parflow_{grid}_simulated.npy"
np.save(out, wtd)
print(f"Saved {out}  shape={wtd.shape}  min={np.nanmin(wtd):.2f} m  "
      f"mean={np.nanmean(wtd):.2f} m  max={np.nanmax(wtd):.2f} m")
print("Plot it with:  python plot_wtd.py", out)
