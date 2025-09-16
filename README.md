# geovizwiz

## Google authentication

The visualizer now requires Google sign‑in before the map loads. Visiting the
map without prior authentication redirects to a minimal `login.html` page where
users can sign in. After a successful sign‑in, a record is stored in
`localStorage` and the user is returned to the map.

Sign‑in can be disabled for development. Set the following environment
variables in `viz/` to enable it. Production builds read these values from
`viz/.env.production`:

- `VITE_ENABLE_GOOGLE_AUTH=true`
- `VITE_SLACK_WEBHOOK_URL=<Slack incoming webhook>`

The Google client ID used for sign‑in is defined inline in `viz/login.html`.

When the variables are not set or `VITE_ENABLE_GOOGLE_AUTH` is `false`, the
application runs without contacting Google, which is useful for development.
Production deployments rely on `viz/.env.production`, removing the need for
GitHub secrets.

The Slack webhook is never contacted directly from the browser. During
development, the Vite dev server proxies requests from `/api/slack` to the URL
set in `VITE_SLACK_WEBHOOK_URL`, avoiding CORS restrictions. In production,
`/api/slack` is handled by an Azure Functions backend that posts to the webhook
URL stored in the `SLACK_WEBHOOK_URL` environment variable.

## Deployment notes

The TypeScript visualizer (`viz/`) must be compiled before deployment. Running
`npm run build` in the `viz` directory generates a `dist/` folder containing
JavaScript bundles such as `assets/main.js`. Deploy the contents of this `dist`
folder to Azure Static Web Apps or any other static host. Serving the source
files directly (for example, `/src/main.ts`) causes browsers to download the
TypeScript file with a `video/mp2t` MIME type, which prevents the app from
loading.

### CORS for Azure Blob datasets

The mapper loads GeoParquet directly from Azure Blob Storage. Ensure CORS is enabled on the storage account that serves `https://landeconomics.blob.core.windows.net/public-sharing-cle/{southbend,syracuse}.parquet`:

- Allowed origins: your production domain(s) and `http://localhost:5173` for dev
- Allowed methods: `GET, HEAD, OPTIONS`
- Allowed headers: `*` (or at least `Range, Content-Type`)
- Exposed headers: `*` (must include `Content-Range` for range requests)
- Max age: e.g. `3600`

Without these settings, browsers will block cross‑origin requests and the app will fail to load datasets.

## Flexible data dictionary

Field labels and available filters in the parcel visualizer are driven by
city‑specific dictionaries under `viz/src/dictionaries/*.json`. Jurisdictions can
add a new file and extend `viz/src/config.ts` to register a new city. The app
only requires core fields for land value, improvement value, and the
development category used to flag vacant or under‑utilized parcels.
