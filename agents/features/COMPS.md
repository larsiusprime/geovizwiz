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