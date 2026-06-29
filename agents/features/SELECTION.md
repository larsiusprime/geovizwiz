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

### Ensure
I've fixed the feature ID issue with the parcel IDs, so the pg feature_id should come promoted as the feature ID. Ensure that the change you previously made to promote the feature ID does not cause an error when its already promoted.

### Selection Issues
Now when using the select tool, the tool can only select one parcel at a time (as indicated by the selection count on the modal), and the selections do not show up visually on the layer (the select parcel does not have its color changed). Both of these need to be resolved so it can select multiple at a time The unselect all is clearing out the single selection when present, so it is likely working as expected.

### Double login
While the user isn't having 3 simulatenous redirect auth sessions opened at once, when reopening a project with a civil os data source they are prompted to login twice sequentially (once they finish the first login, they are immediately prompted for a second)