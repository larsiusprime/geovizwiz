with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

# 1. Update mergeComp to calculate resolved deltas on the first pass
old_merge_comp = """    const fetchedIds = new Set<string>();
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
    };"""

new_merge_comp = """    const fetchedIds = new Set<string>();
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
        let compVal = getFieldValue(feature, entry.field);
        let subjVal = getFieldValue(subjectFeature, entry.field);
        if (compStore.isCivil) {
          compVal = resolveCategoricalValue(compStore, entry.field, compVal);
          subjVal = resolveCategoricalValue(compStore, entry.field, subjVal);
        }
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
    };"""

content = content.replace(old_merge_comp, new_merge_comp)

# 2. Update the try block in findCompsImpl to completely bypass GetParcelsById
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

new_try_block = """    try {
      const [eqRes, saleRes] = await Promise.all([
        client.getEquityComparables(eqReq),
        client.getSalesComparables(saleReq)
      ]);
      Object.values(eqRes.parcels || {}).forEach(mergeComp);
      Object.values(saleRes.parcels || {}).forEach(mergeComp);

      // Re-trigger updateCompMarkers immediately
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

