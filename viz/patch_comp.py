import re

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'r') as f:
    content = f.read()

# 1. Imports
imports = """import {
  makeDistanceCircleFeature, getFeatureCenter, isValidLngLat, distanceMeters, getPageTokens, getDeltaClass, buildDelta,
} from './comp-finder-helpers';
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { ParcelsService, GetEquityComparablesRequest, GetSalesComparablesRequest, ComparableCriteria, ParcelAttribute } from "@civil-labs/civil-api-js";
import { resolveCivilSelectionIds } from './selection';
import enTranslations from '../locales/en.json';
import esTranslations from '../locales/es.json';

const translations: Record<string, Record<string, string>> = {
  en: enTranslations,
  es: esTranslations
};

function t(key: string): string {
  const lang = localStorage.getItem('language') || 'en';
  const langDict = translations[lang] || translations['en'];
  return langDict[key] || key;
}

function getParcelAttributeForField(store: DataStore, field: string): ParcelAttribute | null {
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
}

function getFieldLabel(store: DataStore | null, field: string): string {
  if (store?.isCivil) {
    const attr = getParcelAttributeForField(store, field);
    if (attr !== null) {
      const key = ParcelAttribute[attr].toLowerCase();
      return t(key);
    }
  }
  return field;
}
"""

content = content.replace("""import {
  makeDistanceCircleFeature, getFeatureCenter, isValidLngLat, distanceMeters, getPageTokens, getDeltaClass, buildDelta,
} from './comp-finder-helpers';""", imports)

# 2. getAvailableFieldsForDataStore
avail = """function getAvailableFieldsForDataStore(dataStore: DataStore | null) {
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
  }
  return {
    numeric: dataStore.chosenNumericFields ?? [],
    categorical: dataStore.chosenCategoricalFields ?? [],
  };
}"""

content = re.sub(r'function getAvailableFieldsForDataStore.*?return \{\s*numeric: dataStore\.chosenNumericFields \?\? \[\],\s*categorical: dataStore\.chosenCategoricalFields \?\? \[\],\s*\};\s*\}', avail, content, flags=re.DOTALL)

# 3. getCategoricalValuesForField
cat_values = """function getCategoricalValuesForField(field: string): Array<{value: string, label: string}> {
  const store = getCompDataStore();
  if (!store) return [];
  if (store.isCivil) {
    let mapToUse: Record<string, any> | undefined;
    if (field === store.landZoningField) mapToUse = store.civilZoningMap;
    else if (field === store.landTypeField) mapToUse = store.civilLandUseMap;
    else if (field === store.bldgTypeField) mapToUse = store.civilImprovementTypeMap;
    else if (field === store.bldgConditionField) mapToUse = store.civilImprovementConditionMap;
    
    if (mapToUse) {
      return Object.values(mapToUse).map((v: any) => ({
        value: String(v.code || v.id || ''),
        label: t(v.name || v.code || String(v.id || ''))
      })).filter(x => x.value).sort((a, b) => a.label.localeCompare(b.label));
    }
  }

  if (!store.geojson) return [];
  const values = new Set<string>();
  for (const feature of store.geojson.features) {
    const raw = feature.properties?.[field];
    if (raw === undefined || raw === null || raw === '') continue;
    values.add(String(raw));
  }
  return Array.from(values).sort().map(v => ({ value: v, label: v }));
}"""

content = re.sub(r'function getCategoricalValuesForField.*?return Array\.from\(values\)\.sort\(\);\s*\}', cat_values, content, flags=re.DOTALL)

# 4. renderAddFieldOptions label mapping
render_add = """  out.forEach((entry) => {
    const option = document.createElement('option');
    option.value = entry.field;
    option.textContent = `${getFieldLabel(getCompDataStore(), entry.field)} (${entry.type})`;
    els.addFieldSelect.appendChild(option);
  });"""
content = re.sub(r'out\.forEach\(\(entry\) => \{\s*const option = document\.createElement\(\'option\'\);\s*option\.value = entry\.field;\s*option\.textContent = `\$\{entry\.field\} \(\$\{entry\.type\}\)`;\s*els\.addFieldSelect\.appendChild\(option\);\s*\}\);', render_add, content)

# 5. buildCriteriaRow label
build_criteria = """const text = document.createTextNode(getFieldLabel(getCompDataStore(), row.field));"""
content = re.sub(r'const text = document\.createTextNode\(row\.field\);', build_criteria, content)

# 6. renderCompsTable label
render_comps = """th.appendChild(buildCompColumnButton(getFieldLabel(getCompDataStore(), entry.field), comp, () => {"""
content = re.sub(r'th\.appendChild\(buildCompColumnButton\(entry\.field, comp, \(\) => \{', render_comps, content)

# 7. buildCategoricalRow dropdown population
build_cat_row = """      const values = row.field ? getCategoricalValuesForField(row.field) : [];
      values.forEach((v) => {
        const option = document.createElement('option');
        option.value = v.value;
        option.textContent = v.label;
        option.selected = Array.isArray(row.value) && row.value.includes(v.value);
        select.appendChild(option);
      });"""
content = re.sub(r'const values = row\.field \? getCategoricalValuesForField\(row\.field\) : \[\];\s*values\.forEach\(\(value\) => \{\s*const option = document\.createElement\(\'option\'\);\s*option\.value = value;\s*option\.textContent = value;\s*option\.selected = Array\.isArray\(row\.value\) && row\.value\.includes\(value\);\s*select\.appendChild\(option\);\s*\}\);', build_cat_row, content)

# 8. findCompsImpl
find_comps_old = """  for (const feature of compStore.geojson.features) {
    const compCenter = getFeatureCenter(feature);
    if (!compCenter) continue;
    const parcelId = String(getFieldValue(feature, compStore.parcelIdField) ?? '');
    const featureId = feature.id === undefined || feature.id === null ? null : String(feature.id);
    if (parcelId && subjectParcelId && parcelId === subjectParcelId) continue;

    if (useDistance && distanceLimit !== null) {
      const dist = distanceMeters(subjectCenter, compCenter);
      if (dist > distanceLimit) continue;
    }

    if (useSelection) {
      if (!featureId || !selectedParcels.has(featureId)) continue;
    }

    if (!passesCriteria(feature)) continue;

    const deltas = criteriaFields.map((entry) => {
      const compVal = getFieldValue(feature, entry.field);
      const subjVal = getFieldValue(subjectFeature, entry.field);
      return buildDelta(compVal, subjVal, entry.type);
    });

    comps.push({
      id: parcelId || uid('comp'),
      feature,
      deltas,
      parcelId: parcelId || '—',
      address: String(getFieldValue(feature, compStore.addressField) ?? '—'),
    });
  }"""

find_comps_new = """  if (compStore.isCivil) {
    if (useSelection) {
      await resolveCivilSelectionIds(Array.from(selectedParcels), compStore);
    }
    
    const criteriaArr = criteriaFields.map(entry => {
       const attr = getParcelAttributeForField(compStore, entry.field);
       if (attr === null) return null;
       const row = criteria.find(c => c.field === entry.field);
       if (!row) return null;
       
       if (entry.type === 'numeric') {
         let tol = 0;
         const val = numOrNull(row.value);
         if (val !== null) {
           tol = row.usePercent ? val / 100 : val;
         }
         return new ComparableCriteria({
           attribute: attr,
           minNumericalTolerance: tol,
           maxNumericalTolerance: tol
         });
       } else {
         return new ComparableCriteria({
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

    const eqReq = new GetEquityComparablesRequest({ wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });
    const saleReq = new GetSalesComparablesRequest({ wktPolygon: wkt, criteria: criteriaArr, selectedParcelIds });

    const fetchedIds = new Set<string>();
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
    };

    try {
      const [eqRes, saleRes] = await Promise.all([
        client.getEquityComparables(eqReq),
        client.getSalesComparables(saleReq)
      ]);
      Object.values(eqRes.parcels || {}).forEach(mergeComp);
      Object.values(saleRes.parcels || {}).forEach(mergeComp);
    } catch (err) {
      console.error("Failed to fetch civil comps:", err);
    }
  } else {
    for (const feature of compStore.geojson.features) {
      const compCenter = getFeatureCenter(feature);
      if (!compCenter) continue;
      const parcelId = String(getFieldValue(feature, compStore.parcelIdField) ?? '');
      const featureId = feature.id === undefined || feature.id === null ? null : String(feature.id);
      if (parcelId && subjectParcelId && parcelId === subjectParcelId) continue;

      if (useDistance && distanceLimit !== null) {
        const dist = distanceMeters(subjectCenter, compCenter);
        if (dist > distanceLimit) continue;
      }

      if (useSelection) {
        if (!featureId || !selectedParcels.has(featureId)) continue;
      }

      if (!passesCriteria(feature)) continue;

      const deltas = criteriaFields.map((entry) => {
        const compVal = getFieldValue(feature, entry.field);
        const subjVal = getFieldValue(subjectFeature, entry.field);
        return buildDelta(compVal, subjVal, entry.type);
      });

      comps.push({
        id: parcelId || uid('comp'),
        feature,
        deltas,
        parcelId: parcelId || '—',
        address: String(getFieldValue(feature, compStore.addressField) ?? '—'),
      });
    }
  }"""

content = content.replace(find_comps_old, find_comps_new)

with open('/workspace/geovizwiz/viz/src/comp-finder.ts', 'w') as f:
    f.write(content)

