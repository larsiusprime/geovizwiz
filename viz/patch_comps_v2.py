with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

# 1. Update imports to include GetParcelsByIdRequestSchema
old_imports = 'import { ParcelsService, GetEquityComparablesRequestSchema, GetSalesComparablesRequestSchema, ComparableCriteriaSchema, ParcelAttribute } from "@civil-labs/civil-api-js";'
new_imports = 'import { ParcelsService, GetEquityComparablesRequestSchema, GetSalesComparablesRequestSchema, ComparableCriteriaSchema, ParcelAttribute, GetParcelsByIdRequestSchema } from "@civil-labs/civil-api-js";'
content = content.replace(old_imports, new_imports)

# 2. Update getFieldLabel to handle zoning_id -> zoning_ids mapping
old_get_field_label = """function getFieldLabel(store: DataStore | null, field: string): string {
  if (store?.isCivil) {
    const attr = getParcelAttributeForField(field);
    if (attr !== null) {
      const key = ParcelAttribute[attr].toLowerCase();
      return t(key);
    }
  }
  return field;
}"""

new_get_field_label = """function getFieldLabel(store: DataStore | null, field: string): string {
  if (store?.isCivil) {
    const attr = getParcelAttributeForField(field);
    if (attr !== null) {
      let key = ParcelAttribute[attr].toLowerCase();
      if (key === 'zoning_id') key = 'zoning_ids';
      return t(key);
    }
  }
  return field;
}"""
content = content.replace(old_get_field_label, new_get_field_label)

# 3. Add resolveCategoricalValue helper at top level
resolve_cat_val_code = """
function resolveCategoricalValue(store: DataStore, field: string, rawVal: any): string {
  if (rawVal === null || rawVal === undefined || rawVal === '') return '—';
  
  if (field === 'land_use_id') {
    const lookup = store.civilLandUseMap?.[rawVal];
    return lookup ? (lookup.name || lookup.code || String(rawVal)) : String(rawVal);
  }
  if (field === 'zoning_ids') {
    const ids = Array.isArray(rawVal) ? rawVal : (typeof rawVal === 'string' ? [rawVal] : []);
    const codes = ids.map(id => {
      const lookup = store.civilZoningMap?.[id];
      return lookup ? (lookup.code || lookup.name || String(id)) : String(id);
    });
    return codes.filter(Boolean).join(', ') || '—';
  }
  if (field === 'improvement_type_id') {
    const lookup = store.civilImprovementTypeMap?.[rawVal];
    return lookup ? (lookup.name || lookup.code || String(rawVal)) : String(rawVal);
  }
  if (field === 'condition_id') {
    const lookup = store.civilImprovementConditionMap?.[rawVal];
    return lookup ? (lookup.name || lookup.code || String(rawVal)) : String(rawVal);
  }
  return String(rawVal);
}
"""
content = content.replace("let compMarkers = new Map<string, maplibregl.Marker>();", resolve_cat_val_code + "\nlet compMarkers = new Map<string, maplibregl.Marker>();")

# 4. Update getFieldValue to resolve categorical values
old_get_field_value = """function getFieldValue(feature: GeoJSON.Feature, field: string | null): any {
  if (!field) return null;
  return feature.properties?.[field];
}"""

new_get_field_value = """function getFieldValue(feature: GeoJSON.Feature, field: string | null): any {
  if (!field) return null;
  const raw = feature.properties?.[field];
  const store = getCompDataStore();
  if (store?.isCivil && store) {
    const available = getAvailableFieldsForDataStore(store);
    if (available.categorical.includes(field)) {
      return resolveCategoricalValue(store, field, raw);
    }
  }
  return raw;
}"""
content = content.replace(old_get_field_value, new_get_field_value)

