# Synthetic City Builder (`util/synthetic`) — Working Plan

This file captures confirmed decisions, MVP boundaries, and remaining open questions for the **Synthetic City Builder** util app.

## App paradigm
- Build as a **`util/` style app** (vanilla JS + HTML + local vendored deps).
- Keep processing local/in-browser.
- Use existing util wizard/progress/cancel/export patterns.
- New app root and planning scope: `util/synthetic/`.

## MVP target (simple + shippable)
A deterministic, local-only synthetic city simulator that:
1. generates a valid polygon parcel universe (up to ~10k parcels),
2. simulates yearly evolution from 1980 to Jan 1 of present year,
3. creates repeat-sales transactions,
4. computes platonic vs observed sale values,
5. exports a single ZIP containing geometry-bearing datasets.

MVP intentionally excludes hybrid upload mode and advanced invalid-sale variants.

## Core outputs
Always export **one ZIP delivery package**.

ZIP contents for MVP:
1. `universe.geoparquet` (geometry-bearing)
2. `sales.geoparquet` (geometry-bearing observed/dirtied sales)
3. `sales_platonic.geoparquet` (geometry-bearing ground-truth sales)
4. `inflation.csv` (daily index time series)
5. `metadata.json` (seed + params + model settings + CRS + run timestamps)

## Key contracts
### Universe dataset
- One row per parcel with polygon geometry.
- Primary key: `key` (globally unique per parcel).
- Represents parcel/building characteristics as-of the final simulation date.

### Sales dataset
- One row per sale event (repeat sales allowed).
- Primary key: `key_sale`.
- Foreign key: `key` to universe parcel.
- `key_sale` MUST be strictly zero-padded date format: `key---YYYY-MM-DD`.
- Sales exports include parcel geometry for user delivery.

### Inflation dataset
- Daily series (derived via interpolation between monthly anchors).
- Schema is exactly:
  - `period` (`YYYY-MM-DD`)
  - `start_indexed` (index beginning at `1.0`)
  - `end_indexed` (index ending at `1.0` on final date)
  - `correction_factor` (`1 / end_indexed`)
- Each sales row stores `inflation_index` for its sale date (taken from `start_indexed` for that day).

## Required schema

### Land characteristics
- `land_area_sqft`
- `longitude`
- `latitude`
- `land_type` (categorical)
- `zoning` (categorical)
- `neighborhood` (categorical)

### Building characteristics
### Proposed MVP `bldg_type` vocab by `model_group`
Proposed starter mapping (designed for internal consistency + easy extension):
- `single_family`:
  - `SF_RANCH`
  - `SF_TWO_STORY`
  - `SF_TOWNHOUSE`
- `multi_family`:
  - `MF_DUPLEX`
  - `MF_TRIPLEX`
  - `MF_GARDEN_APT`
  - `MF_MIDRISE_APT`
- `commercial`:
  - `COMM_RETAIL_SMALL`
  - `COMM_RETAIL_BIGBOX`
  - `COMM_OFFICE_LOWRISE`
  - `COMM_MIXED_USE`
- `industrial`:
  - `IND_WAREHOUSE`
  - `IND_LIGHT_MANUFACTURING`
  - `IND_FLEX`
- `mobile_home`:
  - `MH_SINGLE_WIDE`
  - `MH_DOUBLE_WIDE`
  - `MH_PARK_PAD`
- `agricultural`:
  - `AG_ROW_CROP`
  - `AG_PASTURE`
  - `AG_FARMSTEAD`

(If approved, this becomes the exact allowed set for MVP generation and UI filters.)

- `bldg_area_finished_sqft`
- `bldg_area_footprint_sqft`
- `bldg_quality_num` (0 for vacant lot; otherwise tiers >=1)
- `bldg_condition_num` (0..100)
- `model_group` (categorical: `single_family`, `multi_family`, `commercial`, `industrial`, `mobile_home`, `agricultural`)
- `bldg_type` (categorical; must be consistent with `model_group`)
- `bldg_year_built`
- `bldg_stories`
- `bldg_units` (multifamily only)
- `bldg_rooms_bed`
- `bldg_rooms_bath`
- `bldg_year_renovated`

### Dataset-wide export note
- `model_group` is exported in all three primary datasets: `universe`, `sales`, and `sales_platonic`.

### Sales characteristics (by file)
Common core fields in both sales files:
- `sale_date` (`YYYY-MM-DD`)
- `sale_type` (`VALID` or `NOT_ARMS_LENGTH` for MVP)
- `valid_sale` (boolean)
- `sale_price`
- `sale_noise`
- `vacant_sale`
- `inflation_index`

Notes:
- In `sales_platonic`, these fields store ground truth values.
- In `sales`, these fields store observed/dirtied values after error simulation.

