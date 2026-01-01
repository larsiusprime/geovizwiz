(function(global) {
  function writeWkb(geojson) {
    if (!geojson) return null; // IMPORTANT: null means "no geometry"; empty bytes are invalid WKB
    const writer = [];
    const pushUInt8 = (v) => writer.push(v & 0xff);
    const pushUInt32 = (v) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, v, true); writer.push(...b); };
    const pushFloat64 = (v) => { const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); writer.push(...b); };

    const pushByteOrder = () => pushUInt8(1);
    const pushType = (id) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, id, true); writer.push(...b); };
    const writePoint = (pt) => { pushFloat64(pt[0]); pushFloat64(pt[1]); };

    function writeGeometry(geom) {
      const type = geom.type;
      if (type === 'Point') {
        pushByteOrder(); pushType(1); writePoint(geom.coordinates);
      } else if (type === 'MultiPoint') {
        pushByteOrder(); pushType(4); pushUInt32(geom.coordinates.length); geom.coordinates.forEach(pt => { pushByteOrder(); pushType(1); writePoint(pt); });
      } else if (type === 'LineString') {
        pushByteOrder(); pushType(2); pushUInt32(geom.coordinates.length); geom.coordinates.forEach(writePoint);
      } else if (type === 'MultiLineString') {
        pushByteOrder(); pushType(5); pushUInt32(geom.coordinates.length); geom.coordinates.forEach(line => { pushByteOrder(); pushType(2); pushUInt32(line.length); line.forEach(writePoint); });
      } else if (type === 'Polygon') {
        pushByteOrder(); pushType(3); pushUInt32(geom.coordinates.length); geom.coordinates.forEach(ring => { pushUInt32(ring.length); ring.forEach(writePoint); });
      } else if (type === 'MultiPolygon') {
        pushByteOrder(); pushType(6); pushUInt32(geom.coordinates.length); geom.coordinates.forEach(poly => { pushByteOrder(); pushType(3); pushUInt32(poly.length); poly.forEach(ring => { pushUInt32(ring.length); ring.forEach(writePoint); }); });
      } else {
        throw new Error("Unsupported GeoJSON geometry type for WKB: " + type);
      }
    }

    writeGeometry(geojson);
    return new Uint8Array(writer);
  }

  class Geometry {
    static parseGeoJSON(geojson) {
      return new ParsedGeometry(geojson);
    }
  }

  class ParsedGeometry {
    constructor(geojson) { this.geojson = geojson; }
    toWkb() { return writeWkb(this.geojson); }
  }

  global.wkx = { Geometry };
})(typeof window !== 'undefined' ? window : globalThis);
