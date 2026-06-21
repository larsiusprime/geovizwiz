This is a document that describes the requirements for new functionality for the geovizwiz app, which is to add an integration with the Civil OS backend system.

## Summary of Changes
- Remove the "hosted" modality of deployment
- Create a special kind of data source called "Civil OS" that connects to a Civil OS instance
- Create Civil OS data source setup modal
- Implement automatic setup for Civil OS data source
- Implement OIDC authentication capabilities using a full OIDC auth code flow w/ PKCE, on a public client that does not require a client_secret to retrieve the token
- Modify geovizwiz functionality to automatically pull from well-defined Civil OS APIs when used on layer derived from a Civil OS data source
    - Retrieve tiles using the GetParcelTiles API

## Detailed Functionality

### Removed Hosted Deployment Modality
In the current implementation, "hosted" is one kind of deployment modality that is specified at runtime. It exists in the same space as the "desktop" and "browser" deployment types. This needs to be changed such that desktop and browser are the only deployment modalities, with hosted being removed. The "hosted" modality will instead be replaced with a special kind of data source, as defined below, which can be added to desktop or browser deployments. Remove any reference or implementation of this hosted modality as part of these changes.

### New Civil OS Data Source
To support integration with the Civil OS backend system, this application will be encoded with a new kind of data source, also named "Civil OS". What differentiates this from a normal data source is the backend's well-known and -defined API, which the frontend can utilize to retrieve strongly typed data with no extra user configuration. Create a new Civil OS data source type in the codebase that only holds the principal configuration necessary to access that instance, likely just the gateway endpoint for the Civil OS instance it encodes and the authorization server details for authentication. The current data source type can be found in src/types.ts as "DataStore", and is created in src/layers.ts by "createDataStore".

### Civil OS Data Source Setup Modal

### Auto-Setup Civil OS Data Source

### Functionality Implementation with Civil OS Data Source
Use the Civil 