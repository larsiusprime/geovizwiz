/* global self */
importScripts('../../vendor/apache-arrow.js');

const BLOCK_SIZE_M = 100;
const ROAD_BUFFER_M = 10;
const GRID_PITCH_M = BLOCK_SIZE_M + ROAD_BUFFER_M;
const LOCAL_ROAD_WIDTH_M = 2.5;
const ARTERIAL_WIDTH_M = 6;
const BELTWAY_WIDTH_M = 15;
const HIGHWAY_WIDTH_M = 50;
const INITIAL_HALF_BLOCKS = 10; // 20x20 blocks
const CBD_HALF_BLOCKS = 3; // 6x6
const ARTERIAL_CADENCE = 4;
const FRONTIER_BUDGET_INITIAL = 18;
const FRONTIER_BUDGET_GROWTH = 0.015;
const SF_ARTERIAL_PENALTY = 0.8;

const MODEL_GROUPS = ['single_family', 'multi_family', 'commercial', 'industrial', 'mobile_home', 'agricultural'];
const BLDG_TYPE_BY_GROUP = {
  single_family: ['SF_RANCH', 'SF_TWO_STORY', 'SF_TOWNHOUSE'],
  multi_family: ['MF_DUPLEX', 'MF_TRIPLEX', 'MF_GARDEN_APT', 'MF_MIDRISE_APT'],
  commercial: ['COMM_RETAIL_SMALL', 'COMM_RETAIL_BIGBOX', 'COMM_OFFICE_LOWRISE', 'COMM_MIXED_USE'],
  industrial: ['IND_WAREHOUSE', 'IND_LIGHT_MANUFACTURING', 'IND_FLEX'],
  mobile_home: ['MH_SINGLE_WIDE', 'MH_DOUBLE_WIDE', 'MH_PARK_PAD'],
  agricultural: ['AG_ROW_CROP', 'AG_PASTURE', 'AG_FARMSTEAD']
};
const ZONING_ALLOWED = {
  R1: ['single_family', 'mobile_home'],
  R2: ['single_family', 'mobile_home'],
  R3: ['single_family', 'multi_family', 'mobile_home'],
  R4: ['single_family', 'multi_family', 'mobile_home'],
  C1: ['commercial', 'multi_family'],
  C2: ['commercial', 'multi_family'],
  I1: ['industrial', 'commercial'],
  I2: ['industrial', 'commercial'],
  MX: ['commercial', 'multi_family'],
  AG: ['agricultural', 'single_family']
};
const ZONING_WEIGHTS = {
  R1: { single_family: 0.85, mobile_home: 0.15 },
  R2: { single_family: 0.8, mobile_home: 0.2 },
  R3: { multi_family: 0.45, single_family: 0.45, mobile_home: 0.1 },
  R4: { multi_family: 0.65, single_family: 0.25, mobile_home: 0.1 },
  C1: { commercial: 0.7, multi_family: 0.3 },
  C2: { commercial: 0.8, multi_family: 0.2 },
  I1: { industrial: 0.75, commercial: 0.25 },
  I2: { industrial: 0.85, commercial: 0.15 },
  MX: { commercial: 0.55, multi_family: 0.45 },
  AG: { agricultural: 0.85, single_family: 0.15 }
};
const LAND_TYPE_BY_GROUP = {
  single_family: 'residential', multi_family: 'residential', commercial: 'commercial', industrial: 'industrial', mobile_home: 'residential', agricultural: 'agricultural'
};
const MIN_PARCEL_ACRES = {
  single_family: 0.03, multi_family: 0.10, commercial: 0.25, industrial: 1, mobile_home: 0.03, agricultural: 2
};
const MAX_PARCEL_ACRES = {
  single_family: 20, multi_family: 50, commercial: 100, industrial: 500, mobile_home: 20, agricultural: 100000
};
const FRUIT_VEG_NAMES = ['Apple', 'Plum', 'Pear', 'Peach', 'Lemon', 'Lime', 'Onion', 'Carrot', 'Turnip', 'Celery', 'Pepper', 'Tomato', 'Potato', 'Grape', 'Berry', 'Kiwi'];

const textEncoder = new TextEncoder();
const send = (type, payload) => self.postMessage({ type, payload });
const log = (message) => send('log', { message });
const progress = (message) => send('progress', { message });
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let parquetModulePromise = null;
let parquetInitialized = false;
let arrowHelpersPromise = null;

