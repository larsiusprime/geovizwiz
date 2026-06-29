with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

# 1. Revert getFieldValue and update getFeatureFromMap with string comparison
old_helpers = """function getFieldValue(feature: GeoJSON.Feature, field: string | null): any {
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
}

function getFeatureFromMap(featureId: number | string | bigint): GeoJSON.Feature | null {
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

new_helpers = """function getFieldValue(feature: GeoJSON.Feature, field: string | null): any {
  if (!field) return null;
  return feature.properties?.[field];
}

function getFeatureId(f: any): string | null {
  if (f.id !== undefined && f.id !== null) {
    return String(f.id);
  }
  if (f.properties) {
    if (f.properties.feature_id !== undefined && f.properties.feature_id !== null) {
      return String(f.properties.feature_id);
    }
    if (f.properties.featureId !== undefined && f.properties.featureId !== null) {
      return String(f.properties.featureId);
    }
    if (f.properties.id !== undefined && f.properties.id !== null) {
      return String(f.properties.id);
    }
  }
  return null;
}

function getFeatureFromMap(featureId: number | string | bigint): GeoJSON.Feature | null {
  const compStore = getCompDataStore();
  if (!compStore) return null;
  const compLayer = Array.from(S.layers.values()).find(l => l.dataStoreId === compStore.id);
  if (!compLayer) return null;

  const fidStr = String(featureId);

  let sourceLayer = 'parcels';
  if (compStore.civilTileJson?.vector_layers?.[0]?.id) {
    sourceLayer = compStore.civilTileJson.vector_layers[0].id;
  }

  // Search in querySourceFeatures safely
  try {
    const sourceFeatures = S.map.querySourceFeatures(compLayer.sourceId, {
      sourceLayer: sourceLayer
    });
    const feat = sourceFeatures.find(f => getFeatureId(f) === fidStr);
    if (feat) return feat as GeoJSON.Feature;
  } catch (e) {
    console.warn('[comp-finder] failed to query source features', e);
  }

  // Fallback to queryRenderedFeatures safely
  try {
    const renderedFeatures = S.map.queryRenderedFeatures({
      layers: [compLayer.layerId]
    });
    const featRendered = renderedFeatures.find(f => getFeatureId(f) === fidStr);
    if (featRendered) return featRendered as GeoJSON.Feature;
  } catch (e) {
    console.warn('[comp-finder] failed to query rendered features', e);
  }

  return null;
}"""

content = content.replace(old_helpers, new_helpers)

# 2. Update getCategoricalValuesForField to use code/name instead of id
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
        const labelStr = field === "zoning_ids"
          ? String(v.code || v.name || v.id || '')
          : String(v.name || v.code || v.id || '');
        return {
          value: valStr,
          label: t(labelStr)
        };
      }).filter(x => x.value).sort((a, b) => a.label.localeCompare(b.label));
    }
  }"""

content = content.replace(old_get_cat_values, new_get_cat_values)

# 3. Update renderCriteriaTable categorical initialization
old_cat_init = """    } else if (row.fieldType === 'categorical') {
      const select = document.createElement('select');
      select.className = 'comp-finder-criteria-categorical';
      select.multiple = true;
      const values = row.field ? getCategoricalValuesForField(row.field) : [];"""

new_cat_init = """    } else if (row.fieldType === 'categorical') {
      const select = document.createElement('select');
      select.className = 'comp-finder-criteria-categorical';
      select.multiple = true;

      if (row.value === null || (Array.isArray(row.value) && row.value.length === 0)) {
        const compStore = getCompDataStore();
        if (compStore && compStore.isCivil && row.field) {
          let subjectValue = getFieldValue(subject!.feature, row.field);
          if (row.field === 'zoning_ids') {
            const ids = Array.isArray(subjectValue) ? subjectValue : (typeof subjectValue === 'string' ? [subjectValue] : []);
            row.value = ids.map(id => {
              const lookup = compStore.civilZoningMap?.[id];
              return lookup ? (lookup.code || lookup.name || String(id)) : String(id);
            }).filter(Boolean);
          } else {
            const lookupMap = row.field === 'land_use_id' ? compStore.civilLandUseMap
              : row.field === 'improvement_type_id' ? compStore.civilImprovementTypeMap
              : row.field === 'condition_id' ? compStore.civilImprovementConditionMap
              : null;
            if (lookupMap && subjectValue !== null && subjectValue !== undefined) {
              const lookup = lookupMap[subjectValue];
              row.value = lookup ? [lookup.name || lookup.code || String(subjectValue)] : [String(subjectValue)];
            }
          }
        }
      }

      const values = row.field ? getCategoricalValuesForField(row.field) : [];"""