# 5. Update getFeatureFromMap to search safely and resolve sourceLayer dynamically
old_get_feat_map = """function getFeatureFromMap(featureId: number | string | bigint): GeoJSON.Feature | null {
  const compStore = getCompDataStore();
  if (!compStore) return null;
  const compLayer = Array.from(S.layers.values()).find(l => l.dataStoreId === compStore.id);
  if (!compLayer) return null;

  const fidNum = Number(featureId);
  if (isNaN(fidNum)) return null;

  // Search in querySourceFeatures
  try {
    const sourceFeatures = S.map.querySourceFeatures(compLayer.sourceId, {
      sourceLayer: 'parcels',
      filter: ['==', '$id', fidNum]
    });
    if (sourceFeatures && sourceFeatures.length > 0) {
      return sourceFeatures[0] as GeoJSON.Feature;
    }
  } catch (e) {
    console.warn('[comp-finder] failed to query source features', e);
  }

  // Fallback to queryRenderedFeatures
  try {
    const renderedFeatures = S.map.queryRenderedFeatures({
      layers: [compLayer.layerId],
      filter: ['==', '$id', fidNum]
    });
    if (renderedFeatures && renderedFeatures.length > 0) {
      return renderedFeatures[0] as GeoJSON.Feature;
    }
  } catch (e) {
    console.warn('[comp-finder] failed to query rendered features', e);
  }

  return null;
}"""

new_get_feat_map = """function getFeatureFromMap(featureId: number | string | bigint): GeoJSON.Feature | null {
  const compStore = getCompDataStore();
  if (!compStore) return null;
  const compLayer = Array.from(S.layers.values()).find(l => l.dataStoreId === compStore.id);
  if (!compLayer) return null;

  const fidNum = Number(featureId);
  if (isNaN(fidNum)) return null;

  let sourceLayer = 'parcels';
  if (compStore.civilTileJson?.vector_layers?.[0]?.id) {
    sourceLayer = compStore.civilTileJson.vector_layers[0].id;
  }

  // Search in querySourceFeatures safely
  try {
    const sourceFeatures = S.map.querySourceFeatures(compLayer.sourceId, {
      sourceLayer: sourceLayer
    });
    const feat = sourceFeatures.find(f => Number(f.id) === fidNum);
    if (feat) return feat as GeoJSON.Feature;
  } catch (e) {
    console.warn('[comp-finder] failed to query source features', e);
  }

  // Fallback to queryRenderedFeatures safely
  try {
    const renderedFeatures = S.map.queryRenderedFeatures({
      layers: [compLayer.layerId]
    });
    const featRendered = renderedFeatures.find(f => Number(f.id) === fidNum);
    if (featRendered) return featRendered as GeoJSON.Feature;
  } catch (e) {
    console.warn('[comp-finder] failed to query rendered features', e);
  }

  return null;
}"""
content = content.replace(old_get_feat_map, new_get_feat_map)

# 6. Update getCategoricalValuesForField to use code/name instead of id
old_get_cat_values = """function getCategoricalValuesForField(field: string): Array<{value: string, label: string}> {
  const store = getCompDataStore();
  if (!store) return [];
  if (store.isCivil) {
    let mapToUse: Record<string, any> | undefined;
    if (field === "zoning_ids") mapToUse = store.civilZoningMap;
    else if (field === "land_use_id") mapToUse = store.civilLandUseMap;
    else if (field === "improvement_type_id") mapToUse = store.civilImprovementTypeMap;
    else if (field === "condition_id") mapToUse = store.civilImprovementConditionMap;
    
    if (mapToUse) {
      return Object.values(mapToUse).map((v: any) => ({
        value: String(v.code || v.id || ''),
        label: t(v.name || v.code || String(v.id || ''))
      })).filter(x => x.value).sort((a, b) => a.label.localeCompare(b.label));
    }
  }"""

new_get_cat_values = """function getCategoricalValuesForField(field: string): Array<{value: string, label: string}> {
  const store = getCompDataStore();
  if (!store) return [];
  if (store.isCivil) {
    let mapToUse: Record<string, any> | undefined;
    if (field === "zoning_ids") mapToUse = store.civilZoningMap;
    else if (field === "land_use_id") mapToUse = store.civilLandUseMap;
    else if (field === "improvement_type_id") mapToUse = store.civilImprovementTypeMap;
    else if (field === "condition_id") mapToUse = store.civilImprovementConditionMap;
    
    if (mapToUse) {
      return Object.values(mapToUse).map((v: any) => {
        const valStr = field === "zoning_ids" 
          ? String(v.code || v.name || v.id || '')
          : String(v.name || v.code || v.id || '');
        return {
          value: valStr,
          label: t(valStr)
        };
      }).filter(x => x.value).sort((a, b) => a.label.localeCompare(b.label));
    }
  }"""
