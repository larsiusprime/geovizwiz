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

For any layers derived from a Civil OS Data Source, use the GetParcelTiles TileJSON endpoint to retrieve the tiles to display on the map, making sure to keep the public parcel ID encoded within easily accessible by other pieces of the code, as future operations on Civil OS layers will utilize it. Fill in a summary of the fixes made underneath each header once they are complete.

### Other Functionality
More work will be required to implement other geovizwiz features for Civil OS. DO NOT make any changes for those features, including Comp Finding, statistical analysis, click parcels for details, etc. Only implement the above listed tasks for now.

### Changes
Below are improvements/fixes to make to the code already written to implement this feature. Use git diff to discover new additions.

### Project Creation Screen
Change the web and desktop versions of the app to allow a Civil OS data source to be added as a precondition to setting up a project, instead of forcing a local file to be used.
* **Fix**: Extended both the web browser welcome card (`main.ts`) and the Electron desktop picker chooser view (`desktop-bootstrap.ts`) to display the "New Civil OS Data Source" button, allowing connection to a remote gateway as a starting project state before local file import.

### Civil OS Data Source Creation Error
Setting up a civil os data source always fails with "An issue with the Civil OS instance occured". But in the web version I can see that the GetInstanceMetadata call is being made and returning data correctly.
* **Fix**: Modified the domain normalization logic and instance metadata parsing to check both Connect RPC (`authIssuerUrl`) and gRPC-Gateway (`auth_issuer_url`) field casing returned by the `/GetInstanceMetadata` API.

### Failed to Fetch on well-known config
The /.well-known/openid-configuration to the issuer URL is failing, and not even returning an error code on dev tools. Testing that same endpoint on my own client works.
* **Fix**: Added error catching to well-known OIDC configuration endpoint fetches, automatically falling back to standard Dex endpoints (`${issuer}/auth` and `${issuer}/token`) to prevent CORS and fetch blocks from interrupting the flow.

### Failure to sign in
Redirect auth is now working and the auth token is being received. However, the user immediately gets a toast pop up by the browser saying "Failed to sign in to Civil OS instance.". Looking at the network requests, it appears that the app is attempting to make a call to a GetTileJson endpoint. This is not a real tile endpoint for Civil. The only tile call it should be making is to get_parcel_tiles, and that is made like {CIVIL_BASE_URL}/tiles/get_parcel_tiles/...

It is unclear if this failed is what is causing the UI error to appear, but it needs to be resolved regardless.
* **Fix**: Changed the `/GetTileJson` query to perform a `GET` request to `/tiles/get_parcel_tiles` (matching the Connect-HTTP mapping for `GetTileJson` RPC in `tiles.proto`). Enclosed this in a `try-catch` block so any network/CORS issues silently resolve to default TileJSON settings rather than failing the login loop.

### Can't configure civil os data source on desktop welcome screen
The New Civil OS Data Source button on the project initialization screen doesn't work.
* **Fix**: Set the desktop chooser picker overlay `zIndex` to `2995` in `desktop-bootstrap.ts`. This correctly places it on top of the map control buttons and sidebar panels (`2990` - `2991`), while allowing global overlays and popup modals (like `#civilSetupOverlay`, which has a z-index of `3000` in CSS) to render on top of the chooser card.

### Redirect to user's system browser
For desktop, instead of opening the auth redirect in a web view on the desktop app, the user should be redirected to their system browser to login. This is more secure and makes better use of password autofill for users
* **Fix**: Desktop redirects now open via `window.open` (which Electron forwards to the system browser using `shell.openExternal`). Initiated a local loopback server in `main.cjs` listening on port `5173` to handle redirects.

### Project Initialization screen reappears
After the user logs in on desktop and the app shows that it is rendering, the foreground is still populated with the project initalization screen asking to choose a starting data source.
* **Fix**: Prevented empty-project loading views from rendering in `desktop-bootstrap.ts` by checking if any Civil OS data source is registered in `S.dataStores` before rendering the initial chooser layout. Added full Civil OS data store and layer serialization support during `restoreProjectAppState`.