async function ensureParquetModule() {
  if (!parquetModulePromise) {
    parquetModulePromise = import('../../vendor/parquet-wasm/esm/parquet_wasm.js').then(async (mod) => {
      if (!parquetInitialized) {
        progress('Loading parquet encoder...');
        await mod.default(new URL('../../vendor/parquet-wasm/esm/parquet_wasm_bg.wasm', self.location.href));
        parquetInitialized = true;
      }
      return mod;
    });
  }
  return parquetModulePromise;
}

async function ensureArrowHelpers() {
  if (!arrowHelpersPromise) {
    arrowHelpersPromise = Promise.all([import('../parquet/arrowSchema.js'), import('../geo/geoparquetMeta.js')]).then(([arrowSchema, geoMeta]) => ({ arrowSchema, geoMeta }));
  }
  return arrowHelpersPromise;
}

function makeSeededRng(seedText) {
  let h = 2166136261 >>> 0;
  const src = String(seedText || 'synthetic-city');
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  let state = h >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
}

const randPick = (rng, items) => items[Math.floor(rng() * items.length)];
function weightedPick(rng, weightsObj) {
  const entries = Object.entries(weightsObj);
  let total = 0; entries.forEach(([, w]) => { total += w; });
  let t = rng() * total;
  for (const [k, w] of entries) { t -= w; if (t <= 0) return k; }
  return entries[0][0];
}

function metersToLonLat(centerLon, centerLat, dx, dy) {
  const degLat = dy / 111320;
  const degLon = dx / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return [centerLon + degLon, centerLat + degLat];
}
const toDateStringUTC = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;

function polygonWkb(coords) {
  const count = coords.length;
  const buf = new ArrayBuffer(1 + 4 + 4 + 4 + count * 16);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, 1); o += 1;
  v.setUint32(o, 3, true); o += 4;
  v.setUint32(o, 1, true); o += 4;
  v.setUint32(o, count, true); o += 4;
  for (const [x, y] of coords) { v.setFloat64(o, x, true); o += 8; v.setFloat64(o, y, true); o += 8; }
  return new Uint8Array(buf);
}
function lineWkb(coords) {
  const count = coords.length;
  const buf = new ArrayBuffer(1 + 4 + 4 + count * 16);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, 1); o += 1;
  v.setUint32(o, 2, true); o += 4;
  v.setUint32(o, count, true); o += 4;
  for (const [x, y] of coords) { v.setFloat64(o, x, true); o += 8; v.setFloat64(o, y, true); o += 8; }
  return new Uint8Array(buf);
}

function blockBounds(i, j) {
  const xMin = i * GRID_PITCH_M - BLOCK_SIZE_M / 2;
  const xMax = i * GRID_PITCH_M + BLOCK_SIZE_M / 2;
  const yMin = j * GRID_PITCH_M - BLOCK_SIZE_M / 2;
  const yMax = j * GRID_PITCH_M + BLOCK_SIZE_M / 2;
  return { xMin, xMax, yMin, yMax };
}

function roadKey(orientation, fixed, min, max) {
  return `${orientation}|${fixed}|${Math.min(min, max)}|${Math.max(min, max)}`;
}

function addRoad(roadsMap, r) {
  const k = roadKey(r.orientation, r.fixed, r.start, r.end);
  const existing = roadsMap.get(k);
  if (!existing || r.width_m > existing.width_m) roadsMap.set(k, r);
}

function paveBlock(roadsMap, i, j, year, roadClass = 'local') {
  const b = blockBounds(i, j);
  const width = roadClass === 'arterial' ? ARTERIAL_WIDTH_M : LOCAL_ROAD_WIDTH_M;
  addRoad(roadsMap, { orientation: 'h', fixed: b.yMin - ROAD_BUFFER_M / 2, start: b.xMin - ROAD_BUFFER_M / 2, end: b.xMax + ROAD_BUFFER_M / 2, road_class: roadClass, width_m: width, year_paved: year });
  addRoad(roadsMap, { orientation: 'h', fixed: b.yMax + ROAD_BUFFER_M / 2, start: b.xMin - ROAD_BUFFER_M / 2, end: b.xMax + ROAD_BUFFER_M / 2, road_class: roadClass, width_m: width, year_paved: year });
  addRoad(roadsMap, { orientation: 'v', fixed: b.xMin - ROAD_BUFFER_M / 2, start: b.yMin - ROAD_BUFFER_M / 2, end: b.yMax + ROAD_BUFFER_M / 2, road_class: roadClass, width_m: width, year_paved: year });
  addRoad(roadsMap, { orientation: 'v', fixed: b.xMax + ROAD_BUFFER_M / 2, start: b.yMin - ROAD_BUFFER_M / 2, end: b.yMax + ROAD_BUFFER_M / 2, road_class: roadClass, width_m: width, year_paved: year });
}

