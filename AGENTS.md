This is a repository that hosts various GIS related utility apps. There are two major types of apps

"viz" -- a nodeJS based 3D visualizer app
"util" -- various vanillaJS, standard HTML+JS standalone utility apps

DEPLOYMENT
----------
This app is deployed to Github pages. The workflow is specified in .github/workflows. 
The app is deployed as a node app. The contents of /site, /viz, and /util, are copied into the deploy destination such that the site has this basic structure:

index.html
viz/
util/

There is a deploy-local.js node script that is ONLY there to be used to deploy the app locally for testing. A github actions workflow does the actual live deployment.

VIZ APP
-------

The VIZ app is a visualization tool that allows the user to visualize GIS data on a map. Think of it as "Photoshop for GIS", a lightweight alternative to QGIS and ArcGIS.

There are two main components to the VIZ app: the toolbar and the map.

## Toolbar

The toolbar contains various tools the user can use. These are buttons with SVG icons and hovertext. Only one tool can be active at a time. Tools may optionally have hotkeys assigned to them,
and certain tools (such as the select tool) have sub-tools. Any tool button with sub-tools allows access to the sub tools by clicking and holding it, which will open a sub menu exposing the sub tools.

Most tools will simply open a menu. All Menus should inherit the same basic windowing behavior:
  - The menu should have a draggable top bar, and a minimize/hide button that closes the menu (makes it invisible)
  - The menu should be hidden by default on start
  - The menu can be moved around the screen
  - The menu should not overlap any other menu or go off the screen or overlap the toolbar



UTIL APPS
---------
These apps share styling and code. They have the following things in common:

- Plain vanilla JS + HTML. No node stuff, typescript, react, or anything like that.
- All dependencies vendored locally under util/vendor
- All source code contained under util/src
- App-specific source code is in util/src/apps, the other folders are shared code libraries
- Each app has its own html page under "util"

FETCH
-----
This app has a multi-stage step by step process, akin to a wizard, where the user can enter an ArcGIS endpoint URL, fetch the layers, preview metadata, and download the contents as a standards-compliant GeoParquet file.

CONVERT
-----
This app has a multi-stage step by step process, akin to a wizard, where the user can upload a GIS data file, inspect the contents, select another data format, convert it to that format, and download the results.

It shares code with the other /util/ apps. It's own unique app logic is in /apps/converterApp.js 
It uses the exact same styling and structure as fetch.html, but has different content and logic. 

Step 1: The user uploads a file. They can drag and drop into a drag-n-drop field, or they can click "browse" to browse for the file. Once the file is provided the result is the same.

Step 2: The file is processed. The app does the following:
- Identifies the file name and file format
- Points out any errors

The app has a list of supported input formats. It is exactly this:

- Geoparquet (which MUST be supplied with the extension .parquet or .geoparquet)
- ESRI Shapefile (which MUST be supplied as a zip file with the extension shp.zip)
- Geopackage (which MUST be supplied with the extension .gpkg)
- GeoJSON (which MUST be supplied with the extension .geojson, .json, or .geo.json)

If the user uploads one of these, the app notes that it is a valid format and they may proceed to Step 3 (convert).
If the user uploads anything else, the app notes that it is not a valid format, why, and tells them to go back and try uploading a different file.

The app reads the supplied file, shows progress information while its loading (with an option to gracefully cancel), and, once loaded, displays the file metadata.
Once the file is read and inspected, the user may proceed to step 3, convert.

Step 3: The file is ready for conversion. The user selects a file format.

The app has a list of supported output formats. It is exactly this:

- GeoParquet (.geoparquet)
- Geopackage (.gpkg)

Once the user selects the format, a "convert" button becomes live. They can click it and it will start the conversion process.
The conversion process will show progress information (with an option to gracefully cancel), exactly as was done in step 2. When processing is done, a "save file" button will become live, and the user will be prompted to save the file they have processed.

When the user clicks "save file", the processed file will be saved to their computer.

