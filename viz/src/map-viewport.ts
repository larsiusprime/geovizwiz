import maplibregl from 'maplibre-gl';

import { S } from './state';

type ScreenRect = { left: number; top: number; right: number; bottom: number };

type PaddingOptions = {
  inset?: number;
};

type CenterOptions = PaddingOptions & {
  duration?: number;
  essential?: boolean;
};

type FitOptions = PaddingOptions & {
  duration?: number;
  maxZoom?: number;
  essential?: boolean;
};

const MAP_VIEWPORT_DEBUG = true;

function debugLog(message: string, payload?: Record<string, unknown>) {
  if (!MAP_VIEWPORT_DEBUG) return;
  if (payload) console.debug(`[map-viewport] ${message}`, payload);
  else console.debug(`[map-viewport] ${message}`);
}

function clampLat(lat: number) {
  return Math.max(-85.05112878, Math.min(85.05112878, lat));
}

function lngLatToMercatorUnit(lng: number, lat: number) {
  const x = (lng + 180) / 360;
  const clampedLat = clampLat(lat);
  const rad = (clampedLat * Math.PI) / 180;
  const y = (1 - Math.log(Math.tan(rad) + (1 / Math.cos(rad))) / Math.PI) / 2;
  return { x, y };
}

function mercatorUnitToLngLat(x: number, y: number) {
  const lng = ((x % 1) + 1) % 1 * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lng, lat };
}

function easeToBoundsApproximation(
  normalizedBounds: maplibregl.LngLatBounds,
  padding: { top: number; right: number; bottom: number; left: number },
  options: FitOptions,
) {
  const width = S.map.getContainer().clientWidth;
  const height = S.map.getContainer().clientHeight;
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;

  if (!(innerWidth > 2 && innerHeight > 2)) {
    console.error('[map-viewport] approximation aborted: non-positive inner viewport', { width, height, padding, innerWidth, innerHeight });
    return false;
  }

  const sw = normalizedBounds.getSouthWest();
  const ne = normalizedBounds.getNorthEast();

  let spanLng = ne.lng - sw.lng;
  if (spanLng < 0) spanLng += 360;
  const mSw = lngLatToMercatorUnit(sw.lng, sw.lat);
  const mNe = lngLatToMercatorUnit(sw.lng + spanLng, ne.lat);
  const spanX = Math.max(1e-12, mNe.x - mSw.x);
  const spanY = Math.max(1e-12, Math.abs(mNe.y - mSw.y));

  const tileSize = 512;
  const zoomX = Math.log2(innerWidth / (tileSize * spanX));
  const zoomY = Math.log2(innerHeight / (tileSize * spanY));
  const zoomRaw = Math.min(zoomX, zoomY);

  const maxZoom = Number.isFinite(options.maxZoom as number) ? Number(options.maxZoom) : S.map.getMaxZoom();
  const minZoom = S.map.getMinZoom();
  const zoom = Math.max(minZoom, Math.min(maxZoom, Number.isFinite(zoomRaw) ? zoomRaw : S.map.getZoom()));

  const centerMercatorX = mSw.x + spanX / 2;
  const centerMercatorY = Math.min(1, Math.max(0, Math.min(mSw.y, mNe.y) + spanY / 2));
  const center = mercatorUnitToLngLat(centerMercatorX, centerMercatorY);

  debugLog('fitBounds approximation camera', {
    sw,
    ne,
    padding,
    innerWidth,
    innerHeight,
    spanX,
    spanY,
    zoom,
    center,
  });

  S.map.easeTo({
    center,
    zoom,
    padding,
    duration: options.duration ?? 700,
    essential: options.essential ?? true,
  });
  return true;
}

function isRectValid(rect: ScreenRect) {
  return Number.isFinite(rect.left)
    && Number.isFinite(rect.top)
    && Number.isFinite(rect.right)
    && Number.isFinite(rect.bottom)
    && rect.right > rect.left
    && rect.bottom > rect.top;
}

function intersects(a: ScreenRect, b: ScreenRect): ScreenRect | null {
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right);
  const bottom = Math.min(a.bottom, b.bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, right, bottom };
}