function buildInflationSeries(startYear, endYear) {
  const start = new Date(Date.UTC(startYear, 0, 1));
  const end = new Date(Date.UTC(endYear, 0, 1));
  const monthly = [];
  let idx = 1;
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(y, m, 1));
      if (d > end) break;
      const macro = 0.0018 + ((m % 6) * 0.0001);
      const local = 0.0004;
      idx *= 1 + macro + local;
      monthly.push({ date: d, idx });
    }
  }
  const mMap = new Map(monthly.map((m) => [toDateStringUTC(m.date), m.idx]));
  const rows = [];
  const dayMs = 86400000;
  for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
    const d = new Date(t);
    const cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const nxt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const a = mMap.get(toDateStringUTC(cur)) ?? 1;
    const b = mMap.get(toDateStringUTC(nxt)) ?? a;
    const f = clamp((t - cur.getTime()) / (nxt.getTime() - cur.getTime() || dayMs), 0, 1);
    rows.push({ period: toDateStringUTC(d), start_indexed: a + (b - a) * f, end_indexed: 0, correction_factor: 0 });
  }
  const last = rows.length ? rows[rows.length - 1].start_indexed : 1;
  rows.forEach((r) => { r.end_indexed = r.start_indexed / last; r.correction_factor = 1 / r.end_indexed; });
  return { rows, byDate: new Map(rows.map((r) => [r.period, r])) };
}

function assignNeighborhoods(blocks, rng) {
  const unassigned = new Set(blocks.map((b) => `${b.i},${b.j}`));
  const neigh = [];
  let nIndex = 1;
  while (unassigned.size) {
    const seedKey = randPick(rng, Array.from(unassigned));
    const target = 2 + Math.floor(rng() * 7);
    const queue = [seedKey];
    const members = [];
    while (queue.length && members.length < target) {
      const k = queue.shift();
      if (!unassigned.has(k)) continue;
      unassigned.delete(k);
      members.push(k);
      const [i, j] = k.split(',').map(Number);
      [[i+1,j],[i-1,j],[i,j+1],[i,j-1]].forEach(([ni,nj]) => {
        const nk = `${ni},${nj}`;
        if (unassigned.has(nk) && rng() < 0.8) queue.push(nk);
      });
    }
    neigh.push({ name: `Neighborhood ${nIndex++}`, blocks: new Set(members) });
  }
  return neigh;
}

function pickZoningForBlock(i, j, arterialNearby) {
  const cbd = Math.abs(i) < CBD_HALF_BLOCKS && Math.abs(j) < CBD_HALF_BLOCKS;
  if (cbd) return 'MX';
  if (arterialNearby) {
    // 45/35/20
    const r = ((i * 13 + j * 17) % 100 + 100) % 100;
    if (r < 45) return 'C1';
    if (r < 80) return 'R4';
    return 'MX';
  }
  const d = Math.sqrt(i * i + j * j);
  if (d > 15) return 'AG';
  if (d > 10) return 'R2';
  if (d > 7) return 'R3';
  return 'R4';
}