### Value decomposition characteristics
- `platonic_land_value`
- `platonic_impr_value`
- `platonic_market_value` (= land + improvement)
- `sale_noise` (signed)

Sales price handling:
- `sales_platonic.sale_price` = true/latent transaction value.
- `sales.sale_price` = observed transaction value after dirtied/error transform.

## Vacant-lot encoding rules
When parcel is vacant at a given state snapshot:
- Numeric building fields should be `0` where naturally expected:
  - `bldg_area_finished_sqft=0`
  - `bldg_area_footprint_sqft=0`
  - `bldg_quality_num=0`
  - `bldg_condition_num=0`
  - `bldg_stories=0`
  - `bldg_units=0`
  - `bldg_rooms_bed=0`
  - `bldg_rooms_bath=0`
- Categorical building fields should be `"NONE"` where applicable:
  - `bldg_type="NONE"`
- Required null edge cases:
  - `bldg_year_built=NULL` (never built)
  - `bldg_year_renovated=NULL` (never renovated)

## Geometry & generation model
- User chooses a real-world center location.
- Geometry constraints are strict:
  - no overlaps,
  - no slivers,
  - valid polygon geometry only.
- Initial fabric: rectilinear/grid + simple beltway influence.
- Neighborhood archetypes in MVP:
  - CBD
  - inner ring
  - suburb
  - exurb
  - commercial corridors
  - industrial sector
  - rural outlying
- Neighborhood and zoning quotas are user-controlled and interpreted by **parcel counts**.

## CRS strategy (recommended default)
- Internal generation CRS: derived **UTM zone** from user-selected center (projected meters).
- Map display CRS: web map standard rendering (MapLibre).
- Export CRS: generation UTM CRS (clean projected CRS metadata).

Rationale: robust distance/area calculations for parcel geometry and pricing-distance effects, while preserving clean GIS metadata for exports.

## Temporal simulation
- Default start year: `1980`.
- End date: `YYYY-01-01` for the current present year (as-of date).
- Yearly simulation events:
  - sale transaction,
  - teardown,
  - new construction,
  - renovation.

## Pricing model (MVP)
- Hidden hedonic model with simple user sliders/steppers.
- Strong location effects (CBD distance decay + neighborhood premiums).
- Zoning premiums/penalties.
- Land and improvement values modeled separately, then combined.
- Depreciation curve presets:
  - linear,
  - concave exponential,
  - S-curve.
- Inflation for MVP: monthly indexed keyframes with linear interpolation to daily values.
- Noise model: simplest baseline (homoskedastic).


## Platonic vs observed modeling approach
Recommendation: keep **one internal platonic model** and derive observed/dirtied outputs from it at export/build-finalization time.

### Why this is simpler and safer
- Prevents drift: one authoritative state transition model (teardown/build/reno/sale) drives everything.
- Easier debugging: if a value looks wrong, check platonic first, then dirtied transformation rules.
- Cleaner determinism: same seed + params always regenerates identical platonic truth before noise/error injection.
- Lower maintenance: avoids duplicating lifecycle logic across two parallel mutable datasets.

### Practical data-shape choice for MVP
Use two sales outputs in the ZIP:
1. `sales.geoparquet` = observed/dirtied user-facing transactions.
2. `sales_platonic.geoparquet` = ground-truth transactions (same row/key structure, no recording errors).

And keep only one simulation state machine internally (platonic).
Observed rows are produced by a deterministic post-process transform from the platonic sales rows.

### Field strategy with dual-file outputs
- Keep shared structural IDs in both files: `key`, `key_sale`, `sale_date`, geometry, etc.
- In `sales_platonic` keep truth fields (e.g., `vacant_sale`, `sale_price`) as truth, without prefixing.
- In `sales` keep observed equivalents (same column names) after applying error rules.
- Optional: include lightweight lineage fields in observed sales, e.g. `dirty_rule_applied`, `dirty_from_key_sale`.

This removes most `platonic_*` suffix clutter while preserving clean experimental ground truth.

## Invalid sale modeling
- User-configurable controls in MVP:
  - `% invalid sales`
  - checkboxes for invalid-sale types are hidden in MVP until additional types ship.
- `sale_type` must be encoded per record.
- Invalid nominal-price generator for `NOT_ARMS_LENGTH`: 50% fixed pick-list + 50% rounded-random `<1000`.
- Ground truth is preserved in `sales_platonic`; observed errors are reflected in `sales`.

### MVP implemented invalid type
- **Not arm's length** only:
  - `sales`: `valid_sale=True`, nominal round-number price (< $1000).
  - `sales_platonic`: `valid_sale=False`, nominal round-number price (< $1000).

