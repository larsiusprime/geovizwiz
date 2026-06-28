Refer to the SKILL.md in this folder for details on how to use this file.

Add the ability to select Civil OS geometry using the existing selection tool

## Feature
### Requirement Summary
- Implement click to select with the selection tool
- Implement the unselect all feature
- Select with filter will not work yet, as the filtering functionality has not been added

### Parcel ID retrieval
When a parcel (or group of parcels) have been selected, immediately make a call to GetParcelIdsByFeatureId to retrieve those parcels' public IDs. Store them in a mapping with their feature IDs, ensuring the parcel IDs are always immediately on hand to make further calls should they be needed.

If multiple parcels are selected in one action, ensure that all of them are populated in the same GetParcelIdsByFeatureId to cut down on latency and request volume.

## Changes/Fixes
### Click to Select is not working
Clicking on a Civil OS layer parcel while the layer is selected and the select tool is active does not do anything.

### Multiple Auth Prompts
When logging in to a Civil OS data source, the app opens 3 new tabs on the system's default browser with the Civil OS login screen. Only one needs to be filled out for the login to work, but if any of them are closed the login fails and another 3 tabs are opened to reattempt it.