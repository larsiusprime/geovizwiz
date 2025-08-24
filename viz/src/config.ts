import { Expression } from 'maplibre-gl';

// Map style (unchanged)
export const OSM_STYLE: any = {
  version: 8,
  sources: { 'osm-tiles': { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm-tiles', minzoom: 0, maxzoom: 19 }]
};

// Source / layer IDs
export const SOURCE_ID = 'gp-source';
export const LAYER_ID = 'gp-extrusions';
export const ERROR_LAYER_ID = 'gp-error';

// Autoscale caps
export const HEIGHT_CAP_METERS = 1000;
export const HEIGHT_PCTL = 99;

// Color ramps (unchanged)
export const COLOR_RAMPS: Record<string, string[]> = {
  Viridis: ['#440154','#46327E','#365C8D','#277F8E','#1FA187','#4AC16D','#A0DA39','#FDE725'],
  Magma:   ['#000004','#1B0C41','#4F0A6D','#7A1E6C','#A52C60','#CF4446','#ED6925','#FB9F06','#F7D13D','#FCFDBF'],
  Plasma:  ['#0D0887','#5B02A3','#9A179B','#CB4679','#ED7953','#FB9F3A','#F0F921'],
  Turbo:   ['#30123B','#4145AB','#2CC0F0','#6AE4B4','#C6F86D','#F9DD32','#F28C21','#CB3E1F','#8A0D2C'],
  YlOrRd:  ['#FFFFB2','#FECC5C','#FD8D3C','#F03B20','#BD0026'],
  Blues:   ['#DEEBF7','#9ECAE1','#6BAED6','#3182BD','#08519C']
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
export const DEV_STATUS_FIELD = 'status';