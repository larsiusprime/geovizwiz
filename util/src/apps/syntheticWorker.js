/* global self */
importScripts('../../vendor/apache-arrow.js');

const MODEL_GROUPS = ['single_family', 'multi_family', 'commercial', 'industrial', 'mobile_home', 'agricultural'];
const BLDG_TYPE_BY_GROUP = {
  single_family: ['SF_RANCH', 'SF_TWO_STORY', 'SF_TOWNHOUSE'],
  multi_family: ['MF_DUPLEX', 'MF_TRIPLEX', 'MF_GARDEN_APT', 'MF_MIDRISE_APT'],
  commercial: ['COMM_RETAIL_SMALL', 'COMM_RETAIL_BIGBOX', 'COMM_OFFICE_LOWRISE', 'COMM_MIXED_USE'],
  industrial: ['IND_WAREHOUSE', 'IND_LIGHT_MANUFACTURING', 'IND_FLEX'],
  mobile_home: ['MH_SINGLE_WIDE', 'MH_DOUBLE_WIDE', 'MH_PARK_PAD'],
  agricultural: ['AG_ROW_CROP', 'AG_PASTURE', 'AG_FARMSTEAD']
};
const ZONING_BY_GROUP = {
  single_family: ['R1', 'R2'], multi_family: ['R3', 'R4'], commercial: ['C1', 'C2'], industrial: ['I1', 'I2'], mobile_home: ['R-MH'], agricultural: ['AG']
};
const LAND_TYPE_BY_GROUP = {
  single_family: ['residential'], multi_family: ['residential'], commercial: ['commercial'], industrial: ['industrial'], mobile_home: ['residential'], agricultural: ['agricultural']
};

const textEncoder = new TextEncoder();
const send = (type, payload) => self.postMessage({ type, payload });
const log = (message) => send('log', { message });
const progress = (message) => send('progress', { message });
const randPick = (rng, items) => items[Math.floor(rng() * items.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

let parquetModulePromise = null;
let parquetInitialized = false;
let arrowHelpersPromise = null;

async function ensureParquetModule() {
  if (!parquetModulePromise) {
    parquetModulePromise = import('../../vendor/parquet-wasm/esm/parquet_wasm.js').then(async (mod) => {
      if (!parquetInitialized) {
        progress('Loading parquet encoder...');
        const wasmUrl = new URL('../../vendor/parquet-wasm/esm/parquet_wasm_bg.wasm', self.location.href);
        await mod.default(wasmUrl);
        parquetInitialized = true;
      }
      return mod;
    });
  }
  return parquetModulePromise;
}

async function ensureArrowHelpers() {
  if (!arrowHelpersPromise) {
    arrowHelpersPromise = Promise.all([
      import('../parquet/arrowSchema.js'),
      import('../geo/geoparquetMeta.js')
    ]).then(([arrowSchema, geoMeta]) => ({ arrowSchema, geoMeta }));
  }
  return arrowHelpersPromise;
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

    const lh = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(lh.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); lv.setUint32(22, data.length, true); lv.setUint16(26, nameBytes.length, true);
    lh.set(nameBytes, 30);
    local.push(lh, data);

    const ch = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(ch.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, data.length, true); cv.setUint32(24, data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint32(42, offset, true);
    ch.set(nameBytes, 46);
    central.push(ch);
    offset += lh.length + data.length;
  });
  const centralSize = central.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  return new Blob([...local, ...central, end], { type: 'application/zip' });
}

function makeSeededRng(seedText) {
  let h = 2166136261 >>> 0;
  const src = String(seedText || 'synthetic-city');
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 16777619); }
  let state = h >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; state >>>= 0; return state / 4294967296; };
}

function metersToLonLat(centerLon, centerLat, dx, dy) {
  const degLat = dy / 111320;
  const degLon = dx / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return [centerLon + degLon, centerLat + degLat];
}
function toDateStringUTC(d) { return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; }

function polygonWkb(coords) {
  const count = coords.length; const buf = new ArrayBuffer(1 + 4 + 4 + 4 + count * 16); const v = new DataView(buf); let o = 0;
  v.setUint8(o, 1); o += 1; v.setUint32(o, 3, true); o += 4; v.setUint32(o, 1, true); o += 4; v.setUint32(o, count, true); o += 4;
  for (const [x, y] of coords) { v.setFloat64(o, x, true); o += 8; v.setFloat64(o, y, true); o += 8; }
  return new Uint8Array(buf);
}

function buildInflationSeries(startYear, endYear) {
  const start = new Date(Date.UTC(startYear, 0, 1));
  const end = new Date(Date.UTC(endYear, 0, 1));
  const monthly = []; let idx = 1;
  for (let y = startYear; y <= endYear; y++) for (let m = 0; m < 12; m++) {
    const d = new Date(Date.UTC(y, m, 1)); if (d > end) break; const r = 0.002 + ((m % 6) * 0.0001); idx *= (1 + r); monthly.push({ date: d, idx });
  }
  const mMap = new Map(monthly.map((m) => [toDateStringUTC(m.date), m.idx]));
  const rows = []; const dayMs = 86400000;
  for (let t = start.getTime(); t <= end.getTime(); t += dayMs) {
    const d = new Date(t); const cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); const nxt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const a = mMap.get(toDateStringUTC(cur)) ?? 1; const b = mMap.get(toDateStringUTC(nxt)) ?? a;
    const f = clamp((t - cur.getTime()) / (nxt.getTime() - cur.getTime() || dayMs), 0, 1);
    rows.push({ period: toDateStringUTC(d), start_indexed: a + (b - a) * f, end_indexed: 0, correction_factor: 0 });
  }
  const last = rows.length ? rows[rows.length - 1].start_indexed : 1;
  rows.forEach((r) => { r.end_indexed = r.start_indexed / last; r.correction_factor = 1 / r.end_indexed; });
  return { rows, byDate: new Map(rows.map((r) => [r.period, r])) };
}

function neighborhoodForOffset(dx, dy) {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(dy) < 120 && Math.abs(dx) < 1600) return 'commercial corridors';
  if (dx > 800 && dy < -800) return 'industrial sector';
  if (dist < 320) return 'CBD'; if (dist < 780) return 'inner ring'; if (dist < 1300) return 'suburb'; if (dist < 1900) return 'exurb'; return 'rural outlying';
}
function chooseGroupByNeighborhood(rng, n) {
  if (n === 'CBD') return rng() < 0.7 ? 'commercial' : 'multi_family';
  if (n === 'inner ring') return randPick(rng, ['single_family', 'multi_family', 'commercial']);
  if (n === 'commercial corridors') return randPick(rng, ['commercial', 'single_family']);
  if (n === 'industrial sector') return randPick(rng, ['industrial', 'commercial']);
  if (n === 'rural outlying') return randPick(rng, ['agricultural', 'single_family']);
  if (n === 'exurb') return randPick(rng, ['single_family', 'mobile_home', 'agricultural']);
  return randPick(rng, ['single_family', 'multi_family', 'mobile_home']);
}

function buildParcelRecord({ key, centerLon, centerLat, i, j, n, cellM, rng }) {
  const half = (n - 1) / 2; const dx = (i - half) * cellM; const dy = (j - half) * cellM;
  const width = cellM * (0.85 + rng() * 0.35); const height = cellM * (0.85 + rng() * 0.35);
  const x0 = dx - width / 2; const x1 = dx + width / 2; const y0 = dy - height / 2; const y1 = dy + height / 2;
  const p0 = metersToLonLat(centerLon, centerLat, x0, y0), p1 = metersToLonLat(centerLon, centerLat, x1, y0), p2 = metersToLonLat(centerLon, centerLat, x1, y1), p3 = metersToLonLat(centerLon, centerLat, x0, y1);
  const neighborhood = neighborhoodForOffset(dx, dy);
  const model_group = chooseGroupByNeighborhood(rng, neighborhood);
  const bldg_type = randPick(rng, BLDG_TYPE_BY_GROUP[model_group]);
  const zoning = randPick(rng, ZONING_BY_GROUP[model_group]);
  const land_type = randPick(rng, LAND_TYPE_BY_GROUP[model_group]);
  const land_area_sqft = Math.max(1000, Math.round((width * height) * 10.7639));
  const stories = model_group === 'multi_family' ? 2 : 1;
  const footprint = model_group === 'agricultural' ? 0 : Math.round(land_area_sqft * (0.15 + rng() * 0.4));
  const finished = Math.round(footprint * stories * (0.9 + rng() * 0.2));
  return {
    key, geometry: { type: 'Polygon', coordinates: [[p0, p1, p2, p3, p0]] }, longitude: (p0[0] + p2[0]) / 2, latitude: (p0[1] + p2[1]) / 2,
    neighborhood, model_group, zoning, land_type, land_area_sqft, bldg_type,
    bldg_area_footprint_sqft: footprint, bldg_area_finished_sqft: finished, bldg_stories: footprint > 0 ? stories : 0,
    bldg_units: model_group === 'multi_family' ? 2 + Math.floor(rng() * 12) : 0, bldg_rooms_bed: footprint > 0 ? Math.max(0, Math.round(finished / 700)) : 0,
    bldg_rooms_bath: footprint > 0 ? Math.max(0, Math.round(finished / 1200)) : 0,
    bldg_quality_num: footprint > 0 ? 2 + Math.floor(rng() * 4) : 0, bldg_condition_num: footprint > 0 ? 45 + Math.floor(rng() * 45) : 0,
    bldg_year_built: footprint > 0 ? 1940 + Math.floor(rng() * 80) : null, bldg_year_renovated: null
  };
}