function buildRoadsAndBlocks(config, rng) {
  const roads = new Map();
  const paved = new Map();
  const endYear = config.endYear;

  for (let i = -INITIAL_HALF_BLOCKS; i < INITIAL_HALF_BLOCKS; i++) {
    for (let j = -INITIAL_HALF_BLOCKS; j < INITIAL_HALF_BLOCKS; j++) {
      paved.set(`${i},${j}`, { i, j, year_paved: 1940 });
      const isArterial = i % ARTERIAL_CADENCE === 0 || j % ARTERIAL_CADENCE === 0;
      paveBlock(roads, i, j, 1940, isArterial ? 'arterial' : 'local');
    }
  }

  const beltMin = blockBounds(-INITIAL_HALF_BLOCKS, -INITIAL_HALF_BLOCKS);
  const beltMax = blockBounds(INITIAL_HALF_BLOCKS - 1, INITIAL_HALF_BLOCKS - 1);
  addRoad(roads, { orientation: 'h', fixed: beltMin.yMin - ROAD_BUFFER_M / 2, start: beltMin.xMin - ROAD_BUFFER_M / 2, end: beltMax.xMax + ROAD_BUFFER_M / 2, road_class: 'beltway', width_m: BELTWAY_WIDTH_M, year_paved: 1940, name: 'North Beltway' });
  addRoad(roads, { orientation: 'h', fixed: beltMax.yMax + ROAD_BUFFER_M / 2, start: beltMin.xMin - ROAD_BUFFER_M / 2, end: beltMax.xMax + ROAD_BUFFER_M / 2, road_class: 'beltway', width_m: BELTWAY_WIDTH_M, year_paved: 1940, name: 'South Beltway' });
  addRoad(roads, { orientation: 'v', fixed: beltMin.xMin - ROAD_BUFFER_M / 2, start: beltMin.yMin - ROAD_BUFFER_M / 2, end: beltMax.yMax + ROAD_BUFFER_M / 2, road_class: 'beltway', width_m: BELTWAY_WIDTH_M, year_paved: 1940, name: 'West Beltway' });
  addRoad(roads, { orientation: 'v', fixed: beltMax.xMax + ROAD_BUFFER_M / 2, start: beltMin.yMin - ROAD_BUFFER_M / 2, end: beltMax.yMax + ROAD_BUFFER_M / 2, road_class: 'beltway', width_m: BELTWAY_WIDTH_M, year_paved: 1940, name: 'East Beltway' });

  // Highways connect at beltway side midpoints and do not pass through the city core.
  const beltTopY = beltMax.yMax + ROAD_BUFFER_M / 2;
  const beltBottomY = beltMin.yMin - ROAD_BUFFER_M / 2;
  const beltLeftX = beltMin.xMin - ROAD_BUFFER_M / 2;
  const beltRightX = beltMax.xMax + ROAD_BUFFER_M / 2;
  const ext = 80 * GRID_PITCH_M;

  // N/S highway: two segments touching top and bottom beltway midpoints.
  addRoad(roads, { orientation: 'v', fixed: 0, start: beltTopY, end: ext, road_class: 'highway', width_m: HIGHWAY_WIDTH_M, year_paved: 1940, name: 'N/S Highway' });
  addRoad(roads, { orientation: 'v', fixed: 0, start: -ext, end: beltBottomY, road_class: 'highway', width_m: HIGHWAY_WIDTH_M, year_paved: 1940, name: 'N/S Highway' });

  // E/W highway: two segments touching west and east beltway midpoints.
  addRoad(roads, { orientation: 'h', fixed: 0, start: -ext, end: beltLeftX, road_class: 'highway', width_m: HIGHWAY_WIDTH_M, year_paved: 1940, name: 'E/W Highway' });
  addRoad(roads, { orientation: 'h', fixed: 0, start: beltRightX, end: ext, road_class: 'highway', width_m: HIGHWAY_WIDTH_M, year_paved: 1940, name: 'E/W Highway' });

  for (let year = 1941; year <= endYear; year++) {
    const budget = Math.max(0, Math.round(FRONTIER_BUDGET_INITIAL * Math.pow(1 + FRONTIER_BUDGET_GROWTH, year - 1940)));
    const frontier = new Set();
    for (const b of paved.values()) {
      [[b.i+1,b.j],[b.i-1,b.j],[b.i,b.j+1],[b.i,b.j-1]].forEach(([ni,nj]) => {
        const k = `${ni},${nj}`;
        if (!paved.has(k)) frontier.add(k);
      });
    }
    const candidates = Array.from(frontier);
    let used = 0;
    while (used < budget && candidates.length) {
      const idx = Math.floor(rng() * candidates.length);
      const k = candidates.splice(idx, 1)[0];
      const [i,j] = k.split(',').map(Number);
      paved.set(k, { i, j, year_paved: year });
      const arterial = i % ARTERIAL_CADENCE === 0 || j % ARTERIAL_CADENCE === 0;
      paveBlock(roads, i, j, year, arterial ? 'arterial' : 'local');
      used++;
    }
  }

  // naming
  const uniqueX = Array.from(new Set(Array.from(roads.values()).filter((r) => r.orientation === 'v').map((r) => r.fixed))).sort((a,b)=>a-b);
  const uniqueY = Array.from(new Set(Array.from(roads.values()).filter((r) => r.orientation === 'h').map((r) => r.fixed))).sort((a,b)=>a-b);
  let serviceIdx = 0;
  roads.forEach((r) => {
    if (r.name) return;
    if (r.road_class === 'highway' || r.road_class === 'beltway') return;
    const onGrid = Math.abs(((r.fixed + BLOCK_SIZE_M / 2) / GRID_PITCH_M) - Math.round((r.fixed + BLOCK_SIZE_M / 2) / GRID_PITCH_M)) < 0.0001;
    if (onGrid && r.road_class !== 'local_service') {
      if (r.orientation === 'v') r.name = `${uniqueX.indexOf(r.fixed) + 1}th Avenue`;
      else r.name = `${uniqueY.indexOf(r.fixed) + 1}th Street`;
    } else {
      const base = FRUIT_VEG_NAMES[serviceIdx % FRUIT_VEG_NAMES.length];
      r.name = `${base} ${r.orientation === 'v' ? 'Avenue' : 'Street'}`;
      serviceIdx += 1;
    }
  });

  const blocks = Array.from(paved.values());
  const neighborhoods = assignNeighborhoods(blocks, rng);
  const nbByBlock = new Map();
  neighborhoods.forEach((n) => n.blocks.forEach((k) => nbByBlock.set(k, n.name)));

  return { roads: Array.from(roads.values()), blocks, nbByBlock };
}

