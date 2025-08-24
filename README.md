# geovizwiz

## Google authentication

The visualizer supports optional Google sign‑in. By default it is disabled.
Set the following environment variables in `viz/` to enable it:

- `VITE_ENABLE_GOOGLE_AUTH=true`
- `VITE_GOOGLE_CLIENT_ID=<your OAuth client id>`

When the variables are not set or `VITE_ENABLE_GOOGLE_AUTH` is `false`, the
application runs without contacting Google, which is useful for development.
