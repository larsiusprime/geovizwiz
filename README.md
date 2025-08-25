# geovizwiz

## Google authentication

The visualizer now requires Google sign‑in before the map loads. Visiting the
map without prior authentication redirects to a minimal `login.html` page where
users can sign in. After a successful sign‑in, a record is stored in
`localStorage` and the user is returned to the map.

Sign‑in can be disabled for development. Set the following environment
variables in `viz/` to enable it:

- `VITE_ENABLE_GOOGLE_AUTH=true`
- `VITE_GOOGLE_CLIENT_ID=<your OAuth client id>`

When the variables are not set or `VITE_ENABLE_GOOGLE_AUTH` is `false`, the
application runs without contacting Google, which is useful for development.