function metersToAcres(m2) { return m2 * 0.000247105; }

function createParcelsFromBlock(block, roads, nbByBlock, centerLon, centerLat, rng, keyBase) {
  const { i, j } = block;
  const b = blockBounds(i, j);
  const blockKey = `${i},${j}`;
  const arterialNearby = roads.some((r) => r.road_class === 'arterial' && ((r.orientation === 'v' && Math.abs(r.fixed - (b.xMin - ROAD_BUFFER_M/2)) <= GRID_PITCH_M/2) || (r.orientation === 'h' && Math.abs(r.fixed - (b.yMin - ROAD_BUFFER_M/2)) <= GRID_PITCH_M/2)));
  const zoning = pickZoningForBlock(i, j, arterialNearby);
  const allowed = ZONING_ALLOWED[zoning];
  const weights = ZONING_WEIGHTS[zoning];

  const parcels = [];
  let parcelIndex = 0;
  const split = 2 + Math.floor(rng() * 3);
  const laneNeeded = split >= 4;
  const laneWidth = laneNeeded ? 4 : 0;
  const width = (b.xMax - b.xMin - laneWidth) / split;

  for (let s = 0; s < split; s++) {
    const x0 = b.xMin + s * width;
    const x1 = x0 + width;
    const poly = [[x0, b.yMin], [x1, b.yMin], [x1, b.yMax], [x0, b.yMax], [x0, b.yMin]];
    const model_group = weightedPick(rng, weights);
    if (!allowed.includes(model_group)) continue;
    const areaSqft = Math.round((width * (b.yMax - b.yMin)) * 10.7639);
    const areaAc = metersToAcres(width * (b.yMax - b.yMin));
    if (areaAc < MIN_PARCEL_ACRES[model_group]) continue;
    const boundedArea = Math.min(areaAc, MAX_PARCEL_ACRES[model_group]);
    const lotFactor = boundedArea / Math.max(0.01, areaAc);
    const adjWidth = width * lotFactor;
    const adjPoly = [[x0, b.yMin], [x0 + adjWidth, b.yMin], [x0 + adjWidth, b.yMax], [x0, b.yMax], [x0, b.yMin]];

    parcelIndex += 1;
    const key = `${String(keyBase).padStart(5, '0')}-${String(parcelIndex).padStart(2, '0')}`;
    const ll = adjPoly.map(([x, y]) => metersToLonLat(centerLon, centerLat, x, y));
    const modelType = randPick(rng, BLDG_TYPE_BY_GROUP[model_group]);
    const neighborhood = nbByBlock.get(blockKey) || 'Neighborhood 0';
    const dCenter = Math.sqrt(i*i + j*j);
    const baseStory = model_group === 'multi_family' ? 2 : model_group === 'commercial' ? 2 : 1;
    const footprint = model_group === 'agricultural' ? 0 : Math.max(250, Math.round(areaSqft * (0.12 + rng() * 0.35)));
    const finished = Math.round(footprint * baseStory * (0.9 + rng() * 0.25));
    parcels.push({
      key,
      geometry: { type: 'Polygon', coordinates: [ll] },
      block_i: i,
      block_j: j,
      year_paved: block.year_paved,
      neighborhood,
      zoning,
      model_group,
      land_type: LAND_TYPE_BY_GROUP[model_group],
      land_area_sqft: Math.round(adjWidth * (b.yMax - b.yMin) * 10.7639),
      longitude: ll.reduce((s, p) => s + p[0], 0) / ll.length,
      latitude: ll.reduce((s, p) => s + p[1], 0) / ll.length,
      bldg_type: footprint > 0 ? modelType : 'NONE',
      bldg_area_footprint_sqft: footprint,
      bldg_area_finished_sqft: finished,
      bldg_stories: footprint > 0 ? baseStory : 0,
      bldg_units: model_group === 'multi_family' ? 2 + Math.floor(rng() * 16) : 0,
      bldg_rooms_bed: model_group === 'single_family' ? Math.max(1, Math.round(finished / 700)) : 0,
      bldg_rooms_bath: model_group === 'single_family' ? Math.max(1, Math.round(finished / 1200)) : 0,
      bldg_quality_num: footprint > 0 ? 2 + Math.floor(rng() * 4) : 0,
      bldg_condition_num: footprint > 0 ? 45 + Math.floor(rng() * 45) : 0,
      bldg_year_built: footprint > 0 ? block.year_paved : null,
      bldg_year_renovated: null,
      distance_to_center_blocks: dCenter,
      arterial_frontage: arterialNearby
    });
  }
  return parcels;
}

