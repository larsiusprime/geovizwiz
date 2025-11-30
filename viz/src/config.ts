import { API_BASE as ENV_API_BASE } from './env';

// API and tiles via env (Vite)
export const API_BASE = ENV_API_BASE;
export const TILE_URL = (import.meta as any).env?.VITE_TILE_API_URL || 'http://localhost:8000/tiles/{z}/{x}/{y}.pbf';

// Base map styles
export const OSM_STYLE: any = {
  version: 8,
  sources: { 'osm-tiles': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }]
};

// OpenFreeMap tiles; may fail if CORS headers are missing
export const OPENFREEMAP_STYLE: any = {
  version: 8,
  sources: {
    'ofm-tiles': {
      type: 'raster',
      tiles: ['https://tile.openfreemap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenFreeMap, © OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'ofm-tiles', type: 'raster', source: 'ofm-tiles', minzoom: 0, maxzoom: 19 }]
};

const TOPO_STYLE: any = {
  version: 8,
  sources: { 'topo-tiles': { type: 'raster', tiles: ['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors, SRTM | Map style © OpenTopoMap (CC-BY-SA)' } },
  layers: [{ id: 'topo-tiles', type: 'raster', source: 'topo-tiles', minzoom: 0, maxzoom: 17 }]
};

// Simple, offline-safe background style
const SIMPLE_STYLE: any = {
  version: 8,
  sources: {},
  layers: [
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#e8eaed' }
    }
  ]
};

export const BASEMAP_STYLES: Record<string, any> = {
  'Simple Gray': SIMPLE_STYLE,
  'OpenStreetMap': OSM_STYLE,
  'OpenFreeMap': OPENFREEMAP_STYLE,
  'Topographic': TOPO_STYLE
};

// Source / layer IDs
export const SOURCE_ID = 'gp-source';
export const LAYER_ID = 'gp-extrusions';
export const ERROR_LAYER_ID = 'gp-error';

// Autoscale caps
export const HEIGHT_CAP_METERS = 1000;
// Per-map default caps (meters). Allows independent tuning per map.
export const HEIGHT_CAPS = {
  main: 1000,
  under: 1000,
  ratio: 1000
} as const;
export const HEIGHT_PCTL = 99;

// Color ramps (unchanged)
export const COLOR_RAMPS: Record<string, string[]> = {
  Viridis: ['#440154','#46327E','#365C8D','#277F8E','#1FA187','#4AC16D','#A0DA39','#FDE725'],
  Magma:   ['#000004','#1B0C41','#4F0A6D','#7A1E6C','#A52C60','#CF4446','#ED6925','#FB9F06','#F7D13D','#FCFDBF'],
  Plasma:  ['#0D0887','#5B02A3','#9A179B','#CB4679','#ED7953','#FB9F3A','#F0F921'],
  Turbo:   ['#30123B','#4145AB','#2CC0F0','#6AE4B4','#C6F86D','#F9DD32','#F28C21','#CB3E1F','#8A0D2C'],
  YlOrRd:  ['#FFFFB2','#FECC5C','#FD8D3C','#F03B20','#BD0026'],
  Blues:   ['#DEEBF7','#9ECAE1','#6BAED6','#3182BD','#08519C'],
  Reds:    ['#FEE5D9','#FCBBA1','#FB6A4A','#DE2D26','#A50F15']
};

// Unit conversion (unchanged)
export const UNIT_TO_METERS = {
  centimeters: 0.01,
  meters: 1,
  inches: 0.0254,
  feet: 0.3048,
  kilometers: 1000,
  miles: 1609.344,
  stories: 3.3
};

// Data field used for vacancy filtering
export const UNDERUTILIZED_DEFAULTS = ['Vacant', 'Parking Lot', 'Underdeveloped'];

// City selection via query string (?city=southbend|syracuse|spokane|rochester|bellingham). Defaults to southbend.
function getCityFromUrl(): 'southbend' | 'syracuse' | 'spokane' | 'rochester' | 'bellingham' {
  try {
    const u = new URL(window.location.href);
    const c = (u.searchParams.get('city') || '').toLowerCase();
    if (c === 'syracuse') return 'syracuse';
    if (c === 'spokane') return 'spokane';
    if (c === 'rochester') return 'rochester';
    if (c === 'bellingham') return 'bellingham';
    return 'southbend';
  } catch {
    return 'southbend';
  }
}

export const SELECTED_CITY = getCityFromUrl();

// City-specific fields
export const DEV_CATEGORY_FIELD = (
  SELECTED_CITY === 'syracuse' ||
  SELECTED_CITY === 'spokane' ||
  SELECTED_CITY === 'rochester' ||
  SELECTED_CITY === 'bellingham'
)
  ? 'property_land_use_refined'
  : 'property_category_refined';

export const ORIG_CATEGORY_FIELD = (
  SELECTED_CITY === 'syracuse' ||
  SELECTED_CITY === 'spokane' ||
  SELECTED_CITY === 'rochester' ||
  SELECTED_CITY === 'bellingham'
)
  ? 'property_land_use_category'
  : 'PROPERTY_CATEGORY';

// Default dataset locations per city
const CITY_DATASETS = {
  southbend: {
    remote: 'https://landeconomics.blob.core.windows.net/public-sharing-cle/southbend.parquet',
    local: 'southbend.parquet',
    proxy: '/data/southbend.parquet',  // Dev only (Vite proxy)
    filename: 'southbend.parquet'
  },
  syracuse: {
    remote: 'https://landeconomics.blob.core.windows.net/public-sharing-cle/syracuse_parcels_refined_20251001.parquet',
    local: 'syracuse.parquet',
    proxy: '/data/syracuse.parquet',  // Dev only (Vite proxy)
    filename: 'syracuse_parcels_refined_20251001.parquet'
  },
  spokane: {
    remote: 'https://landeconomics.blob.core.windows.net/public-sharing-cle/spokane.parquet',
    local: 'spokane.parquet',
    proxy: '/data/spokane.parquet',  // Dev only (Vite proxy)
    filename: 'spokane.parquet'
  },
  rochester: {
    remote: 'https://landeconomics.blob.core.windows.net/public-sharing-cle/rochester.parquet',
    local: 'rochester.parquet',
    proxy: '/data/rochester.parquet',  // Dev only (Vite proxy)
    filename: 'rochester.parquet'
  },
  bellingham: {
    remote: 'https://landeconomics.blob.core.windows.net/public-sharing-cle/bellingham.parquet',
    local: 'bellingham.parquet',
    proxy: '/data/bellingham.parquet',  // Dev only (Vite proxy)
    filename: 'bellingham.parquet'
  }
} as const;

export const REMOTE_DATASET_URL = CITY_DATASETS[SELECTED_CITY].remote;
export const LOCAL_DATASET_URL = CITY_DATASETS[SELECTED_CITY].local;
export const PROXY_DATASET_URL = CITY_DATASETS[SELECTED_CITY].proxy;

// Construct API proxy URL dynamically
export const API_PROXY_DATASET_URL = `${API_BASE}/data/${CITY_DATASETS[SELECTED_CITY].filename}`;

// Use proxy in production to avoid CORS issues, direct remote in dev (if Vite proxy not available)
// Detect production by checking if we're on a deployed domain (not localhost)
const isProduction = typeof window !== 'undefined' && 
  !window.location.hostname.includes('localhost') && 
  !window.location.hostname.includes('127.0.0.1');

// Always prefer explicit env override; otherwise use proxy in production, remote in dev
export const DEFAULT_DATASET_URL = (import.meta as any).env?.VITE_DEFAULT_DATASET_URL || 
  (isProduction ? API_PROXY_DATASET_URL : REMOTE_DATASET_URL);