### Validity semantics (authoritative)
- `sales_platonic` captures the best-known true state for each parcel-sale record.
- `sales_platonic.sale_price` always represents true individual-parcel transacted price (no data-entry mistakes).
- `valid_sale=False` means "exclude from modeling" (not "did not happen").
- `sales` may include observational/data-entry errors; `sales_platonic` does not.

### Deferred invalid-type behavior rules (locked now for future implementation)
- Distressed sale:
  - `sales`: `valid_sale=True`, `sale_price≈25%` below baseline.
  - `sales_platonic`: `valid_sale=False`, `sale_price≈25%` below baseline (true but non-modelable).
- Vacant-at-sale mislabeled improved:
  - `sales`: `valid_sale=True`, `vacant_sale=False`.
  - `sales_platonic`: `valid_sale=False`, `vacant_sale=True`.
- Improved-at-sale mislabeled vacant:
  - `sales`: `valid_sale=True`, `vacant_sale=True`.
  - `sales_platonic`: `valid_sale=False`, `vacant_sale=False`.
- Multi-parcel sale (correct discounted per-parcel):
  - `sales`: `valid_sale=True`.
  - `sales_platonic`: `valid_sale=False` (true but not representative of single-parcel market value).
- Multi-parcel mislabeled with total package price:
  - `sales`: `valid_sale=True`, `sale_price=<total package price>`.
  - `sales_platonic`: `valid_sale=False`, `sale_price=<true individual parcel price>`.
- Multi-parcel mislabeled with first parcel price:
  - `sales`: `valid_sale=True`, `sale_price=<first parcel price>`.
  - `sales_platonic`: `valid_sale=False`, `sale_price=<true individual parcel price>`.
- Pre-developed lot mislabeled vacant:
  - `sales`: `valid_sale=True`, `vacant_sale=True`.
  - `sales_platonic`: `valid_sale=False`, `vacant_sale=False`.

## Internal consistency rule (critical)
Never draw disconnected random attributes. Derive features in coherent dependency order, e.g.:
1. choose neighborhood + zoning + land type context,
2. choose building presence/type and stories,
3. derive footprint and finished area,
4. derive units/rooms from type + area,
5. derive quality/condition from age + depreciation + renovations,
6. derive land/improvement platonic values,
7. derive sale events and observed sale fields.

## UI/UX baseline
- Wizard-style util UI + MapLibre preview.
- Center-point selector supports either:
  - city-name combobox backed by a pre-generated top-cities list, or
  - direct latitude/longitude input.
- Milestone repaint only (not continuous animation).
- Repaint interval `N` (user configurable) for yearly evolution milestones.
- Long operations in Web Worker with progress + cancel.
- Single scenario only for MVP.

## Non-MVP / deferred
- Hybrid real/synthetic upload mode implementation.
- Multi-scenario batch runner.
- Full invalid-sale taxonomy implementation.
- Advanced inflation seasonality + slow random process.
- Rich custom formula builder beyond sliders.

## Resolved implementation decisions
1. Proposed `bldg_type` lists per `model_group` are approved for MVP.
2. `model_group` will be exported in `universe`, `sales`, and `sales_platonic`.
3. Metadata minimum fields are approved: seed, app_version, CRS (EPSG/WKT), center point source+coords, start/end dates, parcel count, repaint interval, slider settings, and quotas.
4. Persist both `city_name` (when selected) and raw center coordinates in metadata.
5. Fixed nominal-price pick list for `NOT_ARMS_LENGTH` is approved: `1, 5, 10, 50, 100, 500, 1000`.

## MVP readiness
Planning scope is now sufficiently unambiguous to begin implementation of the `util/synthetic` app skeleton and simulation pipeline.


## Network-first generation update (approved)
- Internal city mechanics now use a 100m x 100m buildable block envelope with 10m road buffers between blocks.
- Road widths:
  - local: 2.5m
  - arterial: 6m
  - beltway: 15m
  - highway: 50m
- Initial paved city is 20x20 blocks centered on origin.
- CBD is a fixed 6x6 core centered in the city.
- Arterials occur every 4 grid lines.
- Neighborhoods are dynamically filled as contiguous 2-8 block regions and may split blocks when needed.
- Strict zoning-to-model-group allowed sets are enforced, with weighted probabilities inside each allowed set.
- Growth uses probabilistic frontier paving under a yearly budget that grows over time.
- Development threshold is absolute but grows slower than inflation.
- Roads are exported as `roads.geoparquet` with fields including class, width, and paving year.
- Naming:
  - grid-aligned non-major roads: numbered avenues/streets
  - highways/beltways: generic major-road names
  - interior/service roads: deterministic fruit/vegetable names
