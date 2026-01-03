export function arrowTypeFromEsriField(Arrow, field) {
  switch (field.type) {
    case "esriFieldTypeString":
    case "esriFieldTypeGlobalID":
      return new Arrow.Utf8();
    case "esriFieldTypeGUID":
      return new Arrow.Utf8();

    case "esriFieldTypeInteger":
    case "esriFieldTypeSmallInteger":
    case "esriFieldTypeOID":
      return new Arrow.Int32();

    case "esriFieldTypeBigInteger":
      return new Arrow.Int64();

    case "esriFieldTypeDouble":
      return new Arrow.Float64();

    case "esriFieldTypeSingle":
      return new Arrow.Float32();

    case "esriFieldTypeDate":
      // ArcGIS dates are milliseconds since epoch
      return new Arrow.Timestamp("ms");

    default:
      console.warn("Unknown ESRI field type:", field.type, "→ Utf8");
      return new Arrow.Utf8();
  }
}

export function makeArrowTable(Arrow, schema, vectors) {
  // RecordBatch wants: { [name]: Data }
  const cols = {};
  for (let i = 0; i < schema.fields.length; i++) {
    const name = schema.fields[i].name;
    const v = vectors[i];

    // In Arrow JS, a Vector may hold one or more Data chunks.
    // Your builders produce a single chunk, but handle both cases safely.
    const data = v && v.data;
    cols[name] = Array.isArray(data) ? data[0] : data;

    if (!cols[name] || typeof cols[name].length !== "number") {
      throw new Error(`Vector->Data conversion failed for column "${name}".`);
    }
  }

  // Create a RecordBatch from Data objects (this Arrow build supports this form)
  const batch = new Arrow.RecordBatch(cols);

  // Now wrap it in a Table using your schema (so metadata like "geo" is preserved)
  return new Arrow.Table(schema, [batch]);
}


export function tableToIPC(Arrow, table, format = "stream") {
  return Arrow.tableToIPC(table, format);
}
