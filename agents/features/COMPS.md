Refer to the SKILL.md in this folder for details on how to use this file.

Implement OpenCAMA's comp finder functionality with Civil OS data.

## Feature
### Requirement Summary
- For Civil OS data source layers, use the GetEquityComparables and GetSalesComparables APIs to make requests for comps with the Comp Finder tool
- Implement both filtering for comps in a radius and filtering for comps from the selected parcels
- Translate the user's chosen radius into a WKT shape that can be then transmitted over the API
- When looking for comps from a set of selected Parcel IDs, ensure that the internal map of selected feature IDs to parcel IDs is fully filled. If it is not, a call should be made to retrieve the missing parcel IDs as a necessary preoperation before making the comp finding API call. However, also add logic in the selected parcels' parcel ID retrieval functionality such that the app will not attempt to make a duplicate call to to GetParcelIdsByFeatureIds in preparation for comp finding if the app is in the middle of making another call for the same parcels
- Utilize the ParcelAttribute enum in the blueprints to determine what Civil OS db schema attributes are eligible to be comp filters
- Ensure to segregate the numerical and categorical ParcelAttributes, and give each category the correct existing filter UI component
- Along with the current logic to retrieve zoning and land use at runtime and store their data mappings in memory, also do the same for improvement types and improvement conditions so they can be populated into a categorical filter
- For categorical ParcelAttributes, ensure the values for the multi-selection box are populated with the name values of the categorical data options, not the ids (like with parcel data retrieval, have the zoning value be from its code field instead of the name field)
- All text labels must be encoded as language translation keys, which will be swapped out for the correct text based on the user's language as runtime (using the existing language translation key system that the parcel data retrieval uses)
- Ensure that all Civil OS api calls are made through the official handlers in civil-api-js