content = content.replace(old_get_cat_values, new_get_cat_values)

# 7. Update option text in renderCriteriaTable dropdown
old_option_text = """    availableFields.forEach(({ field, type }) => {
      const option = document.createElement('option');
      option.value = field;
      option.textContent = field;
      option.dataset.fieldType = type;"""

new_option_text = """    availableFields.forEach(({ field, type }) => {
      const option = document.createElement('option');
      option.value = field;
      option.textContent = getFieldLabel(getCompDataStore(), field);
      option.dataset.fieldType = type;"""
content = content.replace(old_option_text, new_option_text)

# 8. Update findCompsImpl to fetch absolute tolerance and call GetParcelsById for full properties
old_find_comps = """    const criteriaArr = criteriaFields.map(entry => {
       const attr = getParcelAttributeForField(entry.field);
       if (attr === null) return null;
       const row = criteria.find(c => c.field === entry.field);
       if (!row) return null;
       
       if (entry.type === 'numeric') {
         let tol = 0;
         const val = numOrNull(row.value);
         if (val !== null) {
           tol = row.usePercent ? val / 100 : val;
         }
         return create(ComparableCriteriaSchema, {
           attribute: attr,
           minNumericalTolerance: tol,
           maxNumericalTolerance: tol
         });
       } else {
         return create(ComparableCriteriaSchema, {
           attribute: attr,
           categoricalTolerance: Array.isArray(row.value) ? row.value : []
         });
       }
    }).filter(Boolean) as ComparableCriteria[];

    let wkt = '';
    if (useDistance && distanceLimit !== null) {
      const circleFeat = makeDistanceCircleFeature(subjectCenter, distanceLimit);
      if (circleFeat && circleFeat.geometry.type === 'Polygon') {
        const coords = circleFeat.geometry.coordinates[0];
        const wktCoords = coords.map((c: any) => `${c[0]} ${c[1]}`).join(', ');
        wkt = `POLYGON((${wktCoords}))`;
      }
    }

    const transport = createConnectTransport({
      baseUrl: compStore.civilGateway!,
      interceptors: [
        (next) => async (req) => {
          req.header.set("Authorization", `Bearer ${compStore.civilToken}`);
          return await next(req);
        }
      ]
    });
    const client = createClient(ParcelsService, transport);
    const selectedParcelIds = useSelection 
      ? Array.from(selectedParcels).map(fid => compStore.civilFeatureToParcelIdMap?.get(Number(fid))).filter(Boolean) as string[]
      : [];

    const eqReq = create(GetEquityComparablesRequestSchema, { wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });
    const saleReq = create(GetSalesComparablesRequestSchema, { wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });

    const fetchedIds = new Set<string>();
    const mergeComp = (c: any) => {
      if (c.parcelId === subjectParcelId || fetchedIds.has(c.parcelId)) return;
      fetchedIds.add(c.parcelId);
      
      const featureIdStr = String(c.featureId);
      let baseFeature = getFeatureFromMap(c.featureId);
      
      const syntheticProperties: any = {};
      (c.attributes || []).forEach((attr: any) => {
         const key = ParcelAttribute[attr.attribute]?.toLowerCase();
         if (key) {
           syntheticProperties[key] = attr.numericalValue !== undefined && attr.numericalValue !== null 
             ? attr.numericalValue 
             : attr.categoricalValue;
         }
      });
      
      let feature: any;
      if (!baseFeature) {
         feature = {
            type: 'Feature',
            id: featureIdStr,
            geometry: null,
            properties: syntheticProperties
         };
      } else {
         feature = {
            ...baseFeature,
            properties: {
               ...(baseFeature.properties || {}),
               ...syntheticProperties
            }
         };
      }
      
      const deltas = criteriaFields.map((entry) => {
        const compVal = getFieldValue(feature, entry.field);
        const subjVal = getFieldValue(subjectFeature, entry.field);
        return buildDelta(compVal, subjVal, entry.type);
      });

      comps.push({
        id: c.parcelId || uid('comp'),
        feature,
        deltas,
        parcelId: c.parcelId || '—',
        address: c.formattedAddress || '—',
        featureId: featureIdStr,
      });
    };

    try {
      const [eqRes, saleRes] = await Promise.all([
        client.getEquityComparables(eqReq),
        client.getSalesComparables(saleReq)
      ]);
      Object.values(eqRes.parcels || {}).forEach(mergeComp);
      Object.values(saleRes.parcels || {}).forEach(mergeComp);
      registerMapCompEvents();
    } catch (err) {
      console.error("Failed to fetch civil comps:", err);
    }"""

