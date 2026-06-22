This is a document that describes the requirements for new functionality for the geovizwiz app, which is to add an integration with the Civil OS backend system.

Utilize the Civil SKILL.md file under the civil-ai-skills directory in this workspace for more detail on how to implement the below tasks.

## Summary of Changes
- Remove the "hosted" modality of deployment
- Create a special kind of data source called "Civil OS" that connects to a Civil OS instance
- Create Civil OS data source setup modal
- Implement automatic setup for Civil OS data source
- Implement OIDC authentication capabilities using a full OIDC auth code flow w/ PKCE, on a public client that does not require a client_secret to retrieve the token
- Retrieve tiles using the GetParcelTiles API

## Detailed Functionality

### Removed Hosted Deployment Modality

In the current implementation, "hosted" is one kind of deployment modality that is specified at runtime. It exists in the same space as the "desktop" and "browser" deployment types. This needs to be changed such that desktop and browser are the only deployment modalities, with hosted being removed. The "hosted" modality will instead be replaced with a special kind of data source, as defined below, which can be added to desktop or browser deployments. Remove any reference or implementation of this hosted modality as part of these changes.

### New Civil OS Data Source

To support integration with the Civil OS backend system, this application will be encoded with a new kind of data source, also named "Civil OS". What differentiates this from a normal data source is the backend's well-known and -defined API, which the frontend can utilize to retrieve strongly typed data with no extra user configuration. Create a new Civil OS data source type in the codebase that only holds the principal configuration necessary to access that instance, likely just the gateway endpoint for the Civil OS instance it encodes and the authorization server details for authentication. The current data source type can be found in src/types.ts as "DataStore", and is created in src/layers.ts by "createDataStore".

### Civil OS Data Source Setup Modal/Automatic Setup

A user can decide to add a new Civil OS data source through the settings menu, where new data sources can currently be added. The data source  will be added through a new button, called "New Civil OS Data Source". When this button is clicked, a pop up modal should appear in the center of the user's screen. This modal will only prompt the user to enter the domain of their Civil OS Gateway. Once they do, they click confirm, and the application should being automatic setup.

Automatic setup should include the following steps:
1. Domain normalization: If no transport scheme is present on the domain (http or https), add https:// to the beginning of the domain
2. Reach out to that gateway endpoint and call the GetInstanceMetadata endpoint. If it fails due to a 404, return an "Invalid Civil OS domain" error to the user. If it fails due to another error, return an "An issue with the Civil OS instance occurred" error to the user.
3. Retrieve the authorization server issuer URL from the GetInstanceMetadata API response. Use it to construct a .well-known endpoint call to get the OIDC configuration for that auth server. Store that configuration to utilize for authentication events
4. Trigger an authorization code w/ PKCE grant type redirect

### Civil OS OIDC Authentication

Civil OS handles authentication to the platform using the OAuth framework. The metadata endpoint returns the URL for the auth server this Civil instance's gateway is a resource server for. This application should use the well known endpoint to retrieve at least the authorization and token endpoints, which will allow the application to redirect the user for authentication.

This application is expected to use the Authorization Code w/ PKCE grant type for all authentication. When making the token call, it should not use a client secret, rather using the code_verifier to verify the request. The client_id for the request will always be "geovizwiz".

The user should be automatically redirected to the auth endpoint with the appropriate client_id whenever the application encounters a 401 error code from a call to the configured Civil OS endpoint.

Once implemented, tell me what the redirect URLs will need to be for both the web and desktop versions of the app (dev and prod), and I will add them to the geovizwiz client configuration.

### Map Tile Population

For any layers derived from a Civil OS Data Source, use the GetParcelTiles TileJSON endpoint to retrieve the tiles to display on the map, making sure to keep the public parcel ID encoded within easily accessible by other pieces of the code, as future operations on Civil OS layers will utilize it.

### Other Functionality
More work will be required to implement other geovizwiz features for Civil OS. DO NOT make any changes for those features, including Comp Finding, statistical analysis, click parcels for details, etc. Only implement the above listed tasks for now.

## Changes
Below are improvements/fixes to make to the code already written to implement this feature. Use git diff to discover new additions.

### Project Creation Screen
Change the web and desktop versions of the app to allow a Civil OS data source to be added as a precondition to setting up a project, instead of forcing a local file to be used.

### Civil OS Data Source Creation Error
Setting up a civil os data source always fails with "An issue with the Civil OS instance occured". But in the web version I can see that the GetInstanceMetadata call is being made and returning data correctly.

## Failed to Fetch on well-known config
The /.well-known/openid-configuration to the issuer URL is failing, and not even returning an error code on dev tools. Testing that same endpoint on my own client works.

## Failure to sign in
Redirect auth is now working and the auth token is being received. However, the user immediately gets a toast pop up by the browser saying "Failed to sign in to Civil OS instance.". Looking at the network requests, it appears that the app is attempting to make a call to a GetTileJson endpoint. This is not a real tile endpoint for Civil. The only tile call it should be making is to get_parcel_tiles, and that is made like {CIVIL_BASE_URL}/tiles/get_parcel_tiles/...

It is unclear if this failed is what is causing the UI error to appear, but it needs to be resolved regardless.

## Can't configure civil os data source on desktop welcome screen
The New Civil OS Data Source button on the project initialization screen doesn't work.