content = content.replace(old_cat_init, new_cat_init)

# 4. Resolve categorical values in renderCompsTable and buildDelta
old_comp_val_table = """      } else {
        const val = getFieldValue(comp.feature, entry.field);
        text = val === null || val === undefined || val === '' ? '—' : (entry.type === 'numeric' ? fmt(val) : String(val));
      }"""

new_comp_val_table = """      } else {
        const val = getFieldValue(comp.feature, entry.field);
        const resolved = compStore.isCivil ? resolveCategoricalValue(compStore, entry.field, val) : val;
        text = resolved === null || resolved === undefined || resolved === '' ? '—' : (entry.type === 'numeric' ? fmt(resolved) : String(resolved));
      }"""

content = content.replace(old_comp_val_table, new_comp_val_table)

# 5. Update findCompsImpl to use relative tolerance and map selection back to database IDs
old_find_comps = """    const criteriaArr = criteriaFields.map(entry => {
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
    }).filter(Boolean) as ComparableCriteria[];"""

new_find_comps = """    const criteriaArr = criteriaFields.map(entry => {
       const attr = getParcelAttributeForField(entry.field);
       if (attr === null) return null;
       const row = criteria.find(c => c.field === entry.field);
       if (!row) return null;
       
       if (entry.type === 'numeric') {
         const val = numOrNull(row.value);
         if (val !== null) {
           const tol = row.usePercent ? val / 100 : val;
           return create(ComparableCriteriaSchema, {
             attribute: attr,
             minNumericalTolerance: -tol,
             maxNumericalTolerance: tol
           });
         }
         return null;
       } else {
         const selectedNames = Array.isArray(row.value) ? row.value : [];
         let mapToUse: Record<string, any> | undefined;
         if (entry.field === "zoning_ids") mapToUse = compStore.civilZoningMap;
         else if (entry.field === "land_use_id") mapToUse = compStore.civilLandUseMap;
         else if (entry.field === "improvement_type_id") mapToUse = compStore.civilImprovementTypeMap;
         else if (entry.field === "condition_id") mapToUse = compStore.civilImprovementConditionMap;

         const apiTolerance = selectedNames.map(val => {
           if (mapToUse) {
             const found = Object.values(mapToUse).find(v => {
               const valStr = entry.field === "zoning_ids"
                 ? String(v.code || v.name || v.id || '')
                 : String(v.name || v.code || v.id || '');
               return valStr === val;
             });
             return found 
               ? (entry.field === "zoning_ids" ? String(found.code || found.id || '') : String(found.id || ''))
               : val;
           }
           return val;
         }).filter(Boolean);

         return create(ComparableCriteriaSchema, {
           attribute: attr,
           categoricalTolerance: apiTolerance
         });
       }
    }).filter(Boolean) as ComparableCriteria[];"""

content = content.replace(old_find_comps, new_find_comps)

# 6. Update findCompsImpl try block to recalculate deltas and add polling for updateCompMarkers
old_try_block = """    try {
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

new_try_block = """    try {
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

      // Recalculate deltas now that the full properties have been fetched and merged
      comps.forEach((comp) => {
        comp.deltas = criteriaFields.map((entry) => {
          let compVal = getFieldValue(comp.feature, entry.field);
          let subjVal = getFieldValue(subjectFeature, entry.field);
          if (compStore.isCivil) {
            compVal = resolveCategoricalValue(compStore, entry.field, compVal);
            subjVal = resolveCategoricalValue(compStore, entry.field, subjVal);
          }
          return buildDelta(compVal, subjVal, entry.type);
        });
      });

      // Re-trigger updateCompMarkers after properties & addresses are resolved
      updateCompMarkers();
      setTimeout(updateCompMarkers, 500);
      setTimeout(updateCompMarkers, 1500);
      setTimeout(updateCompMarkers, 3000);
      
      registerMapCompEvents();
    } catch (err) {
      console.error("Failed to fetch civil comps:", err);
    }"""

content = content.replace(old_try_block, new_try_block)

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