new_find_comps = """    const criteriaArr = criteriaFields.map(entry => {
       const attr = getParcelAttributeForField(entry.field);
       if (attr === null) return null;
       const row = criteria.find(c => c.field === entry.field);
       if (!row) return null;
       
       if (entry.type === 'numeric') {
         const val = numOrNull(row.value);
         const subjVal = numOrNull(getFieldValue(subjectFeature, entry.field));
         if (val !== null && subjVal !== null) {
           const tol = row.usePercent ? subjVal * (val / 100) : val;
           return create(ComparableCriteriaSchema, {
             attribute: attr,
             minNumericalTolerance: subjVal - tol,
             maxNumericalTolerance: subjVal + tol
           });
         }
         return null;
       } else {
         return create(ComparableCriteriaSchema, {
           attribute: attr,
           categoricalTolerance: Array.isArray(row.value) ? row.value : []
         });
       }
    }).filter(Boolean) as ComparableCriteria[];

    let wkt = '';
    if (useDistance && distanceLimit !== null) {
      const circleFeat = makeDistanceCircleFeature(subjectCenter, distanceLimit);
      if (circleFeat && circleFeat.geometry.type === 'Polygon') {
        const coords = circleFeat.geometry.coordinates[0];
        const wktCoords = coords.map((c: any) => `${c[0]} ${c[1]}`).join(', ');
        wkt = `POLYGON((${wktCoords}))`;
      }
    }

    const transport = createConnectTransport({
      baseUrl: compStore.civilGateway!,
      interceptors: [
        (next) => async (req) => {
          req.header.set("Authorization", `Bearer ${compStore.civilToken}`);
          return await next(req);
        }
      ]
    });
    const client = createClient(ParcelsService, transport);
    const selectedParcelIds = useSelection 
      ? Array.from(selectedParcels).map(fid => compStore.civilFeatureToParcelIdMap?.get(Number(fid))).filter(Boolean) as string[]
      : [];

    const eqReq = create(GetEquityComparablesRequestSchema, { wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });
    const saleReq = create(GetSalesComparablesRequestSchema, { wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });

    const fetchedIds = new Set<string>();
    const mergeComp = (c: any) => {
      if (c.parcelId === subjectParcelId || fetchedIds.has(c.parcelId)) return;
      fetchedIds.add(c.parcelId);
      
      const featureIdStr = String(c.featureId);
      let baseFeature = getFeatureFromMap(c.featureId);
      
      const syntheticProperties: any = {};
      (c.attributes || []).forEach((attr: any) => {
         let key = ParcelAttribute[attr.attribute]?.toLowerCase();
         if (key === 'zoning_id') key = 'zoning_ids';
         if (key) {
           syntheticProperties[key] = attr.numericalValue !== undefined && attr.numericalValue !== null 
             ? attr.numericalValue 
             : attr.categoricalValue;
         }
      });
      
      let feature: any;
      if (!baseFeature) {
         feature = {
            type: 'Feature',
            id: featureIdStr,
            geometry: null,
            properties: syntheticProperties
         };
      } else {
         feature = {
            ...baseFeature,
            properties: {
               ...(baseFeature.properties || {}),
               ...syntheticProperties
            }
         };
      }
      
      const deltas = criteriaFields.map((entry) => {
        const compVal = getFieldValue(feature, entry.field);
        const subjVal = getFieldValue(subjectFeature, entry.field);
        return buildDelta(compVal, subjVal, entry.type);
      });

      comps.push({
        id: c.parcelId || uid('comp'),
        feature,
        deltas,
        parcelId: c.parcelId || '—',
        address: c.formattedAddress || '—',
        featureId: featureIdStr,
      });
    };

    try {
      const [eqRes, saleRes] = await Promise.all([
        client.getEquityComparables(eqReq),
        client.getSalesComparables(saleReq)
      ]);
      Object.values(eqRes.parcels || {}).forEach(mergeComp);
      Object.values(saleRes.parcels || {}).forEach(mergeComp);

      // Now fetch full parcel details using GetParcelsById for all comps + subject!
      const compParcelIds = comps.map(c => c.parcelId).filter(Boolean);
      if (subjectParcelId) {
        compParcelIds.push(subjectParcelId);
      }
      
      if (compParcelIds.length > 0) {
        const getParcelsReq = create(GetParcelsByIdRequestSchema, { parcelIds: compParcelIds });
        const parcelsRes = await client.getParcelsById(getParcelsReq);
        
        Object.entries(parcelsRes.parcels || {}).forEach(([pid, parcel]) => {
          let targetFeature: any = null;
          if (pid === subjectParcelId && subject) {
            targetFeature = subject.feature;
          } else {
            const comp = comps.find(c => c.parcelId === pid);
            if (comp) {
              targetFeature = comp.feature;
              if (parcel.formattedAddress) {
                comp.address = parcel.formattedAddress;
              }
            }
          }
          
          if (targetFeature) {
            targetFeature.properties = targetFeature.properties || {};
            
            // 1. Merge explicit fields
            if (parcel.landAreaSqFt !== undefined && parcel.landAreaSqFt !== null) {
              targetFeature.properties.land_area_sq_ft = parcel.landAreaSqFt;
            }
            if (parcel.frontageFt !== undefined && parcel.frontageFt !== null) {
              targetFeature.properties.frontage_ft = parcel.frontageFt;
            }
            if (parcel.depthFt !== undefined && parcel.depthFt !== null) {
              targetFeature.properties.depth_ft = parcel.depthFt;
            }
            if (parcel.landUseId) {
              targetFeature.properties.land_use_id = parcel.landUseId;
            }
            if (parcel.zoningIds && parcel.zoningIds.length > 0) {
              targetFeature.properties.zoning_ids = parcel.zoningIds;
            }
            if (parcel.improvementSummary) {
              targetFeature.properties.improvement_area_sq_ft = parcel.improvementSummary.totalAreaSqFt;
              targetFeature.properties.improvement_year_built = parcel.improvementSummary.newestYearBuilt || parcel.improvementSummary.oldestYearBuilt;
              targetFeature.properties.improvement_effective_year_built = parcel.improvementSummary.newestYearBuilt;
              targetFeature.properties.bedrooms = parcel.improvementSummary.totalBedrooms;
              targetFeature.properties.bathrooms = parcel.improvementSummary.totalBathrooms;
              targetFeature.properties.units = parcel.improvementSummary.totalUnits;
              targetFeature.properties.condition_id = parcel.improvementSummary.worstConditionId || parcel.improvementSummary.bestConditionId;
            }
            
            // 2. Parse and merge properties JSON
            if (parcel.properties) {
              try {
                const parsed = JSON.parse(parcel.properties);
                Object.assign(targetFeature.properties, parsed);
                // Also merge under snake_case keys if any are camelCase
                Object.entries(parsed).forEach(([k, val]) => {
                  const snake = k.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
                  if (targetFeature.properties[snake] === undefined) {
                    targetFeature.properties[snake] = val;
                  }
                });
              } catch (e) {
                // ignore
              }
            }
          }
        });
      }

      // Re-trigger updateCompMarkers after properties & addresses are resolved
      updateCompMarkers();
      registerMapCompEvents();
    } catch (err) {
      console.error("Failed to fetch civil comps:", err);
    }"""
content = content.replace(old_find_comps, new_find_comps)

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