function calcValues(p, inflationIndex) {
  const centerPremium = Math.max(0.6, 2.4 - p.distance_to_center_blocks * 0.08);
  const zoningPremium = p.zoning.startsWith('C') || p.zoning === 'MX' ? 1.35 : p.zoning.startsWith('I') ? 1.15 : p.zoning === 'AG' ? 0.75 : 1;
  const arterialAdj = p.model_group === 'single_family' && p.arterial_frontage ? SF_ARTERIAL_PENALTY : (p.arterial_frontage ? 1.12 : 1);
  const land = Math.round(p.land_area_sqft * 3.8 * centerPremium * zoningPremium * arterialAdj * Math.pow(inflationIndex, 0.55));
  const impro = Math.round(p.bldg_area_finished_sqft * 85 * (0.2 + p.bldg_condition_num / 120) * (1 + p.bldg_quality_num * 0.06));
  return { platonic_land_value: land, platonic_impr_value: impro, platonic_market_value: land + impro };
}

function maybeRedevelop(p, rng) {
  if (p.bldg_area_finished_sqft <= 0) return;
  const ratio = p.platonic_land_value / Math.max(1, p.platonic_impr_value);
  if (ratio > 2.2 && rng() < clamp((ratio - 2.2) * 0.07, 0, 0.35)) {
    p.bldg_condition_num = 70 + Math.floor(rng() * 25);
    p.bldg_year_built = p.current_year;
    p.bldg_area_footprint_sqft = Math.round(p.land_area_sqft * (0.2 + rng() * 0.35));
    p.bldg_area_finished_sqft = Math.round(p.bldg_area_footprint_sqft * (1 + Math.floor(rng() * 2)));
  }
}

function roadsToFeatures(roads, centerLon, centerLat) {
  return roads.map((r, idx) => {
    const c1 = r.orientation === 'h' ? [r.start, r.fixed] : [r.fixed, r.start];
    const c2 = r.orientation === 'h' ? [r.end, r.fixed] : [r.fixed, r.end];
    const p1 = metersToLonLat(centerLon, centerLat, c1[0], c1[1]);
    const p2 = metersToLonLat(centerLon, centerLat, c2[0], c2[1]);
    return {
      road_id: `r${idx + 1}`,
      road_class: r.road_class,
      width_m: r.width_m,
      year_paved: r.year_paved,
      road_name: r.name || 'Unnamed Road',
      geometry: { type: 'LineString', coordinates: [p1, p2] }
    };
  });
}

function generateSimulation(config) {
  const rng = makeSeededRng(config.seed);
  progress('Laying out roads and blocks...');
  const infra = buildRoadsAndBlocks(config, rng);
  const roadFeatures = roadsToFeatures(infra.roads, config.centerLon, config.centerLat);

  progress('Carving parcels from paved blocks...');
  let keyBase = 1;
  let universe = [];
  infra.blocks.forEach((b) => {
    const rows = createParcelsFromBlock(b, infra.roads, infra.nbByBlock, config.centerLon, config.centerLat, rng, keyBase);
    keyBase += 1;
    universe = universe.concat(rows);
  });

  progress('Building inflation series...');
  const inflation = buildInflationSeries(1940, config.endYear);
  progress('Simulating yearly sales and redevelopment...');

  const sales = [];
  const sales_platonic = [];
  const currentByKey = new Map(universe.map((p) => [p.key, p]));

  for (let year = 1940; year <= config.endYear; year++) {
    for (const p of universe) {
      p.current_year = year;
      p.bldg_condition_num = clamp(p.bldg_condition_num - (0.35 + rng() * 1.2), 0, 100);
      const yearInfl = inflation.byDate.get(`${year}-01-01`)?.start_indexed || 1;
      Object.assign(p, calcValues(p, yearInfl));
      maybeRedevelop(p, rng);

      const threshold = 120000 * Math.pow(yearInfl, 0.65);
      const developScore = clamp((p.platonic_land_value - threshold) / Math.max(1, threshold), 0, 2);
      const saleProb = clamp((config.saleProbabilities[p.model_group] || 0.05) + developScore * 0.02, 0.01, 0.45);
      if (rng() > saleProb) continue;

      const saleDate = toDateStringUTC(new Date(Date.UTC(year, Math.floor(rng() * 12), 1 + Math.floor(rng() * 28))));
      const infl = inflation.byDate.get(saleDate) || inflation.rows[inflation.rows.length - 1];
      const base = calcValues(p, infl.start_indexed);
      const platonicSale = Math.max(1, Math.round(base.platonic_market_value));
      const noise = Math.round((rng() - 0.5) * 0.05 * platonicSale);
      const truePrice = Math.max(1, platonicSale + noise);
      const key_sale = `${p.key}---${saleDate}`;
      const plat = {
        ...p,
        key_sale,
        sale_date: saleDate,
        sale_type: 'VALID',
        valid_sale: true,
        sale_noise: noise,
        sale_price: truePrice,
        vacant_sale: p.bldg_area_finished_sqft === 0,
        inflation_index: infl.start_indexed,
        ...base
      };
      const obs = { ...plat };
      if (rng() < config.invalidPct / 100) {
        obs.sale_type = 'NOT_ARMS_LENGTH';
        obs.sale_price = rng() < 0.5 ? randPick(rng, config.nominalPriceList) : Math.max(1, Math.round((rng() * 999) / 5) * 5);
        obs.valid_sale = true;
        plat.sale_type = 'NOT_ARMS_LENGTH';
        plat.valid_sale = false;
      }
      sales_platonic.push(plat);
      sales.push(obs);
      currentByKey.set(p.key, p);
    }

    if ((year - 1940) % config.repaintYears === 0 || year === config.endYear) {
      send('milestone', { featureCollection: { type: 'FeatureCollection', features: Array.from(currentByKey.values()).slice(0, 3500).map((r) => ({ type: 'Feature', geometry: r.geometry, properties: { neighborhood: r.neighborhood } })) } });
      log(`Milestone repaint: year ${year}.`);
    }
  }

  return {
    config,
    crs: 'EPSG:4326',
    universeCount: universe.length,
    salesCount: sales.length,
    roadsCount: roadFeatures.length,
    preview: { type: 'FeatureCollection', features: universe.slice(0, 3500).map((r) => ({ type: 'Feature', geometry: r.geometry, properties: { neighborhood: r.neighborhood } })) },
    universe,
    sales,
    sales_platonic,
    roads: roadFeatures,
    inflation: inflation.rows
  };
}

function inferType(v) { if (v == null) return 'string'; if (typeof v === 'boolean') return 'bool'; if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'; return 'string'; }
function arrowType(Arrow, k) { if (k === 'bool') return new Arrow.Bool(); if (k === 'int') return new Arrow.Int32(); if (k === 'float') return new Arrow.Float64(); return new Arrow.Utf8(); }

function rowToFields(rows) {
  const keys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'geometry') keys.add(k); }));
  return Array.from(keys).map((name) => ({ name, kind: inferType(rows.find((r) => r[name] != null)?.[name] ?? null) }));
}

async function toGeoParquetBytes(rows) {
  if (!rows.length) throw new Error('No rows to export.');
  const Arrow = self.Arrow;
  if (!Arrow) throw new Error('Arrow library failed to load.');
  const { arrowSchema, geoMeta } = await ensureArrowHelpers();
  const { makeArrowTable, tableToIPC } = arrowSchema;
  const { createGeoMetadata } = geoMeta;

  const geomType = rows[0]?.geometry?.type === 'LineString' ? 'LineString' : 'Polygon';
  const fields = rowToFields(rows);
  const geoMetadata = await createGeoMetadata({ wkid: 4326, latestWkid: 4326, wkt: null }, geomType);
  const schema = new Arrow.Schema([
    new Arrow.Field('geometry', new Arrow.Binary(), true),
    ...fields.map((f) => new Arrow.Field(f.name, arrowType(Arrow, f.kind), true))
  ], new Map([['geo', JSON.stringify(geoMetadata)]]));

  const geomBuilder = Arrow.makeBuilder({ type: new Arrow.Binary(), nullValues: [null, undefined] });
  const builders = new Map(fields.map((f) => [f.name, Arrow.makeBuilder({ type: arrowType(Arrow, f.kind), nullValues: [null, undefined] })]));

  rows.forEach((row) => {
    const coords = row.geometry.coordinates;
    const wkb = row.geometry.type === 'LineString' ? lineWkb(coords) : polygonWkb(coords[0]);
    geomBuilder.append(wkb);
    fields.forEach((f) => builders.get(f.name).append(row[f.name] == null ? null : row[f.name]));
  });
  geomBuilder.finish();
  const vectors = [geomBuilder.toVector()];
  fields.forEach((f) => { const b = builders.get(f.name); b.finish(); vectors.push(b.toVector()); });

  const table = makeArrowTable(Arrow, schema, vectors);
  const ipc = tableToIPC(Arrow, table, 'stream');
  const parquetModule = await ensureParquetModule();
  const wasmTable = parquetModule.Table.fromIPCStream(ipc);
  const writerProps = new parquetModule.WriterPropertiesBuilder().setCompression(parquetModule.Compression.ZSTD).setKeyValueMetadata(new Map([['geo', JSON.stringify(geoMetadata)]])).build();
  return parquetModule.writeParquet(wasmTable, writerProps);
}

