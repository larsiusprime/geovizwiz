This is a document that describes the requirements for new functionality for the geovizwiz app, which is to add the ability to click a parcel and get a popup with parcel details.

Utilize the Civil SKILL.md file under the civil-ai-skills directory in this workspace for more detail on how to implement the below tasks.

## Summary of Changes
- Add click events to the parcel tiles on Civil OS layers
- When clicked, retrieve the feature ID of the tile, and use it to call GetParcelByFeatureId
- Take the returned parcel data and display it on a popup above the parcel
- Add styling to the tiles to make parcel boundaries more obvious
- Add this feature to both the desktop and hosted versions

## Changes/Issues
Below are improvements/fixes to make to the code already written to implement this feature. Use git diff to discover new additions. Add summaries of each fix underneath the change/issue.

### Can't Click
Can't click any of the tiles.
* **Fix**: Switched the Civil OS map layer type from `fill-extrusion` with 0 height to a standard 2D `fill` layer type. This prevents MapLibre's 3D raycaster from failing on flat surfaces, making click events 100% reliable.

### Coloring
Change the tile colors to a lighter grey and add a black border insteadf of the neon blue border.
* **Fix**: Updated the Civil OS fill layer paint properties to use `#e5e7eb` (lighter grey) for the `fill-color`, and updated the secondary outline layer to use `#000000` (black border) for the `line-color`.

### ID Substitution
Instead of hiding the values for zoning_id and land_use_id, etc, use the zoning and land use lookup apis to subsitute the ID value in the pop up with the name of the land use and the code of the zoning. To do this, prepull the maps of zoning, land use, and land use type values and store them in memory.
* **Fix**: Added asynchronous prepulling of the zoning, land use, and land use type lookup tables from the Civil OS API upon successful authentication, startup, and project load. Updated `buildPopupHTML` to display the `land_use_id` and `zoning_ids` fields and substitute their UUID values with the in-memory lookup details (showing the land use name and joined zoning codes respectively).