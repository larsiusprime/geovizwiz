export function arcgisGeometryToGeoJSON(geom, geomType) {
  if (!geom) return null;
  const t = (geomType || '').toLowerCase();

  if (t === 'esrigeometrypoint') {
    return { type: 'Point', coordinates: [geom.x, geom.y] };
  }
  if (t === 'esrigeometrymultipoint') {
    return { type: 'MultiPoint', coordinates: geom.points || [] };
  }
  if (t === 'esrigeometrypolyline') {
    // GeoJSON MultiLineString expects array-of-lines (paths already are)
    return { type: 'MultiLineString', coordinates: geom.paths || [] };
  }
  if (t === 'esrigeometrypolygon') {
    return { type: 'Polygon', coordinates: geom.rings || [] };
  }
  return null;
}


export function arcgisPolygonToGeoJSON(g) {
  if (!g || !Array.isArray(g.rings) || !g.rings.length) return null;
  const rings = g.rings.map(ring => {
    if (!ring || ring.length < 4) return null;

    // Ensure ring is closed: first == last (recommended for WKB readers)
    const first = ring[0], last = ring[ring.length - 1];
    const closed = (first[0] === last[0] && first[1] === last[1])
      ? ring
      : ring.concat([[first[0], first[1]]]);

    return closed.map(([x, y]) => [x, y]);
  }).filter(Boolean);

  if (!rings.length) return null;
  return { type: "Polygon", coordinates: rings };
}