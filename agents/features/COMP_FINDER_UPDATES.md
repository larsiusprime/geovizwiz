Refer to the SKILL.md in this folder for details on how to use this file.

## Feature
### Requirement Summary
- Modify the comp finder tool to swap the localization keys (and their translations) for the new primary improvement attribute replacements
- When a user adds a new row to the comp table after finding comps, use the new single attribute Get APIs from the parcel service to retrieve the attributes from the comp parcels (using their parcel ID). Then use those values to calculate their deviation from the subject parcel, and show that deviation (if numeric, or the value with a marker saying its different if its categorical) in the table

## Changes/Fixes
### July 9, 2026
- Swapped old improvement/condition keys in localization translation files `en.json` and `es.json` with the new `primary_improvement_` keys:
  - `improvement_year_built` -> `primary_improvement_year_built`
  - `improvement_effective_year_built` -> `primary_improvement_effective_year_built`
  - `condition_id` -> `primary_improvement_condition_id`
  - `improvement_type_id` -> `primary_improvement_type_id`
- Updated `comp-finder.ts` and `main.ts` to map and format using the new keys.
- Implemented asynchronous attribute fetching for extra fields via client single-attribute gRPC endpoints.
- Calculated and rendered deviations in the comps table for numeric extra fields, and appended a `(Different)` marker for categorical differences.

### Add Comp Finding Debug
Instrument the code that implements the comp table and its logic with debug code to help deal with issues involving populating it
- Added detailed log outputs tracing candidate attributes, mapping keys, API response structures, and single-attribute fetching.

### Do Not Retrieve Both Equity and Sales Comps
For now, only retrieve equity comps by calling GetEquityComparables
- Removed the `GetSalesComparables` call and refined the mapping logic to only retrieve comps from `GetEquityComparables`.

### Post-Search Attribute Adding to Comp Table Empty
When adding a new attribute row to the comp table, it is still failing to actually populate a value. Instead, numeric rows have "-" for every column, and categorical rows have "=" for every column except for the Subject column, which is "-"
- Fixed key resolution for candidates (handling both `parcelId`/`parcel_id`, `featureId`/`feature_id`, and `formattedAddress`/`formatted_address` mapping casing in JSON responses) so that IDs are properly collected and passed.
- Added mapped attributes directly to the subject's feature properties block to ensure consistency with comp parcels.

### Attribute Rows Returned by Initial Comp query showing "ERROR"
Apart from the problem of getting attribute values after the comp search, any attribute values that should have been returned by the comp search (in the response of GetEquityComparables, which is determined by the filters added to the request) are having values of "ERROR" on the comp table, except for the address and the parcel ID
- Aligned field names between subject fallback attributes and comp attributes (mapping `total_bedrooms` to `bedrooms`, `total_bathrooms` to `bathrooms`, etc. in subject mapping).
- Added an extra client query calling `getPrimaryImprovementTypeIdByParcelId` for the subject parcel to correctly fetch and map `primary_improvement_type_id`.

### Infinite Login Loop
Attempting to open up an existing project with a Civil OS data source leads to an infinite login loop, with the process returning these errors:

OIDC Desktop redirect server listening on port 5173
[Main][exchangeToken] Token exchange failed: 500 Internal Server Error. Details: {"error":"server_error"}
[Main][exchangeToken] Error during fetch: Error: Token exchange failed: 500 Internal Server Error. Details: {"error":"server_error"}
    at C:\Users\jacks\development\geovizwiz\viz\electron\main.cjs:311:13
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:87023)
    Error occurred in handler for 'desktop:exchangeToken': Error: Token exchange failed: 500 Internal Server Error. Details: {"error":"server_error"}
    at C:\Users\jacks\development\geovizwiz\viz\electron\main.cjs:311:13
    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)
    at async WebContents.<anonymous> (node:electron/js2c/browser_init:2:87023)
[Renderer][ERROR] Failed OIDC token exchange: Error invoking remote method 'desktop:exchangeToken': Error: Token exchange failed: 500 Internal Server Error. Details: {"error":"server_error"}
- Added an early-detection initialization flag `(window as any)._isProcessingOIDCCallback = true;` at script startup when a `code` parameter is present in URL params.
- Wrapped the OIDC callback logic in a `try...finally` block to guarantee `_isProcessingOIDCCallback` is reset only when token exchange is completed.
- Prevented the 401 fetch interceptor from triggering a login redirect while the callback is actively processing the token exchange.
PS C:\Users\jacks\development\geovizwiz\viz>