Refer to the SKILL.md in this folder for details on how to use this file.

## Feature
### Requirement Summary
- Wire up the "Field to visualize" to show options based on the values of the civil-blueprints ParcelAttributes enum
- Utilize localization keys for the option values
- Depending on the selected visualization field option, using the single attribute APIs to make calls to the Civil OS instance for the data for the currently rendered parcels
- Once the attribute data is returned, store it in internal cache maps to allow for easy re-retrieval of the data for the parcels if they are de-rendered and re-rendered without calling the API again
- Once the data is loaded, utilize the existing "Paint" logic and options to color the parcels based on their returned value 
- Ensure that 3D visualization is still supported for Civil OS layers

## Changes/Fixes
### July 10, 2026
- Wired the "Field to visualize" dropdown to populate with the 13 options based on the `ParcelAttribute` enum when a Civil OS layer is active.
- Integrated translation-based localization mapping inside the option building logic to map raw snake_case keys to their human-readable translations.
- Configured dynamic background on-demand fetching when the map pans/zooms/renders: queries rendered vector features in the viewport, identifies missing attributes, fetches them in chunked gRPC requests, and merges them in a newly defined global `civilAttributeCache` map.
- Updated MapLibre's `feature-state` for visible features on the fly, allowing style paint expressions (`fill-color`, `fill-opacity`, `fill-extrusion-color`, `fill-extrusion-height`) to fetch value from `['feature-state', S.currentField]` and paint dynamically.
- Implemented automatic 2D/3D type switching for Civil OS layers: when 3D mode is toggled, the map layer is recreated as a `fill-extrusion` type, successfully painting 3D parcel structures.
- Added localization integration inside the info/inspect popup, merging properties from the attribute cache for the hovered/inspected parcel.

### Debug
- Implemented a unified `logDebug` helper in `rendering.ts` logging to both `(window as any).vizDesktop` (desktop environment logs) and `console.log` (browser).
- Added comprehensive logging throughout `applyExtrusion`, `applyGrayRendering`, `fetchAndCacheCivilAttributes`, `updateCivilFeatureStates`, and `checkAndFetchCivilAttributes`.
- Prints details on active field, field types, 3D mode state, queried features, cache status, pending requests, chunks fetched, and computed min/max statistics.

### Field Visualization Not Working
- Identified a bug where `getParcelId` was called with `f.properties || {}` instead of the feature object `f` itself in four crucial lookup/cache updates within `rendering.ts`.
- Because `getParcelId` checks `feature.properties` first, passing `f.properties` caused `feature.properties` to evaluate to `undefined`, yielding empty parcel IDs and preventing attribute fetching and cached styling.
- Resolved this by updating all calls to pass the full feature object `f`, successfully restoring on-demand attribute querying, caching, and color coloring/extrusion paint applications.

### Direct ByFeatureId Attribute Retrieval
- Removed the intermediate selection mapping step (`resolveCivilSelectionIds`).
- Switched all single-attribute fetch methods in `getSingleAttributeMethodForField` to their corresponding `ByFeatureId` endpoints (e.g. `getLandAreaSqftByFeatureId`, `getBedroomsByFeatureId`, etc.).
- The single attribute fetching now accepts numeric map feature IDs directly, removing the need for parcel UUID translation.
- Updated `civilAttributeCache` keys to be stringified feature IDs (`numericFid`), allowing direct state updates, stats computations, and inspect popup merges based on feature IDs.

### Endless Loop
The map attempts to lookup, but gets an endless loop of this:

[Renderer][INFO] [Map Painting] Successfully fetched and cached land_area_sq_ft values for 0 features.
[Renderer][INFO] [Map Painting] Fetching land_area_sq_ft via getLandAreaSqftByFeatureId for 200 features...
[Renderer][INFO] [Map Painting] Successfully fetched and cached land_area_sq_ft values for 0 features.
[Renderer][INFO] [Map Painting] Fetching land_area_sq_ft via getLandAreaSqftByFeatureId for 200 features...
[Renderer][INFO] [Map Painting] Successfully fetched and cached land_area_sq_ft values for 0 features.
[Renderer][INFO] [Map Painting] Fetching land_area_sq_ft via getLandAreaSqftByFeatureId for 200 features...
[Renderer][INFO] [Map Painting] Successfully fetched and cached land_area_sq_ft values for 0 features.
[Renderer][INFO] [Map Painting] Fetching land_area_sq_ft via getLandAreaSqftByFeatureId for 200 features...
[Renderer][INFO] [Map Painting] Successfully fetched and cached land_area_sq_ft values for 0 features.
[Renderer][INFO] [Map Painting] Fetching land_area_sq_ft via getLandAreaSqftByFeatureId for 200 features...

### Invalid Feature IDs
- **Root Cause**: MapLibre auto-generates internal sequential integer feature IDs (like `500744`) if `promoteId` is not specified in the source. Because the code queried the backend database with these internal MapLibre IDs, the database returned empty datasets, resulting in endless querying cycles.
- **Resolution**:
  1. Configured `promoteId: 'feature_id'` on the vector map source configuration in `rendering.ts`.
  2. Prioritized `feature.properties.feature_id` and `feature.properties.featureId` in `getParcelId` in `selection.ts`, `checkAndFetchCivilAttributes` in `rendering.ts`, and selection routines.
  3. Added a strict validation check `hasRealFeatureId` in the feature processors to check for the presence of the `feature_id`/`featureId` properties or valid numeric database feature IDs (> 1000000), filtering out any raw MapLibre auto-generated IDs.