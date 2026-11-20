# WTD Run Kit

A small website that generates **ready-to-run packages for computing water table depth (WTD)**.

1. Draw a region on the map
2. Choose a model: **ParFlow (CONUS2 subset)**, **MODFLOW 6 (FloPy)**, or the **Fan et al. (2013) global WTD map**
3. Download a zip with the environment file, run scripts, plotting script and step-by-step README

Everything happens in the browser. There's no server, so the site runs free on GitHub Pages. Users run the models on their own computer or cluster.

## Models in the packages

| Model | Where | What the package does |
|---|---|---|
| ParFlow-CLM (CONUS2) | Contiguous US | Quick download of existing ParFlow-CONUS2 simulated WTD (`hf_hydrodata`), plus a full subset-and-run workflow with HydroFrame `subsettools`, plus WTD post-processing |
| MODFLOW 6 | Anywhere | Builds a steady-state unconfined model from a DEM (auto-downloaded in the US from USGS 3DEP) with drains at land surface; outputs a WTD GeoTIFF |
| Fan et al. 2013 | Global | Clips the published ~1 km equilibrium WTD map to the region |

## Publish on GitHub Pages

1. Create a new repository on GitHub (e.g. `wtd-run-kit`) and upload the contents of this folder (or `git push` it).
2. In the repository, go to **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**, branch `main`, folder `/ (root)`, then **Save**.
4. After a minute your site is live at `https://<your-username>.github.io/wtd-run-kit/`.

To run it locally, run `python -m http.server` in this folder and open http://localhost:8000.

## Project layout

```
index.html          page layout
css/style.css       styling
js/app.js           map, form, size estimate, zip download
js/templates.js     the package contents for each model (edit here to change scripts)
```

### Adding another model
Add a new radio option in `index.html`, then add a new branch in `build()` in `js/templates.js` that returns `{ "filename": "contents" }`. Scripts should read `config.json` for the region and settings.

## Status
- MODFLOW and global-map packages were tested end to end, with a synthetic DEM and a sample NetCDF file.
- The ParFlow package follows the HydroFrame subsettools 2.x workflow. Testing it needs a HydroFrame account and a ParFlow install, so check it against the [official examples](https://github.com/hydroframe/subsettools) if the APIs change.

## Credits
ParFlow · HydroFrame (subsettools, hf_hydrodata, ParFlow-CONUS2) · USGS MODFLOW 6 & FloPy · HyRiver py3dep · Fan, Li & Miguez-Macho (2013), *Science* 339:940–943.

## License
MIT. See `LICENSE`.
