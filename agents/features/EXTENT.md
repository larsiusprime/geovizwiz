Refer to the SKILL.md in this folder for details on how to use this file.

This is a feature on autoconfiguring the initial extent of the map on start up.

## Feature
### Requirement Summary
- When a Civil OS layer is first created, whether it be on creating a new project, opening an existing project, or adding a new layer from a source present in the current app session, the application should call the GetEstimatedParcelExtentWGS84 API and move the map's current extent to the bounds returned by that API
- The application should use a smooth animation when moving the map, like the one already in use when adding a new local layer
- If the call to the API fails, show an error to the user using the existing Civil OS data source error/message modals

## Changes/Fixes