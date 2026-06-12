/**
 * Message contract between the main thread (client) and the H3 aggregation worker.
 *
 * Geometry is sent ONCE per dataset (`init`); each `job` then carries only the
 * per-parcel numerator/denominator (small transferable typed arrays) plus the
 * resolution, so dragging the resolution slider doesn't re-serialize all the
 * polygons. Coverage (the expensive `polygonToCells` pass) is cached in the
 * worker by resolution, so changing only the field/normalization is near-instant.
 */

// --- main thread → worker ---

export interface HexInitMsg {
  type: 'init';
  geoms: (GeoJSON.Geometry | null)[]; // one per parcel feature, geometry only
}

export interface HexJobMsg {
  type: 'job';
  jobId: number;
  resolution: number;
  ratio: boolean;        // true → metric = Σnum/Σden; false → metric = Σnum
  num: Float64Array;     // numerator per parcel (NaN → skip)
  den: Float64Array;     // denominator per parcel (≤0/NaN → skip when ratio)
}

export interface HexCancelMsg {
  type: 'cancel';
}

export type HexInMsg = HexInitMsg | HexJobMsg | HexCancelMsg;

// --- worker → main thread ---

export interface HexProgressMsg {
  type: 'progress';
  jobId: number;
  processed: number;
  total: number;
}

export interface HexResultMsg {
  type: 'result';
  jobId: number;
  fc: GeoJSON.FeatureCollection;
}

export type HexOutMsg = HexProgressMsg | HexResultMsg;
