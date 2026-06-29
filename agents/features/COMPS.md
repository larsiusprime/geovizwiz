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