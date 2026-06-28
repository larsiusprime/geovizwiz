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