const makeFeature = (row) => ({ type: 'Feature', geometry: row.geometry, properties: Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'geometry')) });

function calcValues(p) {
  const land = Math.round(p.land_area_sqft * (p.neighborhood === 'CBD' ? 42 : p.neighborhood === 'inner ring' ? 21 : 9));
  const impr = Math.round(p.bldg_area_finished_sqft * (p.model_group === 'commercial' ? 180 : p.model_group === 'industrial' ? 115 : 140) * (1 + (p.bldg_quality_num || 0) * 0.07) * (0.2 + (p.bldg_condition_num || 0) / 125));
  return { platonic_land_value: land, platonic_impr_value: impr, platonic_market_value: land + impr };
}

function generateSimulation(config) {
  const rng = makeSeededRng(config.seed);
  const universe = []; const n = Math.ceil(Math.sqrt(config.parcelCount)); const cellM = 70;
  progress('Generating parcel fabric...');
  for (let idx = 0; idx < config.parcelCount; idx++) {
    const i = idx % n, j = Math.floor(idx / n), key = String(idx + 1).padStart(5, '0');
    universe.push(buildParcelRecord({ key, centerLon: config.centerLon, centerLat: config.centerLat, i, j, n, cellM, rng }));
  }
  send('milestone', { featureCollection: { type: 'FeatureCollection', features: universe.slice(0, 4500).map(makeFeature) } });

  progress('Building inflation series...');
  const inflation = buildInflationSeries(config.startYear, config.endYear);
  progress('Simulating yearly events and sales...');

  const sales = []; const sales_platonic = [];
  for (let year = config.startYear; year <= config.endYear; year++) {
    for (const p of universe) {
      if (p.bldg_area_finished_sqft > 0) p.bldg_condition_num = clamp(p.bldg_condition_num - (0.5 + rng() * 1.4), 0, 100);
      const prob = config.saleProbabilities[p.model_group] ?? 0.05;
      if (rng() > prob) continue;
      const saleDate = toDateStringUTC(new Date(Date.UTC(year, Math.floor(rng() * 12), 1 + Math.floor(rng() * 28))));
      const infl = inflation.byDate.get(saleDate) || inflation.rows[inflation.rows.length - 1];
      const vals = calcValues(p);
      const platonicPrice = Math.max(1, Math.round(vals.platonic_market_value * infl.start_indexed));
      const noise = Math.round((rng() - 0.5) * 0.06 * platonicPrice);
      const truePrice = Math.max(1, platonicPrice + noise);
      const key_sale = `${p.key}---${saleDate}`;
      const base = { ...p, key_sale, sale_date: saleDate, sale_type: 'VALID', valid_sale: true, sale_noise: noise, sale_price: truePrice, vacant_sale: p.bldg_area_finished_sqft === 0, inflation_index: infl.start_indexed, ...vals };
      const obs = { ...base };
      if (rng() < config.invalidPct / 100) {
        obs.sale_type = 'NOT_ARMS_LENGTH';
        obs.sale_price = rng() < 0.5 ? randPick(rng, config.nominalPriceList) : Math.max(1, Math.round((rng() * 999) / 5) * 5);
        obs.valid_sale = true;
        base.sale_type = 'NOT_ARMS_LENGTH';
        base.valid_sale = false;
      }
      sales_platonic.push(base); sales.push(obs);
    }
    if ((year - config.startYear) % config.repaintYears === 0 || year === config.endYear) {
      send('milestone', { featureCollection: { type: 'FeatureCollection', features: universe.slice(0, 4500).map(makeFeature) } });
      log(`Milestone repaint: year ${year}.`);
    }
  }
  return { config, crs: 'EPSG:4326', universeCount: universe.length, salesCount: sales.length, preview: { type: 'FeatureCollection', features: universe.slice(0, 4500).map(makeFeature) }, universe, sales, sales_platonic, inflation: inflation.rows };
}

