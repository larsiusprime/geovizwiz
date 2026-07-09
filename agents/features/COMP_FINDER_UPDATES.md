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