function crc32(bytes) {
  const table = crc32.table || (crc32.table = (() => {
    const tbl = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : (c >>> 1);
      tbl[i] = c >>> 0;
    }
    return tbl;
  })());
  let crc = 0xFFFFFFFF;
  bytes.forEach((b) => { crc = table[(crc ^ b) & 0xFF] ^ (crc >>> 8); });
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function buildZipBlob(files) {
  const local = []; const central = []; let offset = 0;
  files.forEach((file) => {
    const nameBytes = new TextEncoder().encode(file.name);
    const data = new Uint8Array(file.data);
    const crc = crc32(data);
    const lh = new Uint8Array(30 + nameBytes.length); const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true); lh.set(nameBytes, 30);
    local.push(lh, data);
    const ch = new Uint8Array(46 + nameBytes.length); const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true); cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true); ch.set(nameBytes, 46);
    central.push(ch); offset += lh.length + data.length;
  });
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}

async function buildExportZip(payload) {
  progress('Encoding universe.geoparquet...');
  const universeBytes = await toGeoParquetBytes(payload.universe);
  progress('Encoding sales.geoparquet...');
  const salesBytes = await toGeoParquetBytes(payload.sales);
  progress('Encoding sales_platonic.geoparquet...');
  const platBytes = await toGeoParquetBytes(payload.sales_platonic);
  progress('Encoding roads.geoparquet...');
  const roadsBytes = await toGeoParquetBytes(payload.roads);
  progress('Encoding inflation.csv...');
  const csv = ['period,start_indexed,end_indexed,correction_factor', ...payload.inflation.map((r) => `${r.period},${r.start_indexed},${r.end_indexed},${r.correction_factor}`)].join('\n');
  const inflationBytes = textEncoder.encode(csv);
  const metadata = {
    seed: payload.config.seed,
    app_version: 'mvp-0.2-network',
    crs: 'EPSG:4326',
    center: { city_name: payload.config.cityName, latitude: payload.config.centerLat, longitude: payload.config.centerLon },
    start_year: 1940,
    end_year: payload.config.endYear,
    parcel_count: payload.universeCount,
    road_count: payload.roadsCount,
    repaint_interval_years: payload.config.repaintYears,
    invalid_pct: payload.config.invalidPct,
    sale_probabilities: payload.config.saleProbabilities,
    nominal_price_list: payload.config.nominalPriceList
  };
  const metaBytes = textEncoder.encode(JSON.stringify(metadata, null, 2));

  return buildZipBlob([
    { name: 'universe.geoparquet', data: universeBytes },
    { name: 'sales.geoparquet', data: salesBytes },
    { name: 'sales_platonic.geoparquet', data: platBytes },
    { name: 'roads.geoparquet', data: roadsBytes },
    { name: 'inflation.csv', data: inflationBytes },
    { name: 'metadata.json', data: metaBytes }
  ]);
}

self.onmessage = async (event) => {
  const { mode, config, payload } = event.data || {};
  try {
    if (mode === 'generate') {
      const effective = { ...config, startYear: 1940 };
      send('success', generateSimulation(effective));
      return;
    }
    if (mode === 'export') {
      const zipBlob = await buildExportZip(payload);
      send('zip', { zipBlob, filename: `synthetic_city_${new Date().toISOString().slice(0, 10)}.zip` });
    }
  } catch (err) {
    send('error', { message: err?.message || String(err), stack: err?.stack || null });
  }
};
