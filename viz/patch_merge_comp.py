import re

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

merge_comp_old = """    const fetchedIds = new Set<string>();
    const mergeComp = (c: any) => {
      if (c.parcelId === subjectParcelId || fetchedIds.has(c.parcelId)) return;
      fetchedIds.add(c.parcelId);
      
      const featureIdStr = String(c.featureId);
      const feature = compStore.geojson!.features.find((f: any) => String(f.id) === featureIdStr);
      if (!feature) return;
      
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
      });
    };"""

merge_comp_new = """    const fetchedIds = new Set<string>();
    const mergeComp = (c: any) => {
      if (c.parcelId === subjectParcelId || fetchedIds.has(c.parcelId)) return;
      fetchedIds.add(c.parcelId);
      
      const featureIdStr = String(c.featureId);
      let baseFeature = compStore.geojson!.features.find((f: any) => String(f.id) === featureIdStr);
      
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
      });
    };"""

content = content.replace(merge_comp_old, merge_comp_new)

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

