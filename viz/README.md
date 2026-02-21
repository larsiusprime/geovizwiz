# VIZ local testing (build modes)

VIZ supports three build/runtime modes:

- `browser`
- `desktop`
- `hosted`

Mode is selected via `VITE_VIZ_BUILD_MODE` through Vite mode env files:

- `.env.browser`
- `.env.desktop`
- `.env.hosted`

## Prerequisite

Install VIZ dependencies once:

```bash
cd viz
npm install --include=dev
```

## Fast local app testing (VIZ only)

From `viz/`:

```bash
# Browser mode (default behavior)
npm run dev -- --mode browser

# Desktop mode
npm run dev -- --mode desktop

# Hosted mode scaffold
npm run dev -- --mode hosted
```

## Build outputs by mode (VIZ only)

From `viz/`:

```bash
npm run build:browser
npm run build:desktop
npm run build:hosted
```

## Run Desktop shell locally (Electron Milestone 1)

From `viz/`:

```bash
npm run run:desktop
```

What this does:
- builds VIZ in `desktop` mode
- launches Electron with secure defaults (`contextIsolation`, `nodeIntegration=false`, sandboxed renderer)
- exposes a minimal preload bridge as `window.vizDesktop` for project-folder/file operations

This is a **run target** for local desktop testing (not installer packaging yet).

## Full-site local deploy testing (equivalent to current deploy-local flow)

From repository root, use the deploy script with mode flag:

```bash
# Browser mode site deploy
node deploy-local.js --viz-mode=browser

# Desktop mode site deploy
node deploy-local.js --viz-mode=desktop

# Hosted mode site deploy (scaffold only for now)
node deploy-local.js --viz-mode=hosted
```

This keeps the same simple deploy-local flow while allowing mode-specific VIZ builds.
The local server starts at `http://localhost:3000`.

## Notes

- `desktop` includes an initial Electron shell run target (`npm run run:desktop`) for Milestone 1 testing; installer packaging is not included yet.
- Browser behavior remains the baseline.


### Troubleshooting (Windows)

If you see:

```
'electron' is not recognized as an internal or external command
```

then local dev dependencies were not installed. Re-run:

```bash
cd viz
npm install --include=dev
```

Then run again:

```bash
npm run run:desktop
```

`run:desktop` uses `npm exec electron ...` so it resolves the local Electron binary from `node_modules`.

