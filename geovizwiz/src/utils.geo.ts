export function roundGeometryInPlace(f: GeoJSON.Feature, decimals = 6) {
  const factor = Math.pow(10, decimals);
  const round = (n: number) => Math.round(n * factor) / factor;
  const walk = (coords: any) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') { coords[0] = round(coords[0]); coords[1] = round(coords[1]); }
    else for (const c of coords) walk(c);
  };
  if (f.geometry) walk((f.geometry as any).coordinates);
}

export function trimPropertiesInPlace(features: GeoJSON.Feature[], keep: Set<string>) {
  for (const feat of features) {
    const p = (feat.properties ||= {});
    for (const k of Object.keys(p as any)) { if (!keep.has(k)) delete (p as any)[k]; }
  }
}

export function bbox(fc: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => { if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y; };
  const walk = (coords: any) => Array.isArray(coords[0]) ? coords.forEach(walk) : add(coords[0], coords[1]);
  for (const f of fc.features) {
    if (!f.geometry) continue;
    const g = f.geometry;
    if (g.type === 'Polygon' || g.type === 'MultiPolygon' || g.type === 'LineString' || g.type === 'MultiLineString') walk(g.coordinates);
    if (g.type === 'Point') add(g.coordinates[0], g.coordinates[1]);
    if (g.type === 'MultiPoint') (g.coordinates as any[]).forEach((c: number[]) => add(c[0], c[1]));
  }
  return (Number.isFinite(minX) && Number.isFinite(minY) && Number.isFinite(maxX) && Number.isFinite(maxY)) ? [minX, minY, maxX, maxY] : null;
}