CONSTRUCT
-----
This app has a multi-stage step by step process, akin to a wizard, where the user uploads a geometry source and a tabular data source, picks a common key, previews match quality, constructs a joined dataset, and downloads the assembled result.

It shares code with the other /util/ apps. Its unique app logic lives in /apps/constructApp.js (and any construct-specific workers). It uses the same styling and workflow paradigm as fetch.html/convert.html.

Step 1: Upload LEFT and RIGHT sources.
- LEFT is the geometry side and RIGHT is the data side.
- UI must explicitly label LEFT as geometry and RIGHT as data.
- If LEFT has no valid geometry, block progress and warn.
- If RIGHT has geometry, warn that RIGHT-side geometry is ignored and provide a one-click swap-sides button.
- If both sides have geometry, warn that only LEFT geometry is retained and provide a swap-sides button.
- File-upload only in this version (no URL fetch).

Supported input formats (for both sides)
- Geoparquet (.parquet or .geoparquet)
- ESRI Shapefile (.shp.zip)
- Geopackage (.gpkg)
- GeoJSON (.geojson, .json, .geo.json)
- CSV (.csv)

When a format contains geometry and is used as the RIGHT/data side, geometry is stripped for join purposes.

Layer/geometry rules
- User must choose one geometry layer when a source contains multiple layers.
- Mixed geometry types can be loaded, but construct only supports Polygon and MultiPolygon output geometries in this version.
- Preserve geometry column name, CRS, and metadata where possible.

CSV parsing behavior
- Auto-detect delimiter, first-row-header=true, UTF-8 by default.
- Show a preview of parsed rows.
- Expose CSV parse controls and update preview live so users can correct parsing before proceeding.

Step 2: Configure key matching and deduplication.
- Single-key equi-join in this version.
- Join types supported: LEFT, RIGHT, INNER.
- UI must explain join type behavior (tooltip/help text).
- Null/empty keys are not joinable and must be counted/reported as non-matches.

Key normalization options (user-configurable)
- Slugify
- Case-sensitive or case-insensitive matching
- Trim whitespace
- Strip leading and/or trailing zeroes
- Remove specific characters (user-supplied list)
- Replace specific characters (user-supplied find/replace)

Deduplication (configurable on BOTH LEFT and RIGHT)
- User chooses dedup key (join key or another field)
- User chooses sort method (single-field by default, multi-field supported)
- Keep-first semantics after sorting; all other duplicates are discarded
- UI must explain retained/discarded behavior
- Future iterations may add aggregation-based deduplication

Normalized key output strategy
- If normalized matching is enabled, let user choose output key strategy:
  - keep original LEFT key
  - keep original RIGHT key
  - keep normalized key
  - keep all as separate columns

Step 3: Preview match quality and compatibility.
Before construct can run, show:
- matched row count
- unmatched LEFT count
- unmatched RIGHT count
- null/empty key counts per side
- duplicate-key diagnostics/warnings
- sample output schema/columns

For long-running operations, show progress + cancel, same paradigm as other apps.
Logs persist during the browser session, but must reset if user returns to an earlier step and changes context.

Step 4: Construct dataset.
- Execute the join using selected join type and options.
- Allow cancel during processing.
- Inline step messaging required; persistent log panel for detailed events.

Step 5: Download output.
Supported output formats:
- Zipped ESRI Shapefile (.shp.zip)
- GeoPackage (.gpkg)
- GeoParquet (.geoparquet)

Default output filename:
- <base>_constructed_YYYYMMDD_HHmm.<ext>
- User can override with a custom name.

Shapefile field-name constraints
- Preflight field names before export.
- If constraints are violated, present a field remapping screen:
  - auto-fix option
  - manual edit with live validation
  - proceed only when valid
- Users may choose to skip remap and accept auto-truncation/coercion with explicit warning.

Format compatibility/coercion behavior
- Warn when output format forces coercion (for example geometry normalization).
- Let user go back and choose another output format, or accept coercion and proceed.

Processing model
- All processing is local/in-browser only.

