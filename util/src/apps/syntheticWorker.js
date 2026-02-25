import { buildZipBlob } from '../export/zip.js';
import { makeArrowTable, tableToIPC } from '../parquet/arrowSchema.js';
import { createGeoMetadata } from '../geo/geoparquetMeta.js';
import * as parquetModule from '../../vendor/parquet-wasm/esm/parquet_wasm.js';

let parquetReady = false;

const MODEL_GROUPS = ['single_family', 'multi_family', 'commercial', 'industrial', 'mobile_home', 'agricultural'];

const BLDG_TYPE_BY_GROUP = {
  single_family: ['SF_RANCH', 'SF_TWO_STORY', 'SF_TOWNHOUSE'],
  multi_family: ['MF_DUPLEX', 'MF_TRIPLEX', 'MF_GARDEN_APT', 'MF_MIDRISE_APT'],
  commercial: ['COMM_RETAIL_SMALL', 'COMM_RETAIL_BIGBOX', 'COMM_OFFICE_LOWRISE', 'COMM_MIXED_USE'],
  industrial: ['IND_WAREHOUSE', 'IND_LIGHT_MANUFACTURING', 'IND_FLEX'],
  mobile_home: ['MH_SINGLE_WIDE', 'MH_DOUBLE_WIDE', 'MH_PARK_PAD'],
  agricultural: ['AG_ROW_CROP', 'AG_PASTURE', 'AG_FARMSTEAD']
};

const NEIGHBORHOODS = ['CBD', 'inner ring', 'suburb', 'exurb', 'commercial corridors', 'industrial sector', 'rural outlying'];
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

async function ensureParquetReady() {
  if (parquetReady) return;
  progress('Loading parquet encoder...');
  await parquetModule.default(new URL('../../vendor/parquet-wasm/esm/parquet_wasm_bg.wasm', import.meta.url));
  parquetReady = true;
}

