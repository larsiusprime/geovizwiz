# Repository Guide for geovizwiz-sb

This file provides instructions for coding agents and new contributors.

## Layout

- `geoconverter/` – Standalone browser app to read GeoPackage metadata.
- `site/` – Static landing page.
- `viz/` – Main 3D parcel visualizer built with TypeScript and Vite.

## General Guidelines

- Use the existing technology stack in each directory; avoid adding heavy frameworks.
- Keep all tools client-side and offline where possible.
- Preserve the current indentation style: 4 spaces in `geoconverter`, 2 spaces in `viz`.
- Use `camelCase` identifiers and comment non-trivial logic.

## geoconverter

- Plain HTML/CSS/ES6 JavaScript (`script.js` contains a `GPKGMetadataReader` class).
- All dependencies (`sql-wasm.js`, `sql-wasm.wasm`) are stored locally; do not introduce server components.
- Manual testing in a browser is acceptable.

## site

- Single static `index.html` with inline CSS.
- Keep the page lightweight and framework-free.

## viz

- Node-based TypeScript project (see `package.json` and `tsconfig.json`).
- Source lives in `viz/src`; build output in `viz/dist`.
- TypeScript is compiled with strict settings (`strict`, `noUnusedLocals`, `noUnusedParameters`, etc.).
- Use ES modules and Vite's build system.
- Preferred indentation is 2 spaces.
- Run `npm run build` in `viz/` before committing changes; this checks that the project compiles.
- No test script is defined yet; `npm test` will report `Missing script: "test"`.

## Commit Hygiene

- Make focused commits with clear, imperative messages (e.g., "Add loading spinner" rather than "Added spinner").
- Ensure the repo builds and runs before pushing.

