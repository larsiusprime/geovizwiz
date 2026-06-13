/**
 * Legend-related functions extracted from main.ts.
 * All modules import `S` to read/write state.
 */
import type { Expression } from 'maplibre-gl';
import { S } from './state';
import { fmt } from './utils.number';
import {
  applyCategorySelection, applyRangeSelection,
  updateSelectionControls,
} from './selection';
import { applyVisibilityFilters } from './filters';
import { floatingLegend, legendContent, legendTitle, multInput, unitsSelect, opacityInput } from './dom-refs';
import { normalizedValue } from './rendering-helpers';
import { UNIT_TO_METERS } from './config';

/* ------------------------------------------------------------------ */
/*  DOM-derived values (formerly callback seams). Read straight from   */
/*  dom-refs/config — no cross-module dependency needed.               */
/* ------------------------------------------------------------------ */

const _getMultiplierValue = (): number => {
  const rawMult = Number(multInput.value);
  return Number.isFinite(rawMult) ? rawMult : 0;
};
const _getUnitFactor = (): number => UNIT_TO_METERS[unitsSelect.value as keyof typeof UNIT_TO_METERS] ?? 1;
const _getOpacityValue = (): number => parseFloat(opacityInput.value);

/* ------------------------------------------------------------------ */
/*  Callbacks into main.ts (set once via initLegendCallbacks)          */
/* ------------------------------------------------------------------ */

let _persistCurrentLayerState: () => void = () => {};
let _renderLayerList: () => void = () => {};
let _applyExtrusion: () => void = () => {};
let _getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null = () => null;
let _getCurrentSourceId: () => string | null = () => null;
let _buildCategoricalColorPairs: () => Array<[string, string]> = () => [];
let _buildCategoricalColorExpression: () => Expression = () => ['literal', '#888'] as any;
let _buildNumericColorRanges: () => Array<{ min: number; max: number; color: string; rangeKey: string }> = () => [];
let _buildNumericColorExpression: () => Expression = () => ['literal', '#888'] as any;
let _buildValueExpression: () => Expression = () => ['literal', 0] as any;
let _createEyeButton: (isHidden: boolean, title: string) => HTMLButtonElement = () => document.createElement('button');

export interface LegendCallbacks {
  persistCurrentLayerState: () => void;
  renderLayerList: () => void;
  applyExtrusion: () => void;
  getCurrentLayerIds: () => { sourceId: string; layerId: string; errorLayerId: string } | null;
  getCurrentSourceId: () => string | null;
  buildCategoricalColorPairs: () => Array<[string, string]>;
  buildCategoricalColorExpression: () => Expression;
  buildNumericColorRanges: () => Array<{ min: number; max: number; color: string; rangeKey: string }>;
  buildNumericColorExpression: () => Expression;
  buildValueExpression: () => Expression;
  createEyeButton: (isHidden: boolean, title: string) => HTMLButtonElement;
}

export function initLegendCallbacks(cb: LegendCallbacks) {
  _persistCurrentLayerState = cb.persistCurrentLayerState;
  _renderLayerList = cb.renderLayerList;
  _applyExtrusion = cb.applyExtrusion;
  _getCurrentLayerIds = cb.getCurrentLayerIds;
  _getCurrentSourceId = cb.getCurrentSourceId;
  _buildCategoricalColorPairs = cb.buildCategoricalColorPairs;
  _buildCategoricalColorExpression = cb.buildCategoricalColorExpression;
  _buildNumericColorRanges = cb.buildNumericColorRanges;
  _buildNumericColorExpression = cb.buildNumericColorExpression;
  _buildValueExpression = cb.buildValueExpression;
  _createEyeButton = cb.createEyeButton;
}

/* ------------------------------------------------------------------ */
/*  Legend functions                                                    */
/* ------------------------------------------------------------------ */

export function hideFloatingLegend() {
  S.ui.isLegendVisible = false;
  floatingLegend.style.display = 'none';
}

export function clearLegendVisibility() {
  S.hiddenLegendItems.clear();
  S.selectedLegendItems.clear();
  S.customColors.clear();

  // Reset to default sorting state
  if (S.currentFieldType == 'categorical'){
    S.legendSortField = 'count';
    S.legendSortDirection = 'desc';
  } else {
    S.legendSortField = 'name';
    S.legendSortDirection = 'asc';
  }

  // Clear cached extrusion settings when legend visibility is cleared
  S.cachedExtrusionSettings = null;

  // Reapply the current visualization to show all items
  if (S.currentGeoJSON && S.currentField) {
    applyExtrusionWithVisibility();
  }
  _persistCurrentLayerState();
  _renderLayerList();
  updateFloatingLegend();
}

export function updateFloatingLegend() {
  if (!S.ui.isLegendVisible || !S.currentGeoJSON) return;

  // Clear previous content
  legendContent.replaceChildren();

  // Update title to just "Legend"
  legendTitle.textContent = 'Legend';

  if (!S.currentField) {
    // Show "No field selected" message
    const noFieldInfo = document.createElement('div');
    noFieldInfo.style.cssText = `
      font-size: 12px;
      color: #666;
      margin-bottom: 8px;
      padding: 4px 0;
      border-bottom: 1px solid #eee;
    `;
    noFieldInfo.innerHTML = `
      <div style="font-weight: 600; color: #333;">No field selected</div>
      <div>All parcels shown in gray</div>
    `;
    legendContent.appendChild(noFieldInfo);
    return;
  }

  // Add field name and type at the top of the legend content
  const fieldInfo = document.createElement('div');
  fieldInfo.style.cssText = `
    font-size: 12px;
    color: #666;
    margin-bottom: 8px;
    padding: 4px 0;
    border-bottom: 1px solid #eee;
  `;
  fieldInfo.innerHTML = `
    <div style="font-weight: 600; color: #333;">${S.currentField}</div>
    <div>Type: ${S.currentFieldType}</div>
  `;
  legendContent.appendChild(fieldInfo);

  // Add header bar with column headers
  const headerBar = document.createElement('div');
  headerBar.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px;
    margin-bottom: 4px;
    border-bottom: 1px solid #eee;
    font-size: 12px;
    font-weight: 600;
  `;

  function getLegendCategories() {
    const categories = new Set<string>();
    if (!S.currentGeoJSON) return categories;
    for (const feature of S.currentGeoJSON.features) {
      const value = feature.properties?.[S.currentField!];
      if (value != null && value !== '' && value !== undefined) {
        categories.add(String(value));
      }
    }
    return categories;
  }

  const isAllLegendHidden = () => {
    if (S.currentFieldType === 'categorical') {
      const categories = getLegendCategories();
      return categories.size > 0 && Array.from(categories).every(cat => S.hiddenLegendItems.has(cat));
    }
    const ranges = S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length
      ? S.colorBreaks.length + 1
      : 10;
    return Array.from({ length: ranges }, (_, i) => `range_${i}`).every(rangeKey => S.hiddenLegendItems.has(rangeKey));
  };

  // Eye toggle all button
  const eyeAllBtn = _createEyeButton(isAllLegendHidden(), 'Toggle all visibility');

  eyeAllBtn.onclick = () => {
    if (S.currentFieldType === 'categorical') {
      // Toggle all categorical items
      const categories = new Set<string>();
      for (const feature of S.currentGeoJSON!.features) {
        const value = feature.properties?.[S.currentField!];
        if (value != null && value !== '' && value !== undefined) {
          categories.add(String(value));
        }
      }

      const allHidden = Array.from(categories).every(cat => S.hiddenLegendItems.has(cat));
      if (allHidden) {
        // Show all
        categories.forEach(cat => S.hiddenLegendItems.delete(cat));
      } else {
        // Hide all
        categories.forEach(cat => S.hiddenLegendItems.add(cat));
      }
    } else {
      // Toggle all numeric ranges
      const ranges = S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length
        ? S.colorBreaks.length + 1
        : 10;

      const allHidden = Array.from({length: ranges}, (_, i) => `range_${i}`).every(rangeKey => S.hiddenLegendItems.has(rangeKey));
      if (allHidden) {
        // Show all
        for (let i = 0; i < ranges; i++) {
          S.hiddenLegendItems.delete(`range_${i}`);
        }
      } else {
        // Hide all
        for (let i = 0; i < ranges; i++) {
          S.hiddenLegendItems.add(`range_${i}`);
        }
      }
    }

    updateFloatingLegend();
    applyExtrusionWithVisibility();
  };



  const getLegendRanges = () => {
    const rangeBounds: { min: number; max: number; key: string }[] = [];
    if (!S.currentStats) return rangeBounds;
    if (S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length) {
      const breaks = [S.currentStats.min, ...S.colorBreaks, S.currentStats.max];
      for (let i = 0; i < breaks.length - 1; i++) {
        rangeBounds.push({ min: breaks[i], max: breaks[i + 1], key: `range_${i}` });
      }
    } else {
      const min = S.currentStats.min;
      const max = S.currentStats.max;
      const step = (max - min) / 10;
      for (let i = 0; i < 10; i++) {
        rangeBounds.push({
          min: min + (step * i),
          max: i === 9 ? max : min + (step * (i + 1)),
          key: `range_${i}`
        });
      }
    }
    return rangeBounds;
  };

  // Checkbox toggle all
  const checkboxAll = document.createElement('input');
  checkboxAll.type = 'checkbox';
  checkboxAll.style.cssText = `
    margin: 0;
    flex-shrink: 0;
  `;

  // Set initial state based on current selections
  if (S.currentFieldType === 'categorical') {
    const categories = getLegendCategories();
    checkboxAll.checked = categories.size > 0 && Array.from(categories).every(cat => S.selectedLegendItems.has(cat));
  } else {
    const ranges = S.colorMode === 'quantiles' && S.colorBreaks && S.colorBreaks.length
      ? S.colorBreaks.length + 1
      : 10;
    checkboxAll.checked = ranges > 0 && Array.from({length: ranges}, (_, i) => `range_${i}`).every(rangeKey => S.selectedLegendItems.has(rangeKey));
  }

  checkboxAll.onchange = () => {
    const sourceId = _getCurrentSourceId();
    if (!sourceId) return;
    if (S.currentFieldType === 'categorical') {
      const categories = getLegendCategories();
      categories.forEach(category => applyCategorySelection(category, checkboxAll.checked, sourceId));
    } else {
      const ranges = getLegendRanges();
      ranges.forEach(range => applyRangeSelection(range.key, range, checkboxAll.checked, sourceId));
    }

    updateSelectionControls();
    updateFloatingLegend(); // Refresh to update checkbox states
  };

  // Add blank space for swatch column
  const swatchSpacer = document.createElement('div');
  swatchSpacer.style.cssText = `
    width: 20px;
    flex-shrink: 0;
  `;

  // Add column headers as buttons
  const nameHeader = document.createElement('button');
  nameHeader.textContent = 'Name';
  nameHeader.style.cssText = `
    font-size: 12px;
    font-weight: 600;
    flex-grow: 1;
    margin-left: 8px;
    border: 1px solid #ccc;
    background: #f8f9fa;
    cursor: pointer;
    text-align: left;
    padding: 4px 6px;
    border-radius: 4px;
    transition: all 0.2s ease;
    color: #333;
  `;

  const countHeader = document.createElement('button');
  countHeader.textContent = '#';
  countHeader.style.cssText = `
    font-size: 12px;
    font-weight: 600;
    width: 30px;
    text-align: center;
    flex-shrink: 0;
    border: 1px solid #ccc;
    background: #f8f9fa;
    cursor: pointer;
    padding: 4px 6px;
    border-radius: 4px;
    transition: all 0.2s ease;
    color: #333;
  `;

  // Add sorting functionality
  nameHeader.onclick = () => {
    if (S.legendSortField === 'name') {
      S.legendSortDirection = S.legendSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      S.legendSortField = 'name';
      S.legendSortDirection = 'asc';
    }
    updateFloatingLegend();
    _persistCurrentLayerState();
  };

  countHeader.onclick = () => {
    if (S.legendSortField === 'count') {
      S.legendSortDirection = S.legendSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
      S.legendSortField = 'count';
      S.legendSortDirection = 'asc';
    }
    updateFloatingLegend();
    _persistCurrentLayerState();
  };

  // Add hover effects
  nameHeader.onmouseenter = () => {
    nameHeader.style.background = '#e9ecef';
    nameHeader.style.borderColor = '#adb5bd';
    nameHeader.style.transform = 'translateY(-1px)';
  };

  nameHeader.onmouseleave = () => {
    nameHeader.style.background = '#f8f9fa';
    nameHeader.style.borderColor = '#ccc';
    nameHeader.style.transform = 'translateY(0)';
  };

  countHeader.onmouseenter = () => {
    countHeader.style.background = '#e9ecef';
    countHeader.style.borderColor = '#adb5bd';
    countHeader.style.transform = 'translateY(-1px)';
  };

  countHeader.onmouseleave = () => {
    countHeader.style.background = '#f8f9fa';
    countHeader.style.borderColor = '#ccc';
    countHeader.style.transform = 'translateY(0)';
  };

  // Update button text to show sort indicators
  const updateSortIndicators = () => {
    nameHeader.textContent = 'Name';
    countHeader.textContent = '#';

    if (S.legendSortField === 'name') {
      nameHeader.textContent += S.legendSortDirection === 'asc' ? ' ↑' : ' ↓';
    } else if (S.legendSortField === 'count') {
      countHeader.textContent += S.legendSortDirection === 'asc' ? ' ↑' : ' ↓';
    }
  };

  updateSortIndicators();

  headerBar.appendChild(eyeAllBtn);
  headerBar.appendChild(checkboxAll);
  headerBar.appendChild(swatchSpacer);
  headerBar.appendChild(nameHeader);
  headerBar.appendChild(countHeader);
  legendContent.appendChild(headerBar);

  // Store references to update sort indicators later
  (legendContent as any)._nameHeader = nameHeader;
  (legendContent as any)._countHeader = countHeader;
  (legendContent as any)._updateSortIndicators = updateSortIndicators;

  if (S.currentFieldType === 'categorical') {
    updateCategoricalFloatingLegend();
  } else {
    updateNumericFloatingLegend();
  }
}

function updateCategoricalFloatingLegend() {
  if (!S.currentField || !S.currentGeoJSON) return;

  // Pre-calculate counts for all categories in a single pass
  const categoryCounts = new Map<string, number>();
  for (const feature of S.currentGeoJSON.features) {
    const value = feature.properties?.[S.currentField];
    if (value != null && value !== '' && value !== undefined) {
      const category = String(value);
      categoryCounts.set(category, (categoryCounts.get(category) || 0) + 1);
    }
  }

  let sortedCategories = Array.from(categoryCounts.keys());

  // Apply sorting if specified
  if (S.legendSortField === 'name') {
    sortedCategories.sort((a, b) => {
      const comparison = a.localeCompare(b);
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else if (S.legendSortField === 'count') {
    sortedCategories.sort((a, b) => {
      const countA = categoryCounts.get(a) || 0;
      const countB = categoryCounts.get(b) || 0;
      const comparison = countA - countB;
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else {
    // Default alphabetical sort
    sortedCategories.sort();
  }

  const pairs = _buildCategoricalColorPairs();
  const categoryToColor = new Map<string, string>();
  for (const pair of pairs) {
    const category : string = pair[0];
    const color : string = pair[1];
    categoryToColor.set(category, color);
  }

  let fallbackColor = '#888';
  if (S.categoricalColorMode === 'single') {
    fallbackColor = S.singleColorValue;
  }


  // Add search bar to legend
  const searchContainer = document.createElement('div');
  searchContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px;
  `;

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search categories...';
  searchInput.style.cssText = `
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 12px;
  `;

  searchContainer.appendChild(searchInput);
  legendContent.appendChild(searchContainer);

  // Create legend items
  sortedCategories.forEach(category => {
    const color = categoryToColor.get(category) || fallbackColor;
    const isHidden = S.hiddenLegendItems.has(category);
    const count = categoryCounts.get(category) || 0;

    const item = document.createElement('div');
    item.setAttribute('data-category', category);
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      border-radius: 4px;
      margin-bottom: 2px;
      ${isHidden ? 'opacity: 0.5;' : ''}
    `;

    // Color swatch
    const swatch = document.createElement('div');
    swatch.style.cssText = `
      width: 20px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid #ddd;
      background: ${color};
      flex-shrink: 0;
    `;

    // Category label
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 12px;
      flex-grow: 1;
      word-break: break-word;
    `;
    label.textContent = category;

    // Count display
    const countDisplay = document.createElement('div');
    countDisplay.style.cssText = `
      font-size: 12px;
      width: 30px;
      text-align: center;
      flex-shrink: 0;
      color: #666;
    `;
    countDisplay.textContent = count.toString();

     // Eye toggle button
     const eyeBtn = _createEyeButton(isHidden, isHidden ? 'Show this category' : 'Hide this category');

     eyeBtn.onclick = () => {
       if (S.hiddenLegendItems.has(category)) {
         S.hiddenLegendItems.delete(category);
       } else {
         S.hiddenLegendItems.add(category);
       }
       updateFloatingLegend();
       applyExtrusionWithVisibility();
     };

     // Selection checkbox
     const checkbox = document.createElement('input');
     checkbox.type = 'checkbox';
     checkbox.checked = S.selectedLegendItems.has(category);
     checkbox.style.cssText = `
       margin: 0;
       flex-shrink: 0;
     `;

     checkbox.onchange = () => {
       const sourceId = _getCurrentSourceId();
       if (!sourceId) return;
       applyCategorySelection(category, checkbox.checked, sourceId);
       updateSelectionControls();
       updateFloatingLegend(); // Refresh to update header checkbox state
     };

     // Make swatch clickable for color picker
     swatch.style.cursor = 'pointer';
     swatch.onclick = () => openSwatchColorPicker(category, color, swatch);

     item.appendChild(eyeBtn);
     item.appendChild(checkbox);
     item.appendChild(swatch);
     item.appendChild(label);
     item.appendChild(countDisplay);
     legendContent.appendChild(item);
  });

  // Update sort indicators
  if ((legendContent as any)._updateSortIndicators) {
    (legendContent as any)._updateSortIndicators();
  }

  // Add search functionality
  const filterCategories = (searchText: string) => {
    const items = legendContent.querySelectorAll('[data-category]');
    items.forEach(item => {
      const category = item.getAttribute('data-category') || '';
      const matches = category.toLowerCase().includes(searchText.toLowerCase());
      (item as HTMLElement).style.display = matches ? 'flex' : 'none';
    });
  };

  searchInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    filterCategories(target.value);
  });

}

function updateNumericFloatingLegend() {
  if (!S.currentField || !S.currentGeoJSON || !S.currentStats) return;

  const ranges = _buildNumericColorRanges();
  if (ranges.length === 0) return;

  // Convert ranges to the format expected by the legend
  const legendRanges: { min: number; max: number; color: string; label: string; rangeKey: string }[] = ranges.map(range => ({
    min: range.min,
    max: range.max,
    color: range.color,
    label: `${fmt(range.min)} - ${fmt(range.max)}`,
    rangeKey: range.rangeKey
  }));

  // Pre-calculate counts for all ranges in a single pass.
  // Bin by the *normalized* value (matching the breaks/stats and the map paint
  // expression) — counting the raw field value here would disagree with the
  // ranges whenever a per-area normalization mode is active.
  const rangeCounts = new Map<string, number>();
  for (const feature of S.currentGeoJSON!.features) {
    const numValue = normalizedValue(
      feature.properties as Record<string, unknown> | null,
      S.currentField!,
      S.normalizationMode
    );
    if (numValue === null) continue;
    // Find which range this value belongs to
    for (let i = 0; i < legendRanges.length; i++) {
      const range = legendRanges[i];
      if (numValue >= range.min && numValue <= range.max) {
        rangeCounts.set(range.rangeKey, (rangeCounts.get(range.rangeKey) || 0) + 1);
        break;
      }
    }
  }

  // Create array of range data with counts for sorting
  const rangeData = legendRanges.map((range, index) => {
    const rangeKey = range.rangeKey;
    const count = rangeCounts.get(rangeKey) || 0;
    return { range, index, rangeKey, count };
  });

  // Apply sorting if specified
  if (S.legendSortField === 'name') {
    rangeData.sort((a, b) => {
      // For numeric fields, sort by the actual numeric values (min value of each range)
      const comparison = a.range.min - b.range.min;
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  } else if (S.legendSortField === 'count') {
    rangeData.sort((a, b) => {
      const comparison = a.count - b.count;
      return S.legendSortDirection === 'asc' ? comparison : -comparison;
    });
  }

  // Add search bar to legend
  const searchContainer = document.createElement('div');
  searchContainer.style.cssText = `
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
    padding: 4px;
  `;

  const searchLabel = document.createElement('span');
  searchLabel.textContent = 'Find:';
  searchLabel.style.cssText = 'font-size: 12px;';

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = 'Search ranges...';
  searchInput.style.cssText = `
    flex: 1;
    padding: 4px 6px;
    border: 1px solid #ddd;
    border-radius: 4px;
    font-size: 12px;
  `;

  const clearButton = document.createElement('button');
  clearButton.textContent = 'Clear';
  clearButton.style.cssText = `
    padding: 4px 8px;
    border: 1px solid #ddd;
    background: #f8f8f8;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
  `;

  searchContainer.appendChild(searchLabel);
  searchContainer.appendChild(searchInput);
  searchContainer.appendChild(clearButton);
  legendContent.appendChild(searchContainer);

  // Create legend items
  rangeData.forEach(({ range, rangeKey, count }) => {
    const isHidden = S.hiddenLegendItems.has(rangeKey);

    // Color is already applied from the inner function
    const color = range.color;

    const item = document.createElement('div');
    item.setAttribute('data-range', range.label);
    item.style.cssText = `
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px;
      border-radius: 4px;
      margin-bottom: 2px;
      ${isHidden ? 'opacity: 0.5;' : ''}
    `;

    // Color swatch
    const swatch = document.createElement('div');
    swatch.style.cssText = `
      width: 20px;
      height: 16px;
      border-radius: 3px;
      border: 1px solid #ddd;
      background: ${color};
      flex-shrink: 0;
    `;

    // Range label
    const label = document.createElement('div');
    label.style.cssText = `
      font-size: 12px;
      flex-grow: 1;
    `;
    label.textContent = range.label;

    // Count display
    const countDisplay = document.createElement('div');
    countDisplay.style.cssText = `
      font-size: 12px;
      width: 30px;
      text-align: center;
      flex-shrink: 0;
      color: #666;
    `;
    countDisplay.textContent = count.toString();

         // Eye toggle button
     const eyeBtn = _createEyeButton(isHidden, isHidden ? 'Show this range' : 'Hide this range');

     eyeBtn.onclick = () => {
       if (S.hiddenLegendItems.has(rangeKey)) {
         S.hiddenLegendItems.delete(rangeKey);
       } else {
         S.hiddenLegendItems.add(rangeKey);
       }
       updateFloatingLegend();
       applyExtrusionWithVisibility();
     };

     // Selection checkbox
     const checkbox = document.createElement('input');
     checkbox.type = 'checkbox';
     checkbox.checked = S.selectedLegendItems.has(rangeKey);
     checkbox.style.cssText = `
       margin: 0;
       flex-shrink: 0;
     `;

     checkbox.onchange = () => {
       const sourceId = _getCurrentSourceId();
       if (!sourceId) return;
       applyRangeSelection(rangeKey, range, checkbox.checked, sourceId);
       updateSelectionControls();
       updateFloatingLegend(); // Refresh to update header checkbox state
     };

     // Make swatch clickable for color picker
     swatch.style.cursor = 'pointer';
     swatch.onclick = () => openSwatchColorPicker(rangeKey, color, swatch);

     item.appendChild(eyeBtn);
     item.appendChild(checkbox);
     item.appendChild(swatch);
     item.appendChild(label);
     item.appendChild(countDisplay);
     legendContent.appendChild(item);
  });

  // Update sort indicators
  if ((legendContent as any)._updateSortIndicators) {
    (legendContent as any)._updateSortIndicators();
  }

  // Add search functionality
  const filterRanges = (searchText: string) => {
    const items = legendContent.querySelectorAll('[data-range]');
    items.forEach(item => {
      const rangeLabel = item.getAttribute('data-range') || '';
      const matches = rangeLabel.toLowerCase().includes(searchText.toLowerCase());
      (item as HTMLElement).style.display = matches ? 'flex' : 'none';
    });
  };

  searchInput.addEventListener('input', (e) => {
    const target = e.target as HTMLInputElement;
    filterRanges(target.value);
  });

  clearButton.addEventListener('click', () => {
    searchInput.value = '';
    filterRanges('');
  });
}

// Custom color overrides for individual legend items

function openSwatchColorPicker(itemKey: string, currentColor: string, swatchElement: HTMLElement) {
  // Create a temporary color input
  const colorInput = document.createElement('input');
  colorInput.type = 'color';
  colorInput.value = currentColor;
  colorInput.style.cssText = `
    position: fixed;
    z-index: 10000;
    opacity: 0;
    pointer-events: none;
  `;

  // Position the color picker over the swatch using fixed positioning
  const rect = swatchElement.getBoundingClientRect();
  colorInput.style.left = `${rect.left}px`;
  colorInput.style.top = `${rect.top}px`;
  colorInput.style.width = `${rect.width}px`;
  colorInput.style.height = `${rect.height}px`;

  document.body.appendChild(colorInput);

  colorInput.addEventListener('change', () => {
    const newColor = colorInput.value;
    S.customColors.set(itemKey, newColor);

    // Update the visualization
    applyExtrusionWithCustomColors();
    updateFloatingLegend();

    document.body.removeChild(colorInput);
  });

  colorInput.addEventListener('blur', () => {
    // If user cancels, remove the input
    if (document.body.contains(colorInput)) {
      document.body.removeChild(colorInput);
    }
  });

  // Trigger the color picker
  colorInput.click();
}

export function applyExtrusionWithCustomColors() {
  if (!S.currentGeoJSON || !S.currentField) return;
  const ids = _getCurrentLayerIds();
  if (!ids) return;

  // If we have custom colors, we need to rebuild the color expression
  if (S.customColors.size > 0) {
    let colorExpr: any;

    if (S.currentFieldType === 'categorical') {
      colorExpr = _buildCategoricalColorExpression();
    } else {
      colorExpr = _buildNumericColorExpression();
    }

    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);

    // Apply height and opacity for numeric fields
    if (S.currentFieldType === 'numeric') {
      const multiplier = _getMultiplierValue();
      const unitFactor = _getUnitFactor();
      const valueExpr = _buildValueExpression();
      const heightExpr: any = S.is3DMode ? ['*', valueExpr, multiplier * unitFactor] : 0;

      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', heightExpr);
    } else {
      S.map.setPaintProperty(ids.layerId, 'fill-extrusion-height', 0);
    }

    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-opacity', _getOpacityValue());
  } else {
    // No custom colors, use normal extrusion
    _applyExtrusion();
  }
}

export function applyExtrusionWithVisibility() {
  if (!S.currentGeoJSON || !S.currentField) return;

  // Use custom colors if available, otherwise normal extrusion
  if (S.customColors.size > 0) {
    applyExtrusionWithCustomColors();
  } else {
    _applyExtrusion();
  }
  applyVisibilityFilters();
}

export function updateHighlightColors() {
  const ids = _getCurrentLayerIds();
  if (!ids) return;
  if (S.currentFieldType === 'categorical') {
    const colorExpr = _buildCategoricalColorExpression();
    S.map.setPaintProperty(ids.layerId, 'fill-extrusion-color', colorExpr);
  } else {
    _applyExtrusion();
  }
}

export function updateLegendPosition() {
  // Intentionally no-op: floating windows should not reposition each other.
}