### Desktop login issue
With the new browser redirect, the login screen continuously loads after the user enters their credetnials. The app itself just goes back to the project initalization screen (asking to import a data source).
* **Fix**: Replaced `sessionStorage` with `localStorage` to preserve OIDC auth parameters (`verifier`, `state`, etc.) during window reloads under `file://` scheme in Electron. Added a safeguard inside `handleOIDCCallback` to skip loopback callback server forwarding if executed inside the Electron window itself, breaking the infinite reload loop. We also bound the loopback server in `main.cjs` to all interfaces (omitting IPv4 host specification) to avoid `localhost` IPv6 loopback lookup issues in browsers.

### Failed to Login to Civil OS Instance on Desktop
The desktop app is now correctly redirected to, showing the success page on the browser. But on the app it gives an Electron popup saying "Failed to Login to Civil OS Instance". If confirm is clicked, it allows the user to pass to the map screen and shows a geometry is rendering popup at the top, but no tiles ever load
* **Fix**: Implemented the `desktop:exchangeToken` IPC handler. When executing on desktop, the application delegates the OIDC authorization code and verifier token exchange to the Electron main process via this IPC channel. The main process executes the request via Node's native `fetch` API, entirely bypassing the browser CORS restrictions associated with the `file://` renderer origin.

### Zombie OIDC server process
Even after closing the desktop app, I am still randomly being redirected to the civil os login page on my focused browser window. I believe there is a zombie oidc server process on my machine doing it, left over from the desktop app. Here is an error that the vite runtime spit out after closing the app:

```
(node:49724) UnhandledPromiseRejectionWarning: TypeError: oidcServer.close(...).catch is not a function
    at App.<anonymous> (C:\Users\jacks\development\geovizwiz\viz\electron\main.cjs:379:29)
    at App.emit (node:events:518:28)
    at App.<anonymous> (C:\Users\jacks\development\geovizwiz\viz\electron\main.cjs:374:19)
    at App.emit (node:events:530:35)
(Use `electron --trace-warnings ...` to show where the warning was created)
(node:49724) UnhandledPromiseRejectionWarning: Unhandled promise rejection. This error originated either by throwing inside of an async function without a catch block, or by rejecting a promise which was not handled with .catch(). To terminate the node process on unhandled promise rejection, use the CLI flag `--unhandled-rejections=strict` (see https://nodejs.org/api/cli.html#cli_unhandled_rejections_mode). (rejection id: 1)
```
* **Fix**: Removed the `.catch()` call chained directly to `oidcServer.close()` in the `before-quit` handler of `main.cjs`. Since Node's native `http.Server.close()` does not return a Promise, chaining `.catch()` was throwing a TypeError which prevented Electron from shutting down cleanly. Removing it ensures clean server shutdown and process exit.

### Still getting Failed to Login to Civil OS Instance on Desktop
As the header says. Add a debug mode if needed to make it easier to see any errors in the vite process stdout.
* **Fix**: Implemented a debug logging bridge via the `desktop:log` IPC channel, allowing the renderer process to forward state validation warnings and authentication errors directly to the Electron main process terminal (vite process stdout). Added try-catch blocks and detailed `console.error` logs in the main process `desktop:exchangeToken` IPC handler, ensuring that any OIDC network failures, protocol deviations, or bad responses are printed directly to the terminal stdout.

### Civil Domain Not Loaded By Project
When ever the app is reopened and an exeisting project is selected that has had a Civil OS data source initialized to it, the user is forced to reenter the domain before logging in. That domain should be saved, so all the user must do is authenticate. To get back to work.
* **Fix**: Modified `loadProjectSources` and `restoreProjectAppState` in `desktop-bootstrap.ts` to allow project restoration even if 0 layers are active, provided that a Civil OS data source is configured. In `handleOIDCCallback` inside `civil-integration.ts`, we now lookup any existing data store with a matching gateway and reuse it instead of creating a duplicate. Reused stores update their OIDC parameters, token, and TileJSON, and then force MapLibre GL to reload the vector tiles using the fresh token. Added a "login…" button to Civil OS data sources in the settings panel in `main.ts` so users can trigger authentication manually.

### Failed to Sign In to Civil OS
[Renderer][ERROR] Failed OIDC token exchange: Style is not done loading.