This is a document that describes the requirements for new functionality for the geovizwiz app, which is to add the ability to click a parcel and get a popup with parcel details.

Utilize the Civil SKILL.md file under the civil-ai-skills directory in this workspace for more detail on how to implement the below tasks.

## Summary of Changes
- Add click events to the parcel tiles on Civil OS layers
- When clicked, retrieve the feature ID of the tile, and use it to call GetParcelByFeatureId
- Take the returned parcel data and display it on a popup above the parcel
- Add styling to the tiles to make parcel boundaries more obvious
- Add this feature to both the desktop and hosted versions