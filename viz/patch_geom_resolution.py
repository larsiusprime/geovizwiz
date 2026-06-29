with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

# 1. Update CompRow definition
old_comprow = """type CompRow = {
  id: string;
  feature: GeoJSON.Feature;
  deltas: Array<{ text: string; error?: string; sign?: 'positive' | 'negative' | 'neutral' | 'error' }>;
  parcelId: string;
  address: string;
};"""

new_comprow = """type CompRow = {
  id: string;
  feature: GeoJSON.Feature;
  deltas: Array<{ text: string; error?: string; sign?: 'positive' | 'negative' | 'neutral' | 'error' }>;
  parcelId: string;
  address: string;
  featureId?: string;
};"""

content = content.replace(old_comprow, new_comprow)

# 2. Add getFeatureFromMap and registerMapCompEvents helpers at the top level
helpers = """
function getFeatureFromMap(featureId: number | string | bigint): GeoJSON.Feature | null {
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
}

let registeredMapEvents = false;
function registerMapCompEvents() {
  if (registeredMapEvents) return;
  if (!S.map) return;
  registeredMapEvents = true;
  S.map.on('moveend', () => {
    if (isMenuVisible && comps.some(c => !c.feature.geometry)) {
      updateCompMarkers();
    }
  });
  S.map.on('sourcedata', (e) => {
    if (isMenuVisible && e.isSourceLoaded && comps.some(c => !c.feature.geometry)) {
      updateCompMarkers();
    }
  });
}
"""

# Insert helpers right before "let compMarkers"
content = content.replace("let compMarkers = new Map<string, maplibregl.Marker>();", helpers + "\nlet compMarkers = new Map<string, maplibregl.Marker>();")

# 3. Update updateCompMarkers to resolve geometry from map
old_update_comp = """function updateCompMarkers() {
  clearCompMarkers();
  if (!isMenuVisible) return;
  for (const comp of comps) {
    const center = getFeatureCenter(comp.feature);
    if (!center) continue;
    const marker = new maplibregl.Marker({ element: ensureMarker(COMP_MARKER_CLASS), anchor: 'bottom' })
      .setLngLat(center)
      .addTo(S.map);
    marker.getElement().addEventListener('click', (event) => {
      event.stopPropagation();
      const targetLayerId = els.dataSourceSelect.value || subject?.layerId;
      if (targetLayerId) setCompFinderSubject(comp.feature, targetLayerId);
    });
    compMarkers.set(comp.id, marker);
  }
}"""

new_update_comp = """function updateCompMarkers() {
  clearCompMarkers();
  if (!isMenuVisible) return;
  for (const comp of comps) {
    let feature = comp.feature;
    if ((!feature || !feature.geometry) && comp.featureId) {
      const mapFeat = getFeatureFromMap(comp.featureId);
      if (mapFeat && mapFeat.geometry) {
        feature = {
          ...mapFeat,
          properties: {
            ...mapFeat.properties,
            ...feature.properties
          }
        };
        comp.feature = feature;
      }
    }
    const center = getFeatureCenter(feature);
    if (!center) continue;
    const marker = new maplibregl.Marker({ element: ensureMarker(COMP_MARKER_CLASS), anchor: 'bottom' })
      .setLngLat(center)
      .addTo(S.map);
    marker.getElement().addEventListener('click', (event) => {
      event.stopPropagation();
      const targetLayerId = els.dataSourceSelect.value || subject?.layerId;
      if (targetLayerId) setCompFinderSubject(comp.feature, targetLayerId);
    });
    compMarkers.set(comp.id, marker);
  }
}"""

content = content.replace(old_update_comp, new_update_comp)

# 4. Update mergeComp to query getFeatureFromMap first
old_merge = """    const fetchedIds = new Set<string>();
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

new_merge = """    const fetchedIds = new Set<string>();
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
    };"""

content = content.replace(old_merge, new_merge)

# 5. Call registerMapCompEvents in findCompsImpl
old_find_comps_try = """    try {
      const [eqRes, saleRes] = await Promise.all([
        client.getEquityComparables(eqReq),
        client.getSalesComparables(saleReq)
      ]);
      Object.values(eqRes.parcels || {}).forEach(mergeComp);
      Object.values(saleRes.parcels || {}).forEach(mergeComp);
    } catch (err) {"""

new_find_comps_try = """    try {
      const [eqRes, saleRes] = await Promise.all([
        client.getEquityComparables(eqReq),
        client.getSalesComparables(saleReq)
      ]);
      Object.values(eqRes.parcels || {}).forEach(mergeComp);
      Object.values(saleRes.parcels || {}).forEach(mergeComp);
      registerMapCompEvents();
    } catch (err) {"""

content = content.replace(old_find_comps_try, new_find_comps_try)

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