function getMapRect(): ScreenRect | null {
  const mapEl = document.getElementById('map');
  if (!mapEl) return null;
  const rect = mapEl.getBoundingClientRect();
  const out = { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  return isRectValid(out) ? out : null;
}

function isElementVisible(el: HTMLElement) {
  const style = window.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (Number.parseFloat(style.opacity || '1') < 1) return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

export function isModalLayerOpen() {
  const overlays = Array.from(document.querySelectorAll<HTMLElement>('.overlay.show'));
  return overlays.some((overlay) => isElementVisible(overlay));
}

function getFloatingMenuOccluders(mapRect: ScreenRect): ScreenRect[] {
  const windows = Array.from(document.querySelectorAll<HTMLElement>('.viz-window'));
  const occluders: ScreenRect[] = [];

  windows.forEach((windowEl) => {
    if (windowEl.classList.contains('is-pinned')) return;
    if (!isElementVisible(windowEl)) return;
    const rect = windowEl.getBoundingClientRect();
    const clipped = intersects(mapRect, {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
    });
    if (!clipped) return;
    occluders.push(clipped);
  });

  return occluders;
}

function uniqueSorted(values: number[]) {
  return Array.from(new Set(values.map((value) => Math.round(value)))).sort((a, b) => a - b);
}

export function getLargestUnobscuredMapRect(): ScreenRect | null {
  const mapRect = getMapRect();
  if (!mapRect) return null;

  const occluders = getFloatingMenuOccluders(mapRect);
  if (occluders.length === 0) return mapRect;

  const xs = uniqueSorted([mapRect.left, mapRect.right, ...occluders.flatMap((r) => [r.left, r.right])]);
  const ys = uniqueSorted([mapRect.top, mapRect.bottom, ...occluders.flatMap((r) => [r.top, r.bottom])]);
  if (xs.length < 2 || ys.length < 2) return mapRect;

  const cols = xs.length - 1;
  const rows = ys.length - 1;
  const blocked: boolean[][] = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));

  for (let r = 0; r < rows; r += 1) {
    const cy = (ys[r] + ys[r + 1]) / 2;
    for (let c = 0; c < cols; c += 1) {
      const cx = (xs[c] + xs[c + 1]) / 2;
      blocked[r][c] = occluders.some((occ) => cx >= occ.left && cx <= occ.right && cy >= occ.top && cy <= occ.bottom);
    }
  }

  let bestArea = 0;
  let bestRect: ScreenRect | null = null;

  for (let top = 0; top < rows; top += 1) {
    const colBlocked = Array<boolean>(cols).fill(false);
    for (let bottom = top; bottom < rows; bottom += 1) {
      for (let c = 0; c < cols; c += 1) {
        colBlocked[c] = colBlocked[c] || blocked[bottom][c];
      }

      const height = ys[bottom + 1] - ys[top];
      let segStart = -1;
      let segWidth = 0;

      for (let c = 0; c <= cols; c += 1) {
        const isOpen = c < cols ? !colBlocked[c] : false;
        if (isOpen) {
          if (segStart === -1) {
            segStart = c;
            segWidth = 0;
          }
          segWidth += xs[c + 1] - xs[c];
        } else if (segStart !== -1) {
          const area = segWidth * height;
          if (area > bestArea) {
            bestArea = area;
            bestRect = {
              left: xs[segStart],
              right: xs[c],
              top: ys[top],
              bottom: ys[bottom + 1],
            };
          }
          segStart = -1;
          segWidth = 0;
        }
      }
    }
  }

  return bestRect && isRectValid(bestRect) ? bestRect : mapRect;
}

