"""Step 3: compute water table depth from your ParFlow run's pressure output.

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
