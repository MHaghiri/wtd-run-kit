/* WTD Run Kit — builds the files of a run kit for a model + region.
 * WTDKits.build(model, cfg, fetchText) -> Promise<{ path: content }>
 * fetchText(path) loads a script from the repo's kit/ folder.
 */
(function (root) {
  "use strict";
  const F = "```";
  const SHARED = ["kit/shared/plot_wtd.py", "kit/shared/clip_wtd.py", "kit/shared/compare_wtd.py"];

  // ---------------------------------------------------------------- per-model instructions (markdown)
  const GUIDE = {
    parflow: (c) => ({
      quick: [
        "Create a free HydroFrame account and API PIN at https://hydrogen.princeton.edu/ , then set them:",
        `${F}bash\nexport HF_EMAIL="you@example.com"   # Windows cmd: set HF_EMAIL=you@example.com\nexport HF_PIN="1234"\n${F}`,
        "Download WTD already simulated by the national model for your box and dates:",
        `${F}bash\npython 01_quick_simulated_wtd.py\npython plot_wtd.py outputs/wtd_parflow_${c.pf.grid}_simulated.npy\n${F}`,
      ],
      full: [
        "Install ParFlow (Docker image `parflow/parflow`, a cluster module, or build from https://github.com/parflow/parflow) and set `PARFLOW_DIR`. Then:",
        `${F}bash\npython 02_build_and_run_parflow.py      # subsettools cuts inputs, then runs ParFlow-CLM\npython 03_wtd_from_parflow.py          # pressure -> water table depth\npython plot_wtd.py outputs/wtd_parflow_run_mean.npy\n${F}`,
        "Scripts follow the subsettools 2.x workflow. If an API changed, compare with https://github.com/hydroframe/subsettools .",
      ],
    }),
    modflow: () => ({
      quick: [
        `${F}bash\npython build_and_run_mf6.py                 # US: DEM from USGS 3DEP\npython build_and_run_mf6.py --dem dem.tif   # elsewhere: your DEM GeoTIFF\npython plot_wtd.py outputs/wtd_modflow.tif\n${F}`,
        "The MODFLOW 6 executable downloads automatically if `mf6` isn't installed.",
      ],
      full: [
        "Tune `config.json`: a higher hydraulic conductivity K or lower recharge gives a deeper water table. Calibrate K against wells (e.g. USGS NWIS) before trusting absolute depths, and replace uniform K/recharge with maps (e.g. GLHYMPS) for real studies.",
      ],
    }),
    wtm: () => ({
      quick: [
        "Download the published WTM steady-state water tables (present day and Last Glacial Maximum, North America) from HydroShare: https://doi.org/10.4211/hs.9eaa891ef9c44a19b3d40cdfcb1fe824",
        "If the files store water table **elevation**, subtract a DEM to get depth. If they store depth, clip directly:",
        `${F}bash\npython clip_wtd.py --file <wtm_present_day_file> --name wtm\npython plot_wtd.py outputs/wtd_wtm.tif\n${F}`,
      ],
      full: [
        `${F}bash\ngit clone https://github.com/KCallaghan/WTM.git\n# needs a C++ compiler, CMake and PETSc - follow the WTM README\npython prepare_dem.py --res 0.008333   # ~1 km DEM for your box -> outputs/\n${F}`,
        "WTM inputs: topography, precipitation, evapotranspiration, winter temperature, hydraulic conductivity parameters and sea level. The model paper (GMD 2025, Appendix A1) lists the global datasets used. Build the inputs for your box, set the paths in the WTM parameter file and run it with MPI.",
      ],
    }),
    fan: (c) => ({
      quick: [
        "The data are on a THREDDS server, one NetCDF file per continent (variable `wtd`). For Europe and Asia, for example:",
        `${F}bash\npython get_fan_wtd.py --remote wtd_Europe_and_Asia_CF.nc   # downloads only your box\npython plot_wtd.py outputs/wtd_fan2013.tif\n${F}`,
        "For other continents, open the server's `usc/water-table-depth` folder and use that file name. You can also download a full continent file and run `python get_fan_wtd.py --file <file.nc>`.",
      ],
      full: [
        "This is a published product, so there's nothing to run. Use it as a baseline: `python compare_wtd.py outputs/wtd_fan2013.tif outputs/<other model>.tif`.",
      ],
    }),
    g3m: () => ({
      quick: [
        "Download the published G³M model output (steady state) from Zenodo: https://doi.org/10.5281/zenodo.1315471",
        "Pick the water table depth (or head) layer. If you have head, subtract it from a DEM (see `prepare_dem.py`). Then:",
        `${F}bash\npython clip_wtd.py --file <g3m_wtd_file> --name g3m\npython plot_wtd.py outputs/wtd_g3m.tif\n${F}`,
      ],
      full: [
        "Model code (C++ framework): https://doi.org/10.5281/zenodo.1175540 · project site: http://globalgroundwatermodel.org",
        "G³M is set up for global 5′ runs coupled to WaterGAP. For a regional run, prepare DEM, recharge and conductivity grids for your box (`python prepare_dem.py --res 0.0833`) and follow the framework's example configuration.",
      ],
    }),
    degraaf: () => ({
      quick: [
        "Model outputs: see the data availability statements of de Graaf et al. (2015, HESS, https://doi.org/10.5194/hess-19-823-2015) and (2017, Adv. Water Resour.), or contact the authors (Utrecht University). Its 1 km successor is GLOBGM, which has open GeoTIFFs (choose the GLOBGM kit).",
        `${F}bash\npython clip_wtd.py --file <degraaf_wtd_file> --name degraaf\npython plot_wtd.py outputs/wtd_degraaf.tif\n${F}`,
      ],
      full: [
        "The model is MODFLOW forced by PCR-GLOBWB 2 recharge and surface water levels. Code from the Utrecht hydrology group: https://github.com/UU-Hydro . A global run needs a cluster.",
      ],
    }),
    globgm: () => ({
      quick: [
        "Download `steady-state/globgm-wtd-ss.tif` (steady-state water table depth, m) from the GLOBGM data supplement: https://doi.org/10.24416/UU01-44L775 . Transient monthly WTD for 1958–2015 is also there. The same data are in the Google Earth Engine community catalog.",
        `${F}bash\npython clip_wtd.py --file globgm-wtd-ss.tif --name globgm\npython plot_wtd.py outputs/wtd_globgm.tif\n${F}`,
      ],
      full: [
        `${F}bash\ngit clone https://github.com/UU-Hydro/GLOBGM.git\n${F}`,
        "GLOBGM uses a parallel MODFLOW 6 prototype (MPI) and runs on distributed-memory clusters. Follow the repository README for the input files and tools.",
      ],
    }),
    clm: () => ({
      quick: [
        "If you have CLM/CTSM output, extract the water table depth variable `ZWT` from a **gridded** history file (h0, lat/lon), average it over time and clip it:",
        `${F}bash\npython clip_wtd.py --file <case>.clm2.h0.<date>.nc --var ZWT --time-mean --name clm\npython plot_wtd.py outputs/wtd_clm.tif\n${F}`,
      ],
      full: [
        "Standard CLM/CTSM: https://github.com/ESCOMP/CTSM (CESM). Create a case for your domain (single point or regional mesh) and make sure `ZWT` is written to history.",
        "The lateral groundwater flow module of Zeng et al. (2018) is a research extension of CLM4.5. Contact the authors for the code (https://doi.org/10.1029/2018MS001304).",
      ],
    }),
    wbm: () => ({
      quick: [
        "WBM writes NetCDF outputs. Find the groundwater/water table variable in your run's output list, then:",
        `${F}bash\npython clip_wtd.py --file <wbm_output.nc> --var <groundwater_variable> --time-mean --name wbm\n${F}`,
        "WBM represents groundwater as storage pools. If your configuration outputs storage rather than depth, convert using specific yield before comparing with other models.",
      ],
      full: [
        `${F}bash\ngit clone https://github.com/wsag/WBM.git\n# Singularity container + ancillary data: https://wbm.unh.edu/\n${F}`,
        "Write a WBM init file whose domain covers your bounding box (see `config.json`) and follow the quick-start manual in the repository.",
      ],
    }),
    vicwur: () => ({
      quick: [
        "From a VIC-WUR (MODFLOW-coupled) run, clip the groundwater depth / head output:",
        `${F}bash\npython clip_wtd.py --file <vicwur_output.nc> --var <wtd_variable> --time-mean --name vicwur\n${F}`,
      ],
      full: [
        `${F}bash\ngit clone https://github.com/wur-wsg/VIC.git\n# documentation: https://vicwur.readthedocs.io/\n${F}`,
        "VIC-WUR v3.0 couples VIC-WUR with MODFLOW 6 to simulate groundwater heads. Use that coupled setup to get a water table depth. Parameter-building scripts are in https://github.com/BramDr/VIC_support .",
      ],
    }),
    westerhoff: () => ({
      quick: [
        "Download the zipped GeoTIFFs from GNS Science: https://www.gns.cri.nz/data-and-resources/gns-national-water-table-interactive-map/ . The zip holds hydraulic head (masl) and water table depth (mbgl) in NZTM (EPSG:2193). Unzip, then:",
        `${F}bash\npython clip_wtd.py --file <nz_wtd_file>.tif --name westerhoff_nz\npython plot_wtd.py outputs/wtd_westerhoff_nz.tif\n${F}`,
        "License CC BY 4.0. In figures, credit: **© GNS Science 2019**.",
      ],
      full: [
        "The NWT model applies the Fan et al. equilibrium method with national NZ inputs. To rerun it for another area, start from the Fan approach (Fan kit) with local terrain, geology and recharge.",
      ],
    }),
  };

  // ---------------------------------------------------------------- environment.yml
  function envYml(m) {
    const conda = ["python=3.11", "numpy", "scipy", "matplotlib", "xarray", "netcdf4", "rioxarray", "rasterio", "pyproj"]
      .concat((m.env && m.env.conda) || []);
    const pip = (m.env && m.env.pip) || [];
    let s = `name: wtd-${m.id}\nchannels:\n  - conda-forge\ndependencies:\n` + conda.map((d) => `  - ${d}\n`).join("");
    if (pip.length) s += "  - pip\n  - pip:\n" + pip.map((d) => `      - ${d}\n`).join("");
    return s;
  }

  function configJson(m, c) {
    return JSON.stringify({
      runname: c.runname, model: m.id, model_name: m.name,
      bbox: { south: c.south, north: c.north, west: c.west, east: c.east },
      parflow: m.id === "parflow" ? { grid: c.pf.grid, start: c.pf.start, end: c.pf.end, P: c.pf.p, Q: c.pf.q } : undefined,
      modflow: m.id === "modflow" ? { cell_size_m: c.mf.cell, k_m_per_day: c.mf.k, recharge_mm_per_yr: c.mf.rch, aquifer_thickness_m: c.mf.thk } : undefined,
      created_with: "WTD Run Kit (https://mhaghiri.github.io/wtd-run-kit/)",
      created: new Date().toISOString(),
    }, null, 2) + "\n";
  }

  function readme(m, c, cov, fileNames) {
    const g = GUIDE[m.id](c);
    const L = [];
    L.push(`# ${c.runname} · ${m.name} water table depth kit`, "");
    L.push(`> Generated by **WTD Run Kit**. Region and settings are in \`config.json\`.`, "");
    L.push("| | |", "|---|---|");
    L.push(`| **Region** | S ${c.south}, N ${c.north}, W ${c.west}, E ${c.east} |`);
    L.push(`| **Model** | ${m.name} (${m.authors}) |`);
    L.push(`| **Coverage** | ${cov.label} |`);
    L.push(`| **Resolution** | ${m.resolution} |`);
    L.push(`| **Approach** | ${m.approach} |`);
    L.push(`| **Typical time** | ${m.runtime} |`);
    if (m.code) L.push(`| **Model code** | ${m.code} |`);
    if (m.data) L.push(`| **Data / outputs** | ${m.data} |`);
    if (m.id === "parflow") L.push(`| **Grid / period** | ${c.pf.grid.toUpperCase()} · ${c.pf.start} → ${c.pf.end} · ${c.pf.p}×${c.pf.q} processors |`);
    if (m.id === "modflow") L.push(`| **Parameters** | cell ${c.mf.cell} m · K ${c.mf.k} m/day · recharge ${c.mf.rch} mm/yr · thickness ${c.mf.thk} m |`);
    L.push("");
    L.push("## 0 · Set up Python", "", `${F}bash\nconda env create -f environment.yml\nconda activate wtd-${m.id}\n${F}`, "");
    L.push("## 1 · Quick path: get WTD for your region", "", g.quick.join("\n\n"), "");
    L.push("## 2 · Full path: run the model yourself", "", g.full.join("\n\n"), "");
    L.push("## 3 · Visualize and compare", "",
      "`plot_wtd.py` makes a map plus a depth histogram. `compare_wtd.py` puts two models side by side, with a difference map, a scatter plot, and bias, RMSE and correlation:", "",
      `${F}bash\npython compare_wtd.py outputs/wtd_A.tif outputs/wtd_B.tif --labels "Model A" "Model B"\n${F}`, "");
    L.push("## Files", "", ...fileNames.map((f) => `- \`${f}\``), "");
    L.push("## Cite", "", m.cite, "");
    L.push("---", "Packages are starting points. Check parameters, units (depth vs. elevation) and licences for your study.");
    return L.join("\n") + "\n";
  }

  async function build(m, c, cov, fetchText) {
    const files = {};
    const paths = SHARED.concat(m.files);
    const texts = await Promise.all(paths.map((p) => fetchText(p)));
    paths.forEach((p, i) => { files[p.split("/").pop()] = texts[i]; });
    files["config.json"] = configJson(m, c);
    files["environment.yml"] = envYml(m);
    files[".gitignore"] = "outputs/\nparflow_run/\nmf6_run/\nbin/\n__pycache__/\n*.pfb\n";
    const names = ["README.md"].concat(Object.keys(files));
    files["README.md"] = readme(m, c, cov, names);
    return files;
  }

  const api = { build, GUIDE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.WTDKits = api;
})(this);
