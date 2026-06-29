import re

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

get_avail_old = """function getAvailableFieldsForDataStore(dataStore: DataStore | null) {
  if (!dataStore) return { numeric: [] as string[], categorical: [] as string[] };
  if (dataStore.isCivil) {
    const numeric = [
      dataStore.landSizeField,
      dataStore.bldgSizeField,
      dataStore.bldgBedsField,
      dataStore.bldgBathsField,
      dataStore.bldgAgeField,
      dataStore.bldgEffAgeField,
    ].filter(Boolean) as string[];

    const categorical = [
      dataStore.bldgConditionField,
      dataStore.bldgTypeField,
      dataStore.landTypeField,
      dataStore.landZoningField,
    ].filter(Boolean) as string[];

    return { numeric, categorical };
  }"""

get_avail_new = """function getAvailableFieldsForDataStore(dataStore: DataStore | null) {
  if (!dataStore) return { numeric: [] as string[], categorical: [] as string[] };
  if (dataStore.isCivil) {
    const numeric = [
      "land_area_sq_ft",
      "frontage_ft",
      "depth_ft",
      "improvement_area_sq_ft",
      "improvement_year_built",
      "improvement_effective_year_built",
      "bedrooms",
      "bathrooms",
      "units"
    ];

    const categorical = [
      "land_use_id",
      "zoning_ids",
      "condition_id",
      "improvement_type_id"
    ];

    return { numeric, categorical };
  }"""

content = content.replace(get_avail_old, get_avail_new)

get_parcel_attr_old = """function getParcelAttributeForField(store: DataStore, field: string): ParcelAttribute | null {
  if (field === store.landSizeField) return ParcelAttribute.LAND_AREA_SQ_FT;
  if (field === store.bldgSizeField) return ParcelAttribute.IMPROVEMENT_AREA_SQ_FT;
  if (field === store.bldgAgeField) return ParcelAttribute.IMPROVEMENT_YEAR_BUILT;
  if (field === store.bldgEffAgeField) return ParcelAttribute.IMPROVEMENT_EFFECTIVE_YEAR_BUILT;
  if (field === store.bldgBedsField) return ParcelAttribute.BEDROOMS;
  if (field === store.bldgBathsField) return ParcelAttribute.BATHROOMS;
  if (field === store.bldgConditionField) return ParcelAttribute.CONDITION_ID;
  if (field === store.bldgTypeField) return ParcelAttribute.IMPROVEMENT_TYPE_ID;
  if (field === store.landTypeField) return ParcelAttribute.LAND_USE_ID;
  if (field === store.landZoningField) return ParcelAttribute.ZONING_ID;
  return null;
}"""

get_parcel_attr_new = """function getParcelAttributeForField(store: DataStore, field: string): ParcelAttribute | null {
  switch (field) {
    case "land_area_sq_ft": return ParcelAttribute.LAND_AREA_SQ_FT;
    case "frontage_ft": return ParcelAttribute.FRONTAGE_FT;
    case "depth_ft": return ParcelAttribute.DEPTH_FT;
    case "improvement_area_sq_ft": return ParcelAttribute.IMPROVEMENT_AREA_SQ_FT;
    case "improvement_year_built": return ParcelAttribute.IMPROVEMENT_YEAR_BUILT;
    case "improvement_effective_year_built": return ParcelAttribute.IMPROVEMENT_EFFECTIVE_YEAR_BUILT;
    case "bedrooms": return ParcelAttribute.BEDROOMS;
    case "bathrooms": return ParcelAttribute.BATHROOMS;
    case "units": return ParcelAttribute.UNITS;
    case "land_use_id": return ParcelAttribute.LAND_USE_ID;
    case "zoning_ids": return ParcelAttribute.ZONING_ID;
    case "condition_id": return ParcelAttribute.CONDITION_ID;
    case "improvement_type_id": return ParcelAttribute.IMPROVEMENT_TYPE_ID;
  }
  return null;
}"""

content = content.replace(get_parcel_attr_old, get_parcel_attr_new)

cat_vals_old = """    if (field === store.landZoningField) mapToUse = store.civilZoningMap;
    else if (field === store.landTypeField) mapToUse = store.civilLandUseMap;
    else if (field === store.bldgTypeField) mapToUse = store.civilImprovementTypeMap;
    else if (field === store.bldgConditionField) mapToUse = store.civilImprovementConditionMap;"""

cat_vals_new = """    if (field === "zoning_ids") mapToUse = store.civilZoningMap;
    else if (field === "land_use_id") mapToUse = store.civilLandUseMap;
    else if (field === "improvement_type_id") mapToUse = store.civilImprovementTypeMap;
    else if (field === "condition_id") mapToUse = store.civilImprovementConditionMap;"""

content = content.replace(cat_vals_old, cat_vals_new)

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