function makeSeededRng(seedText) {
  let h = 2166136261 >>> 0;
  const src = String(seedText || 'synthetic-city');
  for (let i = 0; i < src.length; i++) {
    h ^= src.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  let state = h >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

const randPick = (rng, items) => items[Math.floor(rng() * items.length)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function metersToLonLat(centerLon, centerLat, dx, dy) {
  const degLat = dy / 111320;
  const degLon = dx / (111320 * Math.cos((centerLat * Math.PI) / 180));
  return [centerLon + degLon, centerLat + degLat];
}

function polygonWkb(coords) {
  const points = coords;
  const pointCount = points.length;
  const byteLength = 1 + 4 + 4 + 4 + pointCount * 16;
  const buf = new ArrayBuffer(byteLength);
  const v = new DataView(buf);
  let o = 0;
  v.setUint8(o, 1); o += 1;
  v.setUint32(o, 3, true); o += 4;
  v.setUint32(o, 1, true); o += 4;
  v.setUint32(o, pointCount, true); o += 4;
  for (const [x, y] of points) {
    v.setFloat64(o, x, true); o += 8;
    v.setFloat64(o, y, true); o += 8;
  }
  return new Uint8Array(buf);
}

function toDateStringUTC(d) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildInflationSeries(startYear, endYear) {
  const startDate = new Date(Date.UTC(startYear, 0, 1));
  const endDate = new Date(Date.UTC(endYear, 0, 1));
  const monthly = [];
  let idx = 1;
  for (let y = startYear; y <= endYear; y++) {
    for (let m = 0; m < 12; m++) {
      const d = new Date(Date.UTC(y, m, 1));
      if (d > endDate) break;
      const monthlyRate = 0.002 + ((m % 6) * 0.0001);
      idx *= 1 + monthlyRate;
      monthly.push({ date: d, idx });
    }
  }
  const monthlyMap = new Map(monthly.map((m) => [toDateStringUTC(m.date), m.idx]));
  const rows = [];
  const oneDayMs = 86400000;
  for (let t = startDate.getTime(); t <= endDate.getTime(); t += oneDayMs) {
    const d = new Date(t);
    const cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const curIdx = monthlyMap.get(toDateStringUTC(cur)) ?? 1;
    const nextIdx = monthlyMap.get(toDateStringUTC(next)) ?? curIdx;
    const span = next.getTime() - cur.getTime() || oneDayMs;
    const f = clamp((t - cur.getTime()) / span, 0, 1);
    const startIndexed = curIdx + (nextIdx - curIdx) * f;
    rows.push({ period: toDateStringUTC(d), start_indexed: startIndexed, end_indexed: 0, correction_factor: 0 });
  }
  const last = rows.length ? rows[rows.length - 1].start_indexed : 1;
  rows.forEach((r) => {
    r.end_indexed = r.start_indexed / last;
    r.correction_factor = 1 / r.end_indexed;
  });
  return { rows, byDate: new Map(rows.map((r) => [r.period, r])) };
}

function chooseGroupByNeighborhood(rng, neighborhood) {
  if (neighborhood === 'CBD') return rng() < 0.7 ? 'commercial' : 'multi_family';
  if (neighborhood === 'inner ring') return randPick(rng, ['single_family', 'multi_family', 'commercial']);
  if (neighborhood === 'commercial corridors') return randPick(rng, ['commercial', 'single_family']);
  if (neighborhood === 'industrial sector') return randPick(rng, ['industrial', 'commercial']);
  if (neighborhood === 'rural outlying') return randPick(rng, ['agricultural', 'single_family']);
  if (neighborhood === 'exurb') return randPick(rng, ['single_family', 'mobile_home', 'agricultural']);
  return randPick(rng, ['single_family', 'multi_family', 'mobile_home']);
}

function neighborhoodForOffset(dx, dy) {
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (Math.abs(dy) < 120 && Math.abs(dx) < 1600) return 'commercial corridors';
  if (dx > 800 && dy < -800) return 'industrial sector';
  if (dist < 320) return 'CBD';
  if (dist < 780) return 'inner ring';
  if (dist < 1300) return 'suburb';
  if (dist < 1900) return 'exurb';
  return 'rural outlying';
}

function buildParcelRecord({ key, centerLon, centerLat, i, j, n, cellM, rng }) {
  const half = (n - 1) / 2;
  const dx = (i - half) * cellM;
  const dy = (j - half) * cellM;
  const beltFactor = 1 + 0.08 * Math.sin(Math.sqrt(dx * dx + dy * dy) / 350);
  const width = cellM * (0.85 + rng() * 0.35) * beltFactor;
  const height = cellM * (0.85 + rng() * 0.35) * (2 - beltFactor);
  const x0 = dx - width / 2; const x1 = dx + width / 2;
  const y0 = dy - height / 2; const y1 = dy + height / 2;
  const p0 = metersToLonLat(centerLon, centerLat, x0, y0);
  const p1 = metersToLonLat(centerLon, centerLat, x1, y0);
  const p2 = metersToLonLat(centerLon, centerLat, x1, y1);
  const p3 = metersToLonLat(centerLon, centerLat, x0, y1);
  const ring = [p0, p1, p2, p3, p0];

  const neighborhood = neighborhoodForOffset(dx, dy);
  const model_group = chooseGroupByNeighborhood(rng, neighborhood);
  const bldg_type = randPick(rng, BLDG_TYPE_BY_GROUP[model_group]);
  const zoning = randPick(rng, ZONING_BY_GROUP[model_group]);
  const land_type = randPick(rng, LAND_TYPE_BY_GROUP[model_group]);

  const land_area_sqft = Math.max(1000, Math.round((width * height) * 10.7639));
  const stories = model_group === 'commercial' ? (rng() < 0.35 ? 2 : 1) : model_group === 'multi_family' ? (rng() < 0.5 ? 2 : 3) : 1;
  const footprint = model_group === 'agricultural' ? 0 : Math.round(land_area_sqft * (0.15 + rng() * 0.4));
  const finished = Math.round(footprint * Math.max(1, stories) * (0.88 + rng() * 0.18));
  const units = model_group === 'multi_family' ? (bldg_type === 'MF_DUPLEX' ? 2 : bldg_type === 'MF_TRIPLEX' ? 3 : 8 + Math.floor(rng() * 24)) : 0;
  const beds = model_group === 'single_family' ? Math.max(1, Math.round(finished / 700)) : model_group === 'multi_family' ? Math.max(0, Math.round(units * 1.6)) : 0;
  const baths = model_group === 'single_family' ? Math.max(1, Math.round(beds * 0.75)) : model_group === 'multi_family' ? Math.max(0, Math.round(units * 1.2)) : 0;
  const yearBuilt = 1940 + Math.floor(rng() * 80);

  return {
    key,
    geometry: { type: 'Polygon', coordinates: [ring] },
    longitude: (p0[0] + p2[0]) / 2,
    latitude: (p0[1] + p2[1]) / 2,
    neighborhood,
    model_group,
    zoning,
    land_type,
    land_area_sqft,
    bldg_type,
    bldg_area_footprint_sqft: footprint,
    bldg_area_finished_sqft: finished,
    bldg_stories: footprint > 0 ? stories : 0,
    bldg_units: footprint > 0 ? units : 0,
    bldg_rooms_bed: footprint > 0 ? beds : 0,
    bldg_rooms_bath: footprint > 0 ? baths : 0,
    bldg_quality_num: footprint > 0 ? 2 + Math.floor(rng() * 4) : 0,
    bldg_condition_num: footprint > 0 ? 45 + Math.floor(rng() * 45) : 0,
    bldg_year_built: footprint > 0 ? yearBuilt : null,
    bldg_year_renovated: null
  };
}

function calcValues(parcel) {
  const landBase = parcel.land_area_sqft * (parcel.neighborhood === 'CBD' ? 42 : parcel.neighborhood === 'inner ring' ? 21 : 9);
  const imprBase = parcel.bldg_area_finished_sqft * (parcel.model_group === 'commercial' ? 180 : parcel.model_group === 'industrial' ? 115 : 140);
  const qualityAdj = 1 + (parcel.bldg_quality_num || 0) * 0.07;
  const conditionAdj = 0.2 + (parcel.bldg_condition_num || 0) / 125;
  const platonic_land_value = Math.round(landBase);
  const platonic_impr_value = Math.round(imprBase * qualityAdj * conditionAdj);
  return { platonic_land_value, platonic_impr_value, platonic_market_value: platonic_land_value + platonic_impr_value };
}

function invalidateSalePrice(rng, nominalPriceList, platonic) {
  if (rng() < 0.5) return randPick(rng, nominalPriceList);
  const rounded = Math.round((rng() * 999) / 5) * 5;
  return Math.max(1, rounded);
}

function makeGeoFeature(row, includeGeometry = true) {
  const props = { ...row };
  delete props.geometry;
  return {
    type: 'Feature',
    geometry: includeGeometry ? row.geometry : null,
    properties: props
  };
}

function generateSimulation(config) {
  const rng = makeSeededRng(config.seed);
  const parcelCount = config.parcelCount;
  const n = Math.ceil(Math.sqrt(parcelCount));
  const cellM = 70;
  const universe = [];

  progress('Generating parcel fabric...');
  for (let idx = 0; idx < parcelCount; idx++) {
    const i = idx % n;
    const j = Math.floor(idx / n);
    const key = String(idx + 1).padStart(5, '0');
    const parcel = buildParcelRecord({ key, centerLon: config.centerLon, centerLat: config.centerLat, i, j, n, cellM, rng });
    universe.push(parcel);
  }
  send('milestone', { featureCollection: { type: 'FeatureCollection', features: universe.slice(0, 4500).map((r) => makeGeoFeature(r)) } });

  progress('Building inflation series...');
  const inflation = buildInflationSeries(config.startYear, config.endYear);

  progress('Simulating yearly events and sales...');
  const salesPlatonic = [];
  const salesObserved = [];

  for (let year = config.startYear; year <= config.endYear; year++) {
    for (const p of universe) {
      if (p.bldg_area_finished_sqft > 0) {
        p.bldg_condition_num = clamp(p.bldg_condition_num - (0.5 + rng() * 1.4), 0, 100);
      }
      if (p.bldg_area_finished_sqft > 0 && rng() < 0.008) {
        p.bldg_area_finished_sqft = 0; p.bldg_area_footprint_sqft = 0; p.bldg_quality_num = 0; p.bldg_condition_num = 0;
        p.bldg_type = 'NONE'; p.bldg_stories = 0; p.bldg_units = 0; p.bldg_rooms_bed = 0; p.bldg_rooms_bath = 0; p.bldg_year_built = null; p.bldg_year_renovated = null;
      } else if (p.bldg_area_finished_sqft === 0 && rng() < 0.015) {
        p.bldg_type = randPick(rng, BLDG_TYPE_BY_GROUP[p.model_group]);
        p.bldg_stories = p.model_group === 'multi_family' ? 2 : 1;
        p.bldg_area_footprint_sqft = Math.max(450, Math.round(p.land_area_sqft * (0.12 + rng() * 0.25)));
        p.bldg_area_finished_sqft = Math.round(p.bldg_area_footprint_sqft * p.bldg_stories * (0.9 + rng() * 0.2));
        p.bldg_quality_num = 2 + Math.floor(rng() * 3);
        p.bldg_condition_num = 65 + Math.floor(rng() * 30);
        p.bldg_year_built = year;
      } else if (p.bldg_area_finished_sqft > 0 && rng() < 0.02) {
        p.bldg_condition_num = clamp(p.bldg_condition_num + 8 + rng() * 20, 0, 100);
        p.bldg_year_renovated = year;
      }

      const saleProb = config.saleProbabilities[p.model_group] ?? 0.05;
      if (rng() > saleProb) continue;
      const month = Math.floor(rng() * 12);
      const day = 1 + Math.floor(rng() * 28);
      const saleDate = toDateStringUTC(new Date(Date.UTC(year, month, day)));
      const infl = inflation.byDate.get(saleDate) || inflation.rows[inflation.rows.length - 1];
      const values = calcValues(p);
      const trendAdj = infl.start_indexed;
      const platonicSale = Math.max(1, Math.round(values.platonic_market_value * trendAdj));
      const noise = Math.round((rng() - 0.5) * 0.06 * platonicSale);
      const truePrice = Math.max(1, platonicSale + noise);

      const key_sale = `${p.key}---${saleDate}`;
      const platonicRow = {
        ...p,
        key_sale,
        sale_date: saleDate,
        sale_type: 'VALID',
        valid_sale: true,
        sale_noise: noise,
        sale_price: truePrice,
        vacant_sale: p.bldg_area_finished_sqft === 0,
        inflation_index: infl.start_indexed,
        ...values
      };

      const observedRow = { ...platonicRow };
      if (rng() < config.invalidPct / 100) {
        observedRow.sale_type = 'NOT_ARMS_LENGTH';
        observedRow.sale_price = invalidateSalePrice(rng, config.nominalPriceList, truePrice);
        observedRow.valid_sale = true;
        platonicRow.sale_type = 'NOT_ARMS_LENGTH';
        platonicRow.valid_sale = false;
      }

      salesPlatonic.push(platonicRow);
      salesObserved.push(observedRow);
    }

    if ((year - config.startYear) % config.repaintYears === 0 || year === config.endYear) {
      send('milestone', { featureCollection: { type: 'FeatureCollection', features: universe.slice(0, 4500).map((r) => makeGeoFeature(r)) } });
      log(`Milestone repaint: year ${year}.`);
    }
  }

  const preview = { type: 'FeatureCollection', features: universe.slice(0, 4500).map((r) => makeGeoFeature(r)) };
  return {
    config,
    crs: 'EPSG:4326',
    universeCount: universe.length,
    salesCount: salesObserved.length,
    preview,
    universe,
    sales: salesObserved,
    sales_platonic: salesPlatonic,
    inflation: inflation.rows
  };
}

function inferType(v) {
  if (v == null) return 'string';
  if (typeof v === 'boolean') return 'bool';
  if (typeof v === 'number') return Number.isInteger(v) ? 'int' : 'float';
  return 'string';
}

function arrowType(Arrow, kind) {
  if (kind === 'bool') return new Arrow.Bool();
  if (kind === 'int') return new Arrow.Int32();
  if (kind === 'float') return new Arrow.Float64();
  return new Arrow.Utf8();
}

function rowToFields(rows) {
  const keys = new Set();
  rows.forEach((r) => Object.keys(r).forEach((k) => { if (k !== 'geometry') keys.add(k); }));
  return Array.from(keys).map((name) => {
    const sample = rows.find((r) => r[name] != null)?.[name] ?? null;
    return { name, kind: inferType(sample) };
  });
}

async function toGeoParquetBytes(rows) {
  const Arrow = await import('../../vendor/apache-arrow.js');
  const fields = rowToFields(rows);
  const spatialRef = { wkid: 4326, latestWkid: 4326, wkt: null };
  const geoMetadata = await createGeoMetadata(spatialRef, 'Polygon');
  const schema = new Arrow.Schema([
    new Arrow.Field('geometry', new Arrow.Binary(), true),
    ...fields.map((f) => new Arrow.Field(f.name, arrowType(Arrow, f.kind), true))
  ], new Map([['geo', JSON.stringify(geoMetadata)]]));

  const geomBuilder = Arrow.makeBuilder({ type: new Arrow.Binary(), nullValues: [null, undefined] });
  const fieldBuilders = new Map(fields.map((f) => [f.name, Arrow.makeBuilder({ type: arrowType(Arrow, f.kind), nullValues: [null, undefined] })]));

  for (const row of rows) {
    const ring = row.geometry.coordinates[0];
    geomBuilder.append(polygonWkb(ring));
    for (const f of fields) {
      const v = row[f.name] == null ? null : row[f.name];
      fieldBuilders.get(f.name).append(v);
    }
  }

  geomBuilder.finish();
  const geomVector = geomBuilder.toVector();
  const vectors = [geomVector];
  for (const f of fields) {
    const b = fieldBuilders.get(f.name);
    b.finish();
    vectors.push(b.toVector());
  }

  const table = makeArrowTable(Arrow, schema, vectors);
  const ipc = tableToIPC(Arrow, table, 'stream');
  const wasmTable = parquetModule.Table.fromIPCStream(ipc);
  const writerProps = new parquetModule.WriterPropertiesBuilder()
    .setCompression(parquetModule.Compression.ZSTD)
    .setKeyValueMetadata(new Map([['geo', JSON.stringify(geoMetadata)]]))
    .build();
  const bytes = parquetModule.writeParquet(wasmTable, writerProps);
  return bytes;
}

async function buildExportZip(payload) {
  await ensureParquetReady();
  progress('Encoding universe.geoparquet...');
  const universeBytes = await toGeoParquetBytes(payload.universe);
  progress('Encoding sales.geoparquet...');
  const salesBytes = await toGeoParquetBytes(payload.sales);
  progress('Encoding sales_platonic.geoparquet...');
  const platBytes = await toGeoParquetBytes(payload.sales_platonic);
  progress('Encoding inflation.csv...');

  const csvHeader = 'period,start_indexed,end_indexed,correction_factor';
  const csvBody = payload.inflation.map((r) => `${r.period},${r.start_indexed},${r.end_indexed},${r.correction_factor}`).join('\n');
  const inflationBytes = textEncoder.encode(`${csvHeader}\n${csvBody}`);

  const metadata = {
    seed: payload.config.seed,
    app_version: 'mvp-0.1',
    crs: 'EPSG:4326',
    center: { city_name: payload.config.cityName, latitude: payload.config.centerLat, longitude: payload.config.centerLon },
    start_year: payload.config.startYear,
    end_year: payload.config.endYear,
    parcel_count: payload.config.parcelCount,
    repaint_interval_years: payload.config.repaintYears,
    invalid_pct: payload.config.invalidPct,
    sale_probabilities: payload.config.saleProbabilities,
    nominal_price_list: payload.config.nominalPriceList
  };
  const metaBytes = textEncoder.encode(JSON.stringify(metadata, null, 2));

  const zipBlob = buildZipBlob([
    { name: 'universe.geoparquet', data: universeBytes },
    { name: 'sales.geoparquet', data: salesBytes },
    { name: 'sales_platonic.geoparquet', data: platBytes },
    { name: 'inflation.csv', data: inflationBytes },
    { name: 'metadata.json', data: metaBytes }
  ]);

  return zipBlob;
}

self.onmessage = async (event) => {
  const { mode, config, payload } = event.data || {};
  try {
    if (mode === 'generate') {
      const result = generateSimulation(config);
      send('success', result);
      return;
    }
    if (mode === 'export') {
      const zipBlob = await buildExportZip(payload);
      send('zip', { zipBlob, filename: `synthetic_city_${new Date().toISOString().slice(0, 10)}.zip` });
    }
  } catch (err) {
    send('error', { message: err?.message || String(err) });
  }
};