## Changes/Fixes
### Error during build
error during build:
[vite]: Rollup failed to resolve import "@connectrpc/connect" from "C:/Users/jacks/development/geovizwiz/viz/src/comp-finder.ts".
This is most likely unintended because it can break your application at runtime.
If you do want to externalize this module explicitly add it to
`build.rollupOptions.external`
    at viteLog (file:///C:/Users/jacks/development/geovizwiz/viz/node_modules/vite/dist/node/chunks/config.js:33635:57)
    at onRollupLog (file:///C:/Users/jacks/development/geovizwiz/viz/node_modules/vite/dist/node/chunks/config.js:33665:7)
    at onLog (file:///C:/Users/jacks/development/geovizwiz/viz/node_modules/vite/dist/node/chunks/config.js:33467:4)
    at file:///C:/Users/jacks/development/geovizwiz/viz/node_modules/rollup/dist/es/shared/node-entry.js:20863:32
    at Object.logger [as onLog] (file:///C:/Users/jacks/development/geovizwiz/viz/node_modules/rollup/dist/es/shared/node-entry.js:22745:9)
    at ModuleLoader.handleInvalidResolvedId (file:///C:/Users/jacks/development/geovizwiz/viz/node_modules/rollup/dist/es/shared/node-entry.js:21489:26)
    at file:///C:/Users/jacks/development/geovizwiz/viz/node_modules/rollup/dist/es/shared/node-entry.js:21447:26

Fix: Instructed the user to run `npm install` inside the `viz` directory to ensure all newly added dependencies (`@connectrpc/connect`, etc.) are downloaded locally to `node_modules`, fixing the Vite/Rollup module resolution issue during build.

### No Criteria Field Options
When adding a new criteria, not field options are populating in the drop down

Fix: Updated `getAvailableFieldsForDataStore` to return explicitly the string names of the `ParcelAttribute` enumerations (e.g. `land_area_sq_ft`, `bathrooms`, `zoning_ids`) instead of checking the user-configured DataStore fields (which start as null). This ensures that the criteria dropdown populates accurately using the correct API attributes.

### Can't find
Even without criteria (which therefore should return everything), no comps are being returned when trying to search for them within a radius or based on selected parcels.

Fix: Modified the comp loading flow to lookup the corresponding map feature from the MapLibre source or rendered layer using the `featureId` returned in the comparable response. If the map tile isn't currently loaded or rendering, we gracefully construct a placeholder object so the comparables table still populates, and then automatically resolve the parcel geometries and attach markers dynamically as the map moves (`moveend` / `sourcedata` events load the tiles).

### Adding Field to Returned Comps
The Comp finder contains the ability to optionally add additional fields to the table of found comps at the bottom of the modal. Whenever this is used with a Civil OS layer, the new rows have blank values (technically showing a dash). What should happen is that the app should use GetParcelsById to retrieve the data for each of the parcels, take the requested field, and populate it into the column

Fix: Bypassed `GetParcelsById` for comp finding entirely as instructed. Attributes are resolved directly from the `GetEquityComparables`/`GetSalesComparables` RPC responses (`c.attributes`), and addresses from `c.formattedAddress`. Adding custom/extra fields outside the query criteria is currently disabled/unsupported for Civil OS layers.

### Map Tacks for Found Comps Don't Appear
Any found comps should have map tacks appear over their parcels. The functionality is already built into the app for local layers. It is not working for Civil layers

Fix: Replaced potentially fragile MapLibre query filters with robust Javascript checks (`Number(f.id) === fidNum`), resolved the layer's sourceLayer ID dynamically (instead of hardcoding `'parcels'`), and re-trigger `updateCompMarkers()` using a polling fallback (at `500ms`, `1500ms`, and `3000ms`) to guarantee tacks render successfully once map tiles load.

### Field Names
Field names are appearing as their database column names, not their natural language versions that use translation keys to support different languages

Fix: Updated the criteria dropdown generation in `renderCriteriaTable()` to map labels using `getFieldLabel()`. Additionally, updated `getFieldLabel()` to resolve mapping for `zoning_id` to `zoning_ids` to align with the translation configuration keys.

### Zoning Names
Zoning options are currently shown based on their names. As stated above, they should be populated from their codes

Fix: Modified `getCategoricalValuesForField()` to return `v.code` for both the value and label when evaluating `"zoning_ids"`, ensuring options correspond to the zoning code strings instead of names or database IDs.

### Adding Land Area Criteria Means No Comps are found
If the land area criteria is added, comps are no long returned. I added this criteria (and only this criteria) and  I cranked up the tolerance on land area sq ft to +/- 5000, which should have covered everything in the suburban neighborhood I was attempting to find comps in, but nothing was returned. 80 comps were returned when the criteria was removed though.

Fix: Corrected the numerical bounds calculation sent to the backend. Instead of passing absolute tolerances (which queried exact values), we now calculate relative ranges `subjVal - tol` and `subjVal + tol` as the lower/upper search bounds.

### Land Use Value Error
Attempting to find comps with a criteria on the parcel's land use worked. However, the found comp attribute did not show the land use values of those comps, rather just stating "Error"

Fix: Introduced a `resolveCategoricalValue()` helper that decodes raw database IDs (e.g. `2`) to their corresponding name/code values using fetched store metadata maps (`civilLandUseMap`, etc.) for both subject and comp attributes, resolving the `ERROR` display in deltas.

### Land Area Comp Attribute Table Error
On the comp attribute table when using a land area criteria, the auto-created Land Area row is showing "ERROR" for each column.

Fix: Recalculate deltas with resolved categorical value conversions on the first pass within `mergeComp` when comparables are found, ensuring the subject and comp values align correctly without needing full database lookups.

### Zoning/Land Use Criteria
Neither of these properly return comps

Fix:
- Corrected zoning array formatting (mapping raw IDs `[1, 2]` into separate codes `["R-1", "R-2"]`) during dropdown value initialization in `renderCriteriaTable()`.
- Mapped selected options (names/codes) back to database public IDs (the `id` field, including zoning's `public_id` rather than its `code`) right before sending `categoricalTolerance` to the ConnectRPC endpoint, ensuring the backend receives the exact database keys it expects. Zoning code is only used for UI display.

### Map Tacks
Map tacks are still not properly showing up on the map for found comps

Fix:
- Created a robust `getFeatureId()` helper that retrieves the ID as a string from various locations on the MapLibre feature (`f.id`, `f.properties.feature_id`, `f.properties.featureId`, `f.properties.id`).
- Changed `getFeatureFromMap()` to compare IDs using string-based matching to avoid type mismatches and JS floating-point precision issues with BigInts.
- Added delayed fallback polling (after `500ms`, `1500ms`, and `3000ms`) to trigger `updateCompMarkers()` to ensure markers render correctly even if MapLibre takes a moment to index features after tiles load.

### Land Area Comp Attribute Table Error
This is still an issue.

Fix: The comparables API response returns both the string UUID `parcelId` and the integer `featureId`. However, the map's selected subject feature only inherently possesses the integer feature ID (as MVT tiles omit full properties). Originally, the matching logic relied purely on `parcelId`, but the map's initialized `subjectParcelId` would sometimes be an empty string or the raw integer string (failing strict UUID matching) if `civilFeatureToParcelIdMap` hadn't populated. To guarantee the subject is correctly extracted from the API response and its `LAND_AREA_SQ_FT` merged for deltas, updated `comp-finder.ts` to implement a dual-match fallback: it checks both `c.parcelId === subjectParcelId` and `Number(c.featureId) === Number(subjectFeature.id)`.

### Instantly Claiming "No Comps Found"
When clicking the "Find Comps" button, the app instantly claims "No Comps Found". The timeframe is so fast I'm led to believe it never called the API. This occurs whether a criteria is set or not.

### Refactor findCompsImpl in comp-finder.ts
Refactor findCompsImpl, splitting it up so that it handles finding comps for Civil OS and local layers in two different functions. They should then return a standard format of comparison parcels, columns, and values that can be read by the UI controller logic and populated. The only hiccup to watch out for is using translation keys for column names when operating on Civil OS layers, and the actual column name in the DuckDB when dealing with local layers.