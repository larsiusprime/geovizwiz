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

