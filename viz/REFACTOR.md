# VIZ refactor roadmap

Living tracker for the code-quality refactor of the VIZ app. Working cadence: **scope → one small bite → `npm run build` + `npm run typecheck:gate` (ratcheting tsc baseline) → eyeball in `npm run dev` → commit.** Each bite is behavior-preserving unless explicitly a bugfix.

## Done (2026-06)

**Tier 1 — quick wins:** deleted dead `style.css`; fixed a collapsible-arrow violation; `window.confirm` → promise-based `showConfirm()` (modals.ts); verified hotkey badges.

**Tier 2 — dedup:** inline `<style>` (~1,960 lines) → imported `app.css`; design tokens (`--color-*`) + `PRIMARY_COLOR`; window chrome → `.window-header`/`.window-min-btn` classes; DOM factories (`el`/`byId`/`makeButton`/`makeOption`) in `utils.dom.ts`; `createCollapseToggle()` (replaced ~15 hand-rolled setters); shared `utils.export.ts` (CSV/Excel); `icons.ts` registry + `createConditionsButton()`.

**Tier 3 — decomposition (partial):**
- A: icon registry (`icons.ts`), pure helpers → utils.
- B: **all** static DOM refs → `dom-refs.ts` (main.ts no longer queries the DOM at top level).
- C1 (selection.ts, partial): hit-test geometry → `selection-geometry.ts`; marching-ants CSS → `app.css`. 1,830 → ~1,496.
- C2 (rendering.ts): pure color/expression/numeric helpers → `rendering-helpers.ts`. 1,136 → ~985.

**Bugs fixed along the way (pre-existing/latent):** rectangle selection under non-zero map pitch/bearing; vertical slider browser-compat (`appearance: slider-vertical` removed in Chrome 121); flash of empty panels + lingering legend on load; legacy normalization-radio indirection torn out (now plain `<select>`s); numeric-paint ramp-row state-leak.

## Lessons learned (apply these to remaining work)
1. **Verify with build + the tsc gate + a per-bite eyeball.** `npm run build` (esbuild) does not type-check; `npm run typecheck:gate` is the real check (ratcheting baseline in `scripts/typecheck-gate.cjs`) — watch the delta, not the absolute.
2. **God-modules don't split cleanly where module-local mutable `let` state + callback seams are shared.** Clean, low-risk extractions are *pure* or *S-only* helpers (geometry, color/expression primitives). Deeper splits (tool handlers, panel builders) need the shared state hoisted into an object — real churn, medium risk; only worth it for maximal decomposition.
3. **Prefer verbatim / script-assisted moves** for big mechanical extractions (dom-refs, rendering-helpers, marching-ants) so the diff is reviewable and the compiler proves completeness.
4. **TS narrows local `const | null` inside closures but not imported ones** — always-present elements in `dom-refs.ts` are typed non-null.
5. **Watch for dropdown↔hidden-legacy-radio indirection** (normalization had it; colorMode still does). It's an anti-pattern and a source of state-leak bugs.
6. Several "regressions" surfaced during eyeballs were pre-existing latent bugs exposed by closer testing — the disciplined eyeball is worth it.

## Remaining work — re-prioritized (fresh eyes)

Ordered by value-for-risk. Earlier items are the recommended path; later ones are optional/deferred.

### High value, low–medium risk
- **G1 — tsc type-check gate.** ✅ Done. `npm run typecheck` (`tsc --noEmit`) + `npm run typecheck:gate` (ratcheting `BASELINE` in `scripts/typecheck-gate.cjs`), wired into `pages.yml` before the build.
- **C3a — comp-finder pure helpers.** ✅ Done → `comp-finder-helpers.ts` (distance math, distance-circle geometry, pagination tokens, delta formatting).
- **R1 — colorMode legacy-radio teardown.** ✅ Done. `colorModeSelect` (continuous/quantiles) is now the source of truth — its `change` listener writes `S.colorMode` directly, recomputes + auto-scales + refreshes the legend, and persists. Removed the hidden `colorModeLegacyRadios` block, the `colorCont`/`colorQuant` dom-refs, and all `_colorCont`/`_colorQuant` plumbing in `layers.ts`/`main.ts`.

### Medium value, medium risk
- **E1 — feature-owned init (the real `main.ts` slimmer).** Now unlocked by B: have each feature module import its refs directly from `dom-refs.ts` and self-wire, removing the giant `initXxxElements(...)` / `initXxxCallbacks(...)` plumbing from `main.ts`. **One feature module per bite** (start with a small one, e.g. `scatterplot` or `legend`). Must preserve init **order**. Biggest reduction of `main.ts` bulk. *(Risk: medium-high; eyeball the migrated panel + anything that calls into it.)*
- **D1 — namespace `S.ui`.** Group the `isXxxMinimized` / `isXxxCollapsed` window flags into `S.ui` (lowest-blast-radius slice of the state cleanup; writers mostly in main.ts/windows/toolbar). grep + tsc to verify. *(Risk: medium; pure mechanical rename.)*

### Lower priority / optional
- **D2–D4 — namespace the rest of `S`** (`S.selection`, `S.paint`/`S.layers`, remainder), optionally funneling writes through a `setState()` helper. **Re-evaluate whether it's worth it:** ~499 writes across 22 modules is large churn whose payoff (traceability/undo) is only realized if undo/redo becomes a product goal. Deprioritized unless that's wanted.
- **C1c–C1e — finish selection.ts split** (save/load → `selection-saveload.ts`; tool handlers → `selection-tools.ts`; panel builder → `selection-panel.ts`). Needs a shared `selection-state.ts` (callback seams + mutable state as an object). Medium risk, modest gain — the clean wins are already done.
- **C3b — split comp-finder UI/export** beyond the pure helpers (same state-hoisting friction as C1).
- **E2 — event bus** replacing the ~134 callback-injection seams. Highest risk; the seams work today. Only after E1, and only if the coupling becomes a real pain.
- **G2 — burn down the tsc baseline.** ✅ Done: **103 → 0**. Bite 1 removed 64 unused-symbol errors; bite 2 fixed the real bugs (TS2552 `ReferenceError`, TS2339 missing props incl. `WRITE` hotkey); bite 3 cleared the remaining 29 (closure narrowing-loss → local-const capture; genuine-null bail guards in `windows.ts`/`time-adjustment.ts`; `props[field ?? '']` for null-index; widened `updateRowTooltip` params; `metadata.ts` projectName hoist + reduce accumulator type). Gate `BASELINE` is now **0** — any type error fails CI.

## Known deferred issues
- **Selection tools behave erratically over hex-summary layers.** Rectangle/lasso/polygon selection gives strange/incorrect results when the map is in hex (H3 summary) mode. Deferred — there's no well-defined expected behavior for "selecting hexagons" yet; revisit once that UX is specified. (Per-parcel selection is unaffected.)

## Suggested next session
Done: G1, C3a, G2 (full tsc burndown 103 → 0, gate strict at 0), R1 (colorMode teardown). Next: **E1** (feature-owned init, one module at a time — biggest `main.ts` reduction) and optionally **D1** (`S.ui` namespacing). Treat D2–D4 and the deferred C/E items as opt-in.