function inferType(v) { if (v == null) return 'string'; if (typeof v === 'boolean') return 'bool'; if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float'; return 'string'; }
function arrowType(Arrow, k) { if (k === 'bool') return new Arrow.Bool(); if (k === 'int') return new Arrow.Int32(); if (k === 'float') return new Arrow.Float64(); return new Arrow.Utf8(); }
function rowToFields(rows) {
  const keys = new Set(); rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'geometry') keys.add(k); }));
  return Array.from(keys).map((name) => ({ name, kind: inferType(rows.find((r) => r[name] != null)?.[name] ?? null) }));
}

async function toGeoParquetBytes(rows) {
  const Arrow = self.Arrow;
  if (!Arrow) throw new Error('Arrow library failed to load.');
  const { arrowSchema, geoMeta } = await ensureArrowHelpers();
  const { makeArrowTable, tableToIPC } = arrowSchema;
  const { createGeoMetadata } = geoMeta;

  const fields = rowToFields(rows);
  const geoMetadata = await createGeoMetadata({ wkid: 4326, latestWkid: 4326, wkt: null }, 'Polygon');
  const schema = new Arrow.Schema([
    new Arrow.Field('geometry', new Arrow.Binary(), true),
    ...fields.map((f) => new Arrow.Field(f.name, arrowType(Arrow, f.kind), true))
  ], new Map([['geo', JSON.stringify(geoMetadata)]]));

  const geomBuilder = Arrow.makeBuilder({ type: new Arrow.Binary(), nullValues: [null, undefined] });
  const builders = new Map(fields.map((f) => [f.name, Arrow.makeBuilder({ type: arrowType(Arrow, f.kind), nullValues: [null, undefined] })]));

  rows.forEach((row) => {
    geomBuilder.append(polygonWkb(row.geometry.coordinates[0]));
    fields.forEach((f) => builders.get(f.name).append(row[f.name] == null ? null : row[f.name]));
  });
  geomBuilder.finish();
  const vectors = [geomBuilder.toVector()];
  fields.forEach((f) => { const b = builders.get(f.name); b.finish(); vectors.push(b.toVector()); });

  const table = makeArrowTable(Arrow, schema, vectors);
  const ipc = tableToIPC(Arrow, table, 'stream');
  const parquetModule = await ensureParquetModule();
  const wasmTable = parquetModule.Table.fromIPCStream(ipc);
  const writerProps = new parquetModule.WriterPropertiesBuilder()
    .setCompression(parquetModule.Compression.ZSTD)
    .setKeyValueMetadata(new Map([['geo', JSON.stringify(geoMetadata)]]))
    .build();
  return parquetModule.writeParquet(wasmTable, writerProps);
}

async function buildExportZip(payload) {
  progress('Encoding universe.geoparquet...');
  const universeBytes = await toGeoParquetBytes(payload.universe);
  progress('Encoding sales.geoparquet...');
  const salesBytes = await toGeoParquetBytes(payload.sales);
  progress('Encoding sales_platonic.geoparquet...');
  const platBytes = await toGeoParquetBytes(payload.sales_platonic);
  progress('Encoding inflation.csv...');
  const csv = ['period,start_indexed,end_indexed,correction_factor', ...payload.inflation.map((r) => `${r.period},${r.start_indexed},${r.end_indexed},${r.correction_factor}`)].join('\n');
  const inflationBytes = textEncoder.encode(csv);
  const metadata = {
    seed: payload.config.seed, app_version: 'mvp-0.1', crs: 'EPSG:4326',
    center: { city_name: payload.config.cityName, latitude: payload.config.centerLat, longitude: payload.config.centerLon },
    start_year: payload.config.startYear, end_year: payload.config.endYear, parcel_count: payload.config.parcelCount,
    repaint_interval_years: payload.config.repaintYears, invalid_pct: payload.config.invalidPct,
    sale_probabilities: payload.config.saleProbabilities, nominal_price_list: payload.config.nominalPriceList
  };
  const metaBytes = textEncoder.encode(JSON.stringify(metadata, null, 2));
  return buildZipBlob([
    { name: 'universe.geoparquet', data: universeBytes },
    { name: 'sales.geoparquet', data: salesBytes },
    { name: 'sales_platonic.geoparquet', data: platBytes },
    { name: 'inflation.csv', data: inflationBytes },
    { name: 'metadata.json', data: metaBytes }
  ]);
}

self.onmessage = async (event) => {
  const { mode, config, payload } = event.data || {};
  try {
    if (mode === 'generate') return send('success', generateSimulation(config));
    if (mode === 'export') {
      const zipBlob = await buildExportZip(payload);
      return send('zip', { zipBlob, filename: `synthetic_city_${new Date().toISOString().slice(0, 10)}.zip` });
    }
  } catch (err) {
    send('error', { message: err?.message || String(err), stack: err?.stack || null });
  }
};
