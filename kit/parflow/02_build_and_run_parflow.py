"""Step 2: build a ParFlow-CLM run for your region with HydroFrame subsettools
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

from common import DATASETS, load_config, register_hydroframe

ap = argparse.ArgumentParser()
ap.add_argument("--build-only", action="store_true", help="prepare inputs but do not run ParFlow")
args = ap.parse_args()

cfg = load_config()
b, pf, runname = cfg["bbox"], cfg["parflow"], cfg["runname"]
grid = pf.get("grid", "conus2")
ds = DATASETS[grid]
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
st.subset_static(ij_bounds, dataset=ds["domain"], write_dir=static_dir)
st.config_clm(ij_bounds, start=pf["start"], end=pf["end"], dataset=ds["baseline"], write_dir=static_dir)

# 3. Initial pressure from the national baseline simulation
init_press = st.subset_press_init(ij_bounds, dataset=ds["baseline"], date=pf["start"],
                                  write_dir=static_dir, time_zone="UTC")

# 4. Climate forcing (CW3E for CONUS2, NLDAS2 for CONUS1) for the run period
st.subset_forcing(ij_bounds, grid=grid, start=pf["start"], end=pf["end"], dataset=ds["forcing"],
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
