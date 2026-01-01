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

  // Arrow schema metadata (optional)
  const arrowMeta = new Map([["geo", JSON.stringify(geoMetaObj)]]);
  const schemaFields = [
    new Arrow.Field("geometry", new Arrow.Binary(), true),
    ...fieldDefs.map(
      (f) => new Arrow.Field(f.name, arrowTypeFromEsriField(Arrow, f), true)
    ),
  ];
  const schema = new Arrow.Schema(schemaFields, arrowMeta);

  const rowCount = features.length;

  if (typeof Arrow.makeBuilder !== "function") {
    throw new Error(
      "Arrow bundle missing makeBuilder(). Please use a newer Arrow JS bundle."
    );
  }

  const geomBuilder = Arrow.makeBuilder({ type: new Arrow.Binary() });

  const fieldBuilders = new Map();
  for (const f of fieldDefs) {
    fieldBuilders.set(
      f.name,
      Arrow.makeBuilder({ type: arrowTypeFromEsriField(Arrow, f) })
    );
  }

  const norm = (v) => (v === undefined ? null : v);

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
    if (g != null && !(g instanceof Uint8Array)) {
      throw new Error(`Geometry is not Uint8Array/WKB at row ${i}.`);
    }
    geomBuilder.append(g && g.length ? g : null);

    const attrs = feat?.attributes || {};
    for (const f of fieldDefs) {
      const b = fieldBuilders.get(f.name);
      let v = norm(attrs[f.name]);

      const t = arrowTypeFromEsriField(Arrow, f);
      if (t && t.typeId === Arrow.Type.Timestamp) v = normalizeDateLike(v);

      b.append(v);
    }
  }

  geomBuilder.finish();
  const geomVector = geomBuilder.toVector();

  const vectors = schema.fields.map((field) => {
    if (field.name === "geometry") return geomVector;
    const b = fieldBuilders.get(field.name);
    b.finish();
    return b.toVector();
  });

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
