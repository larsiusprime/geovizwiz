Refer to the SKILL.md in this folder for details on how to use this file.

This feature involves modifications to the "Inspect" tool for Civil OS layers, particularly modifying the implementation to account for updated Civil APIs and a new panel that allows for configuring settings

## Feature
### Requirement Summary
- Update the current API used by the inspect tool
- All APIs added/updated in this feature sprint should only be called using the official pregenerated handlers from the civil-api-js library.
- Add new global config options for Civil OS layers
- Add Config Panel for Inspect tool that allows setting the global config options
- When populating a Neighborhood attribute in the UI, instead show the neighborhood name as returned from the GetNeighborhoods API
- Use translation keys for non-instance provided text

### Civil API updates
Updates have been made to the GetParcelByFeatureId API currently used by the inspect tool. It is now called GetParcelsWithImprovementSummaryByFeatureId and has a different request and return schema.

Review the new contract and update the API implementation accordingly, including the translation key names and values for the text shown in the parcel details pop up.

### New global Civil OS layer config options
For its standard parcel retrieval APIs, Civil OS optionally allows adding the following parameters which control the specific parcel data that is returned:
- Valuation ID
- Neighborhood Definition ID
- Legal As Of

Within the layer object for each Civil OS layer, this application should now store values for these 3 options, which will be referenced by app functionality that needs to know the user's desired values for these options.

These values should be globally used by all functionality and kept in sync. If a user updates one of these values on one panel, it should instantly be updated in every single other panel it is referenced.

### Civil Config Panel for Inspect
When a user toggles the inspect tool, a new panel should appear in the top left corner of the user's screen (by default, but it should be able to be pinned and moved like every other geovizwiz UI modal). This panel will allow for the setting of the new global civil os layer options through two new selection drop downs and a datetime picker (for the Legal As Of option). The Neighborhood Definition ID drop should be populated not with the ID, but from the Neighborhood Definition Name retrieved from the GetNeighborhoodDefinitions API. Similarly, the Valuation ID drop down should be populated with the well formatted string representations of the valuation date (not datetime, cut out the time from the returned timestamp) of each valuation, as retrieved with the GetValuations API.

### Translation Keys
As is standard, all text values not retrieved from the Civil OS instance should be encoded as translation keys, which are swapped with text values conforming to the user's system/browser language at runtime.

## Changes/Fixes
### Neighborhood and Zoning Not Showing Up on Pop Up Panel
Even when a neighborhood definition is selected, neither the neighborhood name nor zoning name appear on the pop up panel when inspecting the parcel. Sometimes the row name is there with a "-" to indicate no value, and other times the row isn't present at all. This is despite me confirming on the selected parcels that the API is returning the neighborhood and zoning IDs through a manual API call.

### Valuation Changes
Move the improvement and land valuations to their own separate header in the inspect parcel pop up panel. Reformat the displayed valuations to follow traditional USD conventions (dollar sign in front and two decimal places). Add a total market value and total assessed value row by adding up both market values and assessed values.

### Year Built Changes
Ensure that year built is formatted as a simple number without commas between the thousands and hundreds place. Also, use the new effective year built field added to the improvement summary in GetParcels APIs, showing it on the screen in the same way as year built.

### Civil Settings Panel
Keep the Inspect Settings Panel the same, except remove it from being completely tied to the Inspect tool and rename it to "Civil OS Settings" (as a translation key, of course). It should have its own button on the sidebar like the other tools/settings pages, and therefore be able to opened and closed separately from the inspect tool. Furthermore, move the Civil OS endpoint and login configuration UI from the normal settings panel to this panel.

### Civil Settings Panel Translation Keys
Ensure that the civil settings panel field headers are set as translation keys. Rename "Legal As Of" to "Characteristics As Of"