import { createGeoMetadata } from "../geo/geoparquetMeta.js";
import { arrowTypeFromEsriField, makeArrowTable, tableToIPC } from "./arrowSchema.js";

export async function createGeoParquetBlob(
  { Arrow, WriterPropertiesBuilder, Compression, writeParquet, WasmTable },
  features,
  spatialRef,
  geometryType,
  layerFields
) {
  const fieldDefs = (layerFields || []).filter(
    (f) => f && f.name && f.name !== "geometry"
  );

  const geoMetaObj = await createGeoMetadata(spatialRef, geometryType);

  const fieldInfo = fieldDefs.map((f) => {
    const type = arrowTypeFromEsriField(Arrow, f);
    return {
      name: f.name,
      type,
      builder: Arrow.makeBuilder({ type, nullValues: [null, undefined] }),
    };
  });

  // Arrow schema metadata (optional)
  const arrowMeta = new Map([["geo", JSON.stringify(geoMetaObj)]]);
  const schemaFields = [
    new Arrow.Field("geometry", new Arrow.Binary(), true),
    ...fieldInfo.map(({ name, type }) => new Arrow.Field(name, type, true)),
  ];
  const schema = new Arrow.Schema(schemaFields, arrowMeta);

  const rowCount = features.length;

  if (typeof Arrow.makeBuilder !== "function") {
    throw new Error(
      "Arrow bundle missing makeBuilder(). Please use a newer Arrow JS bundle."
    );
  }

  const geomBuilder = Arrow.makeBuilder({
    type: new Arrow.Binary(),
    nullValues: [null, undefined],
  });

  const norm = (v) => (v === undefined ? null : v);

  const normalizeInt64Like = (v) => {
    if (v == null) return null;
  
    // already bigint
    if (typeof v === "bigint") return v;
  
    // ArcGIS sometimes gives big integers as strings
    if (typeof v === "string" && v.trim() !== "") {
      try { return BigInt(v); } catch { return null; }
    }
  
    // numbers: must be integer-ish
    if (typeof v === "number") {
      if (!Number.isFinite(v)) return null;
      // optional: guard if you care about safety/precision
      // if (!Number.isSafeInteger(v)) throw new Error(`Int64 not safe: ${v}`);
      return BigInt(Math.trunc(v));
    }
  
    return null;
  };
  
  const normalizeDateLike = (v) => {
    if (v == null) return null;
    if (typeof v === "number") return v;
    if (v instanceof Date) return v.getTime();
    if (typeof v === "string") {
      const t = Date.parse(v);
      return Number.isFinite(t) ? t : null;
    }
    return null;
  };

  for (let i = 0; i < rowCount; i++) {
    const feat = features[i];
    const g = feat?.geometry ?? null;
    geomBuilder.append(g && g.length ? g : null);
  
    const attrs = feat?.attributes || {};
    for (const { name, type, builder } of fieldInfo) {
      let v = attrs[name];
      if (v === undefined) v = null;
  
      if (type.typeId === Arrow.Type.Timestamp) v = normalizeDateLike(v);
      else if ((type.typeId === Arrow.Type.Int || type.typeId === Arrow.Type.Uint) && type.bitWidth === 64) {
        v = normalizeInt64Like(v);
      }
  
      builder.append(v);
    }
  }

  geomBuilder.finish();
  const geomVector = geomBuilder.toVector();
  
  const vectors = [
    geomVector,
    ...fieldInfo.map(({ builder }) => {
      builder.finish();
      return builder.toVector();
    })
  ];

  const tableWithMeta = makeArrowTable(Arrow, schema, vectors);
  const ipc = tableToIPC(Arrow, tableWithMeta, "stream");

  const wasmTable = WasmTable.fromIPCStream(ipc);

  // Parquet-level metadata (what GDAL/QGIS reads)
  const geoJson = JSON.stringify(geoMetaObj);
  const parquetMeta = new Map([["geo", geoJson]]);

  const writerProps = new WriterPropertiesBuilder()
    .setCompression(Compression.ZSTD)
    .setKeyValueMetadata(parquetMeta)
    .build();

  const parquetBytes = writeParquet(wasmTable, writerProps);
  return new Blob([parquetBytes], { type: "application/vnd.apache.parquet" });
}