function getPaddingForRect(targetRect: ScreenRect, options: PaddingOptions = {}) {
  const mapRect = getMapRect();
  if (!mapRect) {
    debugLog('getPaddingForRect fallback: no map rect');
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const inset = Math.max(0, options.inset ?? 0);
  const rawTop = targetRect.top - mapRect.top;
  const rawRight = mapRect.right - targetRect.right;
  const rawBottom = mapRect.bottom - targetRect.bottom;
  const rawLeft = targetRect.left - mapRect.left;

  const mapWidth = Math.max(1, mapRect.right - mapRect.left);
  const mapHeight = Math.max(1, mapRect.bottom - mapRect.top);

  let top = Math.max(0, Math.round(rawTop + inset));
  let right = Math.max(0, Math.round(rawRight + inset));
  let bottom = Math.max(0, Math.round(rawBottom + inset));
  let left = Math.max(0, Math.round(rawLeft + inset));

  const maxHoriz = Math.max(0, Math.floor(mapWidth) - 2);
  const maxVert = Math.max(0, Math.floor(mapHeight) - 2);

  if (left + right > maxHoriz) {
    const scale = maxHoriz <= 0 ? 0 : maxHoriz / (left + right);
    left = Math.floor(left * scale);
    right = Math.floor(right * scale);
    debugLog('horizontal padding clamped', { left, right, maxHoriz, mapWidth });
  }

  if (top + bottom > maxVert) {
    const scale = maxVert <= 0 ? 0 : maxVert / (top + bottom);
    top = Math.floor(top * scale);
    bottom = Math.floor(bottom * scale);
    debugLog('vertical padding clamped', { top, bottom, maxVert, mapHeight });
  }

  const padding = { top, right, bottom, left };
  debugLog('computed padding for target rect', { mapRect, targetRect, inset, padding });
  return padding;
}

function getVisibleMapPadding(options: PaddingOptions = {}) {
  const rect = getLargestUnobscuredMapRect();
  if (!rect) {
    debugLog('visible map padding fallback: no unobscured rect');
    return { top: 0, right: 0, bottom: 0, left: 0 };
  }
  const padding = getPaddingForRect(rect, options);
  debugLog('visible map padding resolved', { rect, padding });
  return padding;
}

export function centerOnLngLatInVisibleMapArea(
  lngLat: maplibregl.LngLatLike,
  options: CenterOptions = {},
) {
  if (!S.map) {
    debugLog('center aborted: map is not initialized');
    return false;
  }
  if (isModalLayerOpen()) {
    debugLog('center aborted: modal layer open');
    return false;
  }

  const padding = getVisibleMapPadding({ inset: options.inset ?? 8 });
  debugLog('center request', {
    lngLat,
    duration: options.duration ?? 500,
    inset: options.inset ?? 8,
    padding,
    zoom: S.map.getZoom(),
    bearing: S.map.getBearing(),
    pitch: S.map.getPitch(),
  });

  S.map.easeTo({
    center: lngLat,
    padding,
    duration: options.duration ?? 500,
    essential: options.essential ?? true,
  });
  return true;
}

export function fitBoundsInVisibleMapArea(
  bounds: maplibregl.LngLatBoundsLike,
  options: FitOptions = {},
) {
  if (!S.map) {
    debugLog('fitBounds aborted: map is not initialized');
    return false;
  }
  if (isModalLayerOpen()) {
    debugLog('fitBounds aborted: modal layer open');
    return false;
  }

  const padding = getVisibleMapPadding({ inset: options.inset ?? 24 });
  const transform = (S.map as any).transform;
  debugLog('fitBounds map transform snapshot', {
    width: transform?.width,
    height: transform?.height,
    center: transform?.center,
    zoom: transform?.zoom,
    pitch: transform?.pitch,
    bearing: transform?.bearing,
  });

  let normalizedBounds: maplibregl.LngLatBounds;
  try {
    normalizedBounds = maplibregl.LngLatBounds.convert(bounds);
  } catch (error) {
    console.error('[map-viewport] fitBounds rejected invalid input bounds', { bounds, error });
    return false;
  }

  const sw = normalizedBounds.getSouthWest();
  const ne = normalizedBounds.getNorthEast();
  const boundsAreFinite = [sw.lng, sw.lat, ne.lng, ne.lat].every(Number.isFinite);
  if (!boundsAreFinite) {
    console.error('[map-viewport] fitBounds aborted: non-finite normalized bounds', { sw, ne, bounds });
    return false;
  }

  debugLog('fitBounds request', {
    sw,
    ne,
    padding,
    inset: options.inset ?? 24,
    duration: options.duration ?? 700,
    maxZoom: options.maxZoom,
    zoom: S.map.getZoom(),
    bearing: S.map.getBearing(),
    pitch: S.map.getPitch(),
  });

  try {
    S.map.fitBounds(normalizedBounds, {
      padding,
      duration: options.duration ?? 700,
      maxZoom: options.maxZoom,
      essential: options.essential ?? true,
    });
  } catch (error) {
    console.error('[map-viewport] fitBounds threw unexpectedly', {
      sw,
      ne,
      padding,
      duration: options.duration ?? 700,
      maxZoom: options.maxZoom,
      currentPitch: S.map.getPitch(),
      currentBearing: S.map.getBearing(),
      error,
    });

    // Fallback path: compute camera with pitch=0 to avoid known fitBounds failures
    // in highly pitched views + asymmetric padding, then ease to that camera.
    try {
      const fallbackCamera = S.map.cameraForBounds(normalizedBounds, {
        padding,
        maxZoom: options.maxZoom,
        bearing: S.map.getBearing(),
        pitch: 0,
      });

      const fallbackCenter = fallbackCamera?.center;
      const fallbackZoom = fallbackCamera?.zoom;
      const isFallbackValid = Boolean(fallbackCenter)
        && Number.isFinite(fallbackCenter.lng)
        && Number.isFinite(fallbackCenter.lat)
        && Number.isFinite(fallbackZoom);

      if (!isFallbackValid) {
        console.error('[map-viewport] fallback camera invalid', { fallbackCamera, padding, sw, ne });
        return false;
      }

      console.warn('[map-viewport] fitBounds fallback engaged (pitch flattened to 0)', {
        sw,
        ne,
        padding,
        fallbackCenter,
        fallbackZoom,
      });

      S.map.easeTo({
        center: fallbackCenter,
        zoom: fallbackZoom,
        bearing: S.map.getBearing(),
        pitch: 0,
        duration: options.duration ?? 700,
        essential: options.essential ?? true,
      });
      return true;
    } catch (fallbackError) {
      console.error('[map-viewport] fitBounds fallback also failed', {
        sw,
        ne,
        padding,
        fallbackError,
      });
      // Final fallback: approximation path that does not invoke fitBounds/cameraForBounds.
      try {
        const approximated = easeToBoundsApproximation(normalizedBounds, padding, options);
        if (!approximated) return false;
        console.warn('[map-viewport] fitBounds approximation fallback engaged');
        return true;
      } catch (approximationError) {
        console.error('[map-viewport] approximation fallback also failed', {
          sw,
          ne,
          padding,
          approximationError,
        });
        return false;
      }
    }
  }
  return true;
}
