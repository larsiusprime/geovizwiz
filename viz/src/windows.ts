/**
 * Window management functions extracted from main.ts.
 * Provides a generic createWindowManager helper plus all
 * panel-specific position/toggle/minimize/show functions.
 */
import { S } from './state';

// ---------------------------------------------------------------------------
// Generic window manager
// ---------------------------------------------------------------------------

export type WindowConfig = {
  getMinimized: () => boolean;
  setMinimized: (v: boolean) => void;
  contentEl: HTMLElement;
  controlsEl: HTMLElement;
  contentDisplay?: string; // defaults to 'grid'
  positionFn?: () => void;
  onShow?: () => void;
  onMinimize?: () => void;
};

export type WindowManager = {
  minimize: () => void;
  show: () => void;
  toggle: () => void;
};

let _updateToolbarButtonStates: () => void = () => {};
let _updateLegendPosition: () => void = () => {};
let _onPinnedStateChanged: (element: HTMLElement, pinned: boolean) => void = () => {};

type DockableWindow = {
  element: HTMLElement;
  pinButton: HTMLButtonElement;
  collapseButton: HTMLButtonElement | null;
};

type ResizeMode = 'both' | 'x' | 'y';

const PINNED_GAP_FALLBACK = 8;
const PINNED_GUTTER = 8;
const MIN_WINDOW_WIDTH = 240;
const MIN_WINDOW_HEIGHT = 160;
const WINDOW_STACK_BASE = 20;
const MODAL_STACK_BASE = 3000;
const WINDOW_STACK_MAX = MODAL_STACK_BASE - 1;
const WINDOW_MARGIN = 10;

let pinnedContainer: HTMLDivElement | null = null;
let appContainer: HTMLElement | null = null;
let dockableWindows: DockableWindow[] = [];
let isResizing = false;
let resizeTarget: HTMLElement | null = null;
let resizeMode: ResizeMode = 'both';
let resizeStartX = 0;
let resizeStartY = 0;
let resizeStartWidth = 0;
let resizeStartHeight = 0;
let resizeMinHeight = MIN_WINDOW_HEIGHT;
let lastMouseX = 0;
let lastMouseY = 0;
let isColumnResizing = false;
let resizeColumn: HTMLDivElement | null = null;
let columnResizeStartX = 0;
let columnResizeStartWidth = 0;
const columnWidthOverrides = new Map<number, number>();
let windowZCounter = WINDOW_STACK_BASE;

function isDockDebugEnabled() {
  try {
    return window.localStorage.getItem('vizDebugDock') === '1'
      || (window as Window & { __vizDebugDock?: boolean }).__vizDebugDock === true;
  } catch {
    return false;
  }
}

function logDockLayout(context: string) {
  if (!pinnedContainer || !isDockDebugEnabled()) return;
  const columns = Array.from(pinnedContainer.querySelectorAll('.pinned-column')) as HTMLDivElement[];
  const rows = columns.map((column) => {
    const windowContainer = getColumnWindowContainer(column);
    const columnRect = column.getBoundingClientRect();
    const containerRect = windowContainer.getBoundingClientRect();
    return {
      context,
      columnIndex: getColumnIndex(column),
      columnStyleWidth: column.style.width || '(auto)',
      columnRectWidth: Math.round(columnRect.width),
      windowContainerWidth: Math.round(containerRect.width),
      measuredGutter: Math.round(columnRect.width - containerRect.width),
      cssGutter: window.getComputedStyle(column).getPropertyValue('--pinned-gutter').trim(),
      windows: getColumnWindows(column).map((win) => ({
        id: win.id,
        styleWidth: win.style.width || '(auto)',
        rectWidth: Math.round(win.getBoundingClientRect().width),
      })),
    };
  });
  console.debug('[dock-layout]', rows);
}

/** Must be called once from main.ts to wire in the callbacks. */
export function initWindowCallbacks(callbacks: {
  updateToolbarButtonStates: () => void;
  updateLegendPosition: () => void;
  onPinnedStateChanged?: (element: HTMLElement, pinned: boolean) => void;
}) {
  _updateToolbarButtonStates = callbacks.updateToolbarButtonStates;
  _updateLegendPosition = callbacks.updateLegendPosition;
  _onPinnedStateChanged = callbacks.onPinnedStateChanged ?? (() => {});
}

export function initWindowDocking(config: {
  pinnedContainer: HTMLDivElement;
  appContainer: HTMLElement;
}) {
  pinnedContainer = config.pinnedContainer;
  appContainer = config.appContainer;
  try {
    const localStorageFlag = window.localStorage.getItem('vizDebugDock');
    const runtimeFlag = (window as Window & { __vizDebugDock?: boolean }).__vizDebugDock === true;
    const enabled = isDockDebugEnabled();
    console.info('[dock-layout] debug', {
      enabled,
      localStorageVizDebugDock: localStorageFlag,
      runtimeVizDebugDock: runtimeFlag,
      enableHint: "Set localStorage.vizDebugDock='1' (or window.__vizDebugDock=true) and reload.",
    });
  } catch {
    // no-op for environments where console/localStorage access is restricted
  }
  updatePinnedLayout();
  window.addEventListener('resize', () => updatePinnedLayout());
}

export function registerDockableWindow(windowEl: HTMLElement, pinButton: HTMLButtonElement) {
  const collapseButton = ensurePinnedCollapseButton(windowEl);
  dockableWindows.push({ element: windowEl, pinButton, collapseButton });
  pinButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePinnedState(windowEl);
  });
  collapseButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePinnedCollapsed(windowEl);
  });
  const minWidth = getWindowRequiredMinWidth(windowEl);
  const storedMin = Number(windowEl.dataset.minWidth ?? MIN_WINDOW_WIDTH);
  windowEl.dataset.minWidth = `${Math.max(storedMin, minWidth)}`;
  updatePinButtonState(windowEl);
}

function ensurePinnedCollapseButton(windowEl: HTMLElement) {
  const header = windowEl.querySelector('.window-header') as HTMLElement | null;
  if (!header) return null;
  const existing = header.querySelector('.window-pin-collapse') as HTMLButtonElement | null;
  if (existing) return existing;
  const button = document.createElement('button');
  button.className = 'window-pin-collapse';
  button.type = 'button';
  button.textContent = '▼';
  button.title = 'Collapse pinned menu';
  button.setAttribute('aria-expanded', 'true');
  const firstChild = header.firstElementChild;
  if (firstChild) {
    header.insertBefore(button, firstChild);
  } else {
    header.appendChild(button);
  }
  return button;
}

export function enableWindowResizing(windowEl: HTMLElement) {
  const handle = windowEl.querySelector('.window-resize-handle') as HTMLElement | null;
  const edge = windowEl.querySelector('.window-resize-edge') as HTMLElement | null;
  const contentEl = windowEl.querySelector('[data-window-content]') as HTMLElement | null;

  const startResize = (mode: ResizeMode) => (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    isResizing = true;
    resizeTarget = windowEl;
    resizeMode = mode;
    resizeStartX = event.clientX;
    resizeStartY = event.clientY;
    const rect = windowEl.getBoundingClientRect();
    resizeStartWidth = rect.width;
    resizeStartHeight = rect.height;
    resizeMinHeight = getMinWindowHeight(windowEl);
    document.body.style.userSelect = 'none';
  };

  handle?.addEventListener('mousedown', startResize('both'));
  edge?.addEventListener('mousedown', startResize('x'));

  if (contentEl) {
    const observer = new ResizeObserver(() => {
      // Keep height/layout in sync, but do not ratchet min-width from observed
      // scroll width; that prevents floating windows from being shrunk later.
      windowEl.dataset.minWidth = `${getWindowRequiredMinWidth(windowEl)}`;
      ensureWindowMinHeight(windowEl);
      if (isPinned(windowEl)) {
        updatePinnedLayout();
      }
    });
    observer.observe(contentEl);
  }
}

export function createWindowManager(config: WindowConfig): WindowManager {
  const display = config.contentDisplay ?? 'grid';

  function minimize() {
    config.setMinimized(true);
    config.contentEl.style.display = 'none';
    config.controlsEl.style.display = 'none';
    config.onMinimize?.();
    if (isPinned(config.controlsEl)) {
      updatePinnedLayout();
    }
    _updateToolbarButtonStates();
  }

  function show() {
    config.setMinimized(false);
    config.contentEl.style.display = display;
    config.controlsEl.style.display = 'grid';
    if (isPinned(config.controlsEl) && pinnedContainer && !pinnedContainer.contains(config.controlsEl)) {
      restorePinnedWindow(config.controlsEl);
    } else {
      config.positionFn?.();
    }
    config.onShow?.();
    if (!isPinned(config.controlsEl)) {
      placeFloatingWindow(config.controlsEl);
    }
    bringWindowToFront(config.controlsEl);
    ensureWindowMinHeight(config.controlsEl);
    if (isPinned(config.controlsEl)) {
      updatePinnedLayout();
    }
    _updateToolbarButtonStates();
  }

  function toggle() {
    if (config.getMinimized()) show();
    else minimize();
  }

  return { minimize, show, toggle };
}

// ---------------------------------------------------------------------------
// Position helpers
// ---------------------------------------------------------------------------

export type PositionElements = {
  controlsEl: HTMLDivElement;
  settingsControlsEl: HTMLDivElement;
  statisticsControlsEl: HTMLDivElement;
  scatterplotControlsEl: HTMLDivElement;
  filtersControlsEl: HTMLDivElement;
  filtersContent: HTMLDivElement;
  filtersListEl: HTMLDivElement;
  landScheduleControlsEl: HTMLDivElement;
  timeAdjustmentControlsEl: HTMLDivElement;
};

let els: PositionElements;

/** Must be called once from main.ts to pass in the DOM elements. */
export function initPositionElements(elements: PositionElements) {
  els = elements;
}

export function refreshWindowMinHeight(element: HTMLElement) {
  element.style.height = '';
  ensureWindowMinHeight(element);
}

export function refreshWindowMinWidth(element: HTMLElement) {
  const minWidth = getMinWindowWidth(element);
  const contentWidth = element.scrollWidth;
  element.style.width = `${Math.max(minWidth, contentWidth, element.offsetWidth)}px`;
}

function getMapRect() {
  const mapEl = document.getElementById('map');
  return mapEl?.getBoundingClientRect() ?? {
    left: getDockRightEdge(),
    top: 0,
    right: window.innerWidth,
    bottom: window.innerHeight,
    width: window.innerWidth - getDockRightEdge(),
    height: window.innerHeight,
    x: getDockRightEdge(),
    y: 0,
    toJSON: () => ({}),
  };
}

function getWindowClampBounds(target: HTMLElement) {
  const mapRect = getMapRect();
  const targetRect = target.getBoundingClientRect();
  return {
    minLeft: mapRect.left,
    maxLeft: Math.max(mapRect.left, mapRect.right - targetRect.width),
    minTop: mapRect.top,
  };
}

function clampWindowWithinBounds(target: HTMLElement) {
  if (isPinned(target)) return;
  const { minLeft, maxLeft, minTop } = getWindowClampBounds(target);
  const rect = target.getBoundingClientRect();
  const nextLeft = Math.max(minLeft, Math.min(rect.left, maxLeft));
  const nextTop = Math.max(minTop, rect.top);
  target.style.left = `${nextLeft}px`;
  target.style.top = `${nextTop}px`;
  target.style.transform = 'none';
}

function getVisibleFloatingWindows(exclude?: HTMLElement) {
  return Array.from(document.querySelectorAll<HTMLElement>('.viz-window'))
    .filter(el => el !== exclude)
    .filter(el => !isPinned(el))
    .filter(el => window.getComputedStyle(el).display !== 'none');
}

function getAnchorPosition(target: HTMLElement) {
  const mapRect = getMapRect();
  const targetRect = target.getBoundingClientRect();
  const preferRight = target.id === 'floatingLegend';
  const left = preferRight
    ? Math.max(mapRect.left, mapRect.right - targetRect.width - WINDOW_MARGIN)
    : mapRect.left + WINDOW_MARGIN;
  const top = mapRect.top + WINDOW_MARGIN;
  return { left, top };
}

function getHeaderHeight(windowEl: HTMLElement) {
  const header = windowEl.querySelector('.window-header') as HTMLElement | null;
  const height = header?.getBoundingClientRect().height ?? 0;
  return Math.max(24, Math.round(height));
}

function rectsOverlap(a: DOMRect, b: DOMRect) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function candidateOverlaps(candidate: { left: number; top: number }, target: HTMLElement, windows: HTMLElement[]) {
  const rect = target.getBoundingClientRect();
  const candidateRect = {
    left: candidate.left,
    top: candidate.top,
    right: candidate.left + rect.width,
    bottom: candidate.top + rect.height,
  };
  return windows.some((win) => {
    const r = win.getBoundingClientRect();
    return candidateRect.left < r.right
      && candidateRect.right > r.left
      && candidateRect.top < r.bottom
      && candidateRect.bottom > r.top;
  });
}

function findUnoccupiedPosition(target: HTMLElement, anchor: { left: number; top: number }) {
  const windows = getVisibleFloatingWindows(target);
  if (windows.length === 0) {
    return anchor;
  }

  const { minLeft, maxLeft, minTop } = getWindowClampBounds(target);
  const mapRect = getMapRect();
  const targetRect = target.getBoundingClientRect();
  const stepX = 28;
  const stepY = Math.max(24, getHeaderHeight(target));
  const maxTop = Math.max(minTop, mapRect.bottom - targetRect.height);
  const preferRight = target.id === 'floatingLegend';
  const clampedAnchorLeft = Math.max(minLeft, Math.min(anchor.left, maxLeft));

  const xs: number[] = [];
  if (preferRight) {
    for (let left = clampedAnchorLeft; left >= minLeft; left -= stepX) xs.push(left);
  } else {
    for (let left = clampedAnchorLeft; left <= maxLeft; left += stepX) xs.push(left);
  }
  if (!xs.includes(clampedAnchorLeft)) {
    xs.unshift(clampedAnchorLeft);
  }

  for (let top = minTop; top <= maxTop; top += stepY) {
    for (const left of xs) {
      const candidate = { left, top };
      if (!candidateOverlaps(candidate, target, windows)) {
        return candidate;
      }
    }
  }

  return null;
}

function findOffsetOverlapPosition(target: HTMLElement, anchor: { left: number; top: number }) {
  const windows = getVisibleFloatingWindows(target);
  const { minLeft, maxLeft, minTop } = getWindowClampBounds(target);
  let nextLeft = Math.max(minLeft, Math.min(anchor.left, maxLeft));
  let nextTop = Math.max(minTop, anchor.top);

  let safety = 0;
  while (safety < 24) {
    safety += 1;
    const targetRect = target.getBoundingClientRect();
    const candidateRect = new DOMRect(nextLeft, nextTop, targetRect.width, targetRect.height);
    const covered = windows.find(win => rectsOverlap(candidateRect, win.getBoundingClientRect()));
    if (!covered) {
      break;
    }
    nextTop += getHeaderHeight(covered);
  }

  return {
    left: Math.max(minLeft, Math.min(nextLeft, maxLeft)),
    top: Math.max(minTop, nextTop),
  };
}

function placeFloatingWindow(target: HTMLElement) {
  if (isPinned(target)) return;
  if (target.dataset.userPositioned === 'true') {
    clampWindowWithinBounds(target);
    return;
  }

  const anchor = getAnchorPosition(target);
  const candidate = findUnoccupiedPosition(target, anchor) ?? findOffsetOverlapPosition(target, anchor);
  target.style.left = `${candidate.left}px`;
  target.style.top = `${candidate.top}px`;
  target.style.transform = 'none';
  clampWindowWithinBounds(target);
}

function normalizeFloatingWindowStack() {
  const floating = dockableWindows
    .map(entry => entry.element)
    .filter(element => !isPinned(element));

  floating.sort((a, b) => {
    const zA = Number(a.style.zIndex || WINDOW_STACK_BASE);
    const zB = Number(b.style.zIndex || WINDOW_STACK_BASE);
    return zA - zB;
  });

  let z = WINDOW_STACK_BASE;
  for (const element of floating) {
    element.style.zIndex = `${z}`;
    z += 1;
  }
  windowZCounter = Math.max(WINDOW_STACK_BASE, z - 1);
}

function bringWindowToFront(target: HTMLElement) {
  if (isPinned(target)) return;
  if (windowZCounter >= WINDOW_STACK_MAX) {
    normalizeFloatingWindowStack();
  }
  windowZCounter = Math.min(WINDOW_STACK_MAX, windowZCounter + 1);
  target.style.zIndex = `${windowZCounter}`;
}

export function positionSettingsPanel() {
  if (!els.settingsControlsEl) return;
  if (isPinned(els.settingsControlsEl)) return;
  if (els.settingsControlsEl.dataset.userPositioned === 'true') return;
  const anchor = getAnchorPosition(els.settingsControlsEl);
  els.settingsControlsEl.style.left = `${anchor.left}px`;
  els.settingsControlsEl.style.top = `${anchor.top}px`;
  els.settingsControlsEl.style.transform = 'none';
}

export function positionStatisticsPanel() {
  if (!els.statisticsControlsEl) return;
  if (isPinned(els.statisticsControlsEl)) return;
  if (els.statisticsControlsEl.dataset.userPositioned === 'true') return;
  const anchor = getAnchorPosition(els.statisticsControlsEl);
  els.statisticsControlsEl.style.left = `${anchor.left}px`;
  els.statisticsControlsEl.style.top = `${anchor.top}px`;
  els.statisticsControlsEl.style.transform = 'none';
}

export function positionScatterplotPanel() {
  if (!els.scatterplotControlsEl) return;
  if (isPinned(els.scatterplotControlsEl)) return;
  if (els.scatterplotControlsEl.dataset.userPositioned === 'true') return;
  const anchor = getAnchorPosition(els.scatterplotControlsEl);
  els.scatterplotControlsEl.style.left = `${anchor.left}px`;
  els.scatterplotControlsEl.style.top = `${anchor.top}px`;
  els.scatterplotControlsEl.style.transform = 'none';
}

export function positionFiltersPanel() {
  if (!els.filtersControlsEl) return;
  if (isPinned(els.filtersControlsEl)) return;
  if (els.filtersControlsEl.dataset.userPositioned === 'true') return;
  const anchor = getAnchorPosition(els.filtersControlsEl);
  els.filtersControlsEl.style.left = `${anchor.left}px`;
  els.filtersControlsEl.style.top = `${anchor.top}px`;
  els.filtersControlsEl.style.transform = 'none';
  updateFiltersPanelLayout();
}


export function updateFiltersPanelLayout() {
  if (!els.filtersControlsEl || !els.filtersContent || !els.filtersListEl) return;
  if (els.filtersControlsEl.style.display === 'none') return;
  const panelRect = els.filtersControlsEl.getBoundingClientRect();
  if (panelRect.height === 0 && panelRect.width === 0) return;
  const viewportPadding = 16;
  const maxPanelHeight = Math.max(220, window.innerHeight - panelRect.top - viewportPadding);
  els.filtersControlsEl.style.maxHeight = `${maxPanelHeight}px`;

  const contentRect = els.filtersContent.getBoundingClientRect();
  const listRect = els.filtersListEl.getBoundingClientRect();
  const nonListHeight = contentRect.height - listRect.height;
  const availableListHeight = Math.max(140, maxPanelHeight - nonListHeight - 8);
  els.filtersListEl.style.maxHeight = `${availableListHeight}px`;
}

export function positionLandSchedulePanel() {
  if (!els.landScheduleControlsEl) return;
  if (isPinned(els.landScheduleControlsEl)) return;
  if (els.landScheduleControlsEl.dataset.userPositioned === 'true') return;
  const anchor = getAnchorPosition(els.landScheduleControlsEl);
  els.landScheduleControlsEl.style.left = `${anchor.left}px`;
  els.landScheduleControlsEl.style.top = `${anchor.top}px`;
  els.landScheduleControlsEl.style.transform = 'none';
}


export function positionTimeAdjustmentPanel() {
  if (!els.timeAdjustmentControlsEl) return;
  if (isPinned(els.timeAdjustmentControlsEl)) return;
  if (els.timeAdjustmentControlsEl.dataset.userPositioned === 'true') return;
  const anchor = getAnchorPosition(els.timeAdjustmentControlsEl);
  els.timeAdjustmentControlsEl.style.left = `${anchor.left}px`;
  els.timeAdjustmentControlsEl.style.top = `${anchor.top}px`;
  els.timeAdjustmentControlsEl.style.transform = 'none';
}

// ---------------------------------------------------------------------------
// Draggable
// ---------------------------------------------------------------------------

export function makeDraggable(element: HTMLElement) {
  const header = element.querySelector('.window-header') as HTMLElement;
  if (!header) return;

  element.addEventListener('mousedown', () => {
    bringWindowToFront(element);
  });
  element.addEventListener('focusin', () => {
    bringWindowToFront(element);
  });

  header.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    if (target.closest('.window-resize-handle') || target.closest('.window-resize-edge')) return;
    S.isDragging = true;
    S.dragTarget = element;
    if (isPinned(element)) {
      unpinWindow(element);
    }
    element.dataset.userPositioned = 'true';
    const rect = element.getBoundingClientRect();
    S.dragOffset.x = e.clientX - rect.left;
    S.dragOffset.y = e.clientY - rect.top;
    bringWindowToFront(element);

    // Prevent text selection during drag
    e.preventDefault();
    document.body.style.userSelect = 'none';
  });
}

export function handleMouseMove(e: MouseEvent) {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  if (isColumnResizing && resizeColumn) {
    const dx = e.clientX - columnResizeStartX;
    const minColumnWidth = getColumnMinWidth(resizeColumn) + PINNED_GUTTER;
    const nextWidth = Math.max(minColumnWidth, columnResizeStartWidth + dx);
    columnWidthOverrides.set(getColumnIndex(resizeColumn), nextWidth);
    updatePinnedLayout();
    logDockLayout('column-resize');
    return;
  }

  if (isResizing && resizeTarget) {
    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;
    const pinnedColumn = isPinned(resizeTarget)
      ? ((resizeTarget.closest('.pinned-column') as HTMLDivElement | null) ?? null)
      : null;

    if (resizeMode !== 'y') {
      if (pinnedColumn) {
        const minColumnWidth = getColumnMinWidth(pinnedColumn) + PINNED_GUTTER;
        const nextWidth = Math.max(minColumnWidth, resizeStartWidth + dx + PINNED_GUTTER);
        columnWidthOverrides.set(getColumnIndex(pinnedColumn), nextWidth);
      } else {
        const nextWidth = Math.max(getMinWindowWidth(resizeTarget), resizeStartWidth + dx);
        resizeTarget.style.width = `${nextWidth}px`;
      }
    }

    if (resizeMode === 'both' || resizeMode === 'y') {
      const nextHeight = Math.max(resizeMinHeight, resizeStartHeight + dy);
      resizeTarget.style.height = `${nextHeight}px`;
    }
    if (resizeTarget.id === 'filtersControls') {
      updateFiltersPanelLayout();
    }
    if (isPinned(resizeTarget)) {
      updatePinnedLayout();
      logDockLayout('window-resize');
    } else {
      clampWindowWithinBounds(resizeTarget);
    }
    ensureWindowMinHeight(resizeTarget);
    return;
  }

  if (!S.isDragging || !S.dragTarget) return;

  const x = e.clientX - S.dragOffset.x;
  const y = e.clientY - S.dragOffset.y;

  // Keep window within map panel bounds (top + sides). Bottom may overflow.
  const rect = S.dragTarget.getBoundingClientRect();
  const mapRect = getMapRect();
  const minX = mapRect.left;
  const maxX = Math.max(minX, mapRect.right - rect.width);
  const minY = mapRect.top;
  const clampedX = Math.max(minX, Math.min(x, maxX));
  const clampedY = Math.max(minY, y);

  S.dragTarget.style.left = `${clampedX}px`;
  S.dragTarget.style.top = `${clampedY}px`;
  S.dragTarget.style.transform = 'none'; // Remove any transform when dragging

  // If dragging the selection controls panel, update legend position
  if (S.dragTarget.id === 'selectionControlsPanel') {
    _updateLegendPosition();
  }
}

export function handleMouseUp() {
  if (isResizing) {
    isResizing = false;
    resizeTarget = null;
    document.body.style.userSelect = '';
  }
  if (isColumnResizing) {
    isColumnResizing = false;
    resizeColumn = null;
    document.body.style.userSelect = '';
  }

  const releasedTarget = S.dragTarget;
  S.isDragging = false;
  S.dragTarget = null;
  document.body.style.userSelect = '';
  if (releasedTarget?.id === 'filtersControls') {
    updateFiltersPanelLayout();
  }
  if (releasedTarget) {
    ensureWindowMinHeight(releasedTarget);
  }
  if (releasedTarget && pinnedContainer) {
    const dropColumn = getPinnedDropColumn(lastMouseX, lastMouseY);
    const dropInPinnedArea = isPointInPinnedArea(lastMouseX, lastMouseY);
    if (dropColumn) {
      pinWindow(releasedTarget, dropColumn);
    } else if (dropInPinnedArea) {
      pinWindow(releasedTarget);
    }
  }
}

function getMinWindowHeight(element: HTMLElement) {
  if (isPinnedCollapsed(element)) {
    return getHeaderHeight(element);
  }
  if (isPinned(element)) {
    const styles = window.getComputedStyle(element);
    const cssMinHeight = parseFloat(styles.minHeight || '0');
    return Math.max(
      MIN_WINDOW_HEIGHT,
      Number.isFinite(cssMinHeight) ? cssMinHeight : 0,
      getHeaderHeight(element) + 40
    );
  }
  return Math.max(MIN_WINDOW_HEIGHT, element.scrollHeight);
}

function ensureWindowMinHeight(element: HTMLElement) {
  const minHeight = getMinWindowHeight(element);
  if (element.offsetHeight < minHeight) {
    element.style.height = `${minHeight}px`;
  }
  if (element.id === 'filtersControls') {
    updateFiltersPanelLayout();
  }
  if (isPinned(element)) {
    updatePinnedLayout();
  }
}

function getMinWindowWidth(element: HTMLElement) {
  const storedMin = Number(element.dataset.minWidth ?? MIN_WINDOW_WIDTH);
  const requiredMin = getWindowRequiredMinWidth(element);
  const nextMin = Math.max(MIN_WINDOW_WIDTH, requiredMin, Number.isFinite(storedMin) ? storedMin : 0);
  element.dataset.minWidth = `${nextMin}`;
  return nextMin;
}

function getWindowRequiredMinWidth(element: HTMLElement) {
  const styles = window.getComputedStyle(element);
  const cssMinWidth = parseFloat(styles.minWidth || '0');
  const headerEl = element.querySelector('.window-header') as HTMLElement | null;

  // Measure header children's natural widths instead of headerEl.scrollWidth,
  // which stretches with the container and causes a one-way min-width ratchet.
  let headerContentWidth = 0;
  if (headerEl) {
    const headerStyles = window.getComputedStyle(headerEl);
    const padLeft = parseFloat(headerStyles.paddingLeft || '0');
    const padRight = parseFloat(headerStyles.paddingRight || '0');
    let childrenWidth = 0;
    for (const child of Array.from(headerEl.children) as HTMLElement[]) {
      childrenWidth += child.scrollWidth;
    }
    headerContentWidth = padLeft + childrenWidth + padRight;
  }

  const minRequired = [
    Number.isFinite(cssMinWidth) ? cssMinWidth : 0,
    headerContentWidth,
  ];
  return Math.max(MIN_WINDOW_WIDTH, ...minRequired);
}

function getColumnMinWidth(column: HTMLDivElement) {
  const children = getColumnWindows(column)
    .filter(child => window.getComputedStyle(child).display !== 'none');
  if (children.length === 0) return MIN_WINDOW_WIDTH;
  return children.reduce((maxWidth, child) => Math.max(maxWidth, getMinWindowWidth(child)), MIN_WINDOW_WIDTH);
}

function getColumnIndex(column: HTMLDivElement) {
  return Number(column.dataset.columnIndex ?? 0);
}

function hasPinnedWindows() {
  if (!pinnedContainer) return false;
  return pinnedContainer.querySelectorAll('.pinned-column .viz-window').length > 0;
}

function isPinned(element: HTMLElement) {
  return element.dataset.pinned === 'true';
}

function togglePinnedState(element: HTMLElement) {
  if (isPinned(element)) {
    unpinWindow(element);
  } else {
    pinWindow(element);
  }
}

function updatePinButtonState(element: HTMLElement) {
  const entry = dockableWindows.find(win => win.element === element);
  if (!entry) return;
  const img = entry.pinButton.querySelector('img');
  if (!img) return;
  const pinned = isPinned(element);
  const pinnedSrc = entry.pinButton.dataset.pinSrc;
  const unpinnedSrc = entry.pinButton.dataset.unpinSrc;
  img.src = pinned ? (pinnedSrc ?? './src/svg/thumbtack.svg') : (unpinnedSrc ?? './src/svg/thumbtack-tilted.svg');
  img.alt = pinned ? 'Unpin menu' : 'Pin menu';
  entry.pinButton.setAttribute('aria-pressed', String(pinned));
  entry.pinButton.title = pinned ? 'Unpin' : 'Pin';
  updateCollapseButtonState(element, entry.collapseButton);
}

function updateCollapseButtonState(element: HTMLElement, collapseButton: HTMLButtonElement | null) {
  if (!collapseButton) return;
  const collapsed = isPinnedCollapsed(element);
  collapseButton.textContent = '▼';
  collapseButton.title = collapsed ? 'Expand pinned menu' : 'Collapse pinned menu';
  collapseButton.setAttribute('aria-expanded', String(!collapsed));
  collapseButton.style.transform = collapsed ? 'rotate(-90deg)' : 'none';
}

function isPinnedCollapsed(element: HTMLElement) {
  return element.dataset.pinnedCollapsed === 'true';
}

function setPinnedCollapsedState(element: HTMLElement, collapsed: boolean) {
  element.dataset.pinnedCollapsed = collapsed ? 'true' : 'false';
  element.classList.toggle('is-pinned-collapsed', collapsed);
  const contentEl = element.querySelector('[data-window-content]') as HTMLElement | null;
  if (collapsed) {
    if (contentEl) {
      contentEl.dataset.expandedDisplay = contentEl.style.display || 'grid';
      contentEl.style.display = 'none';
    }
    element.dataset.expandedMinHeight = element.style.minHeight || '';
    const headerHeight = getHeaderHeight(element);
    element.style.minHeight = `${headerHeight}px`;
    element.style.height = `${headerHeight}px`;
  } else {
    if (contentEl) {
      const expandedDisplay = contentEl.dataset.expandedDisplay || 'grid';
      contentEl.style.display = expandedDisplay;
    }
    element.style.minHeight = element.dataset.expandedMinHeight ?? '';
    element.style.height = '';
    ensureWindowMinHeight(element);
  }
  const entry = dockableWindows.find(win => win.element === element);
  updateCollapseButtonState(element, entry?.collapseButton ?? null);
}

function togglePinnedCollapsed(element: HTMLElement) {
  if (!isPinned(element)) return;
  setPinnedCollapsedState(element, !isPinnedCollapsed(element));
  updatePinnedLayout();
}

function pinWindow(element: HTMLElement, column?: HTMLDivElement) {
  if (!pinnedContainer || !appContainer) return;
  if (isPinned(element)) return;
  const rect = element.getBoundingClientRect();
  element.dataset.floatLeft = element.style.left || `${rect.left}px`;
  element.dataset.floatTop = element.style.top || `${rect.top}px`;
  element.dataset.floatRight = element.style.right || '';
  element.dataset.floatTransform = element.style.transform || '';
  element.style.left = '';
  element.style.top = '';
  element.style.right = '';
  element.style.transform = 'none';
  element.style.position = 'relative';
  setPinnedState(element, true);

  let targetColumn = column;
  if (targetColumn && !canColumnFitWindow(targetColumn, element)) {
    targetColumn = null;
  }
  if (!targetColumn) {
    targetColumn = findColumnForWindow(element);
  }
  if (!targetColumn) {
    targetColumn = createPinnedColumn();
  }
  element.dataset.pinnedColumn = `${getColumnIndex(targetColumn)}`;
  insertWindowInColumn(targetColumn, element);
  const columnIndex = getColumnIndex(targetColumn);
  const currentColumnWidth = element.getBoundingClientRect().width + PINNED_GUTTER;
  const minColumnWidth = getColumnMinWidth(targetColumn) + PINNED_GUTTER;
  const existingOverride = columnWidthOverrides.get(columnIndex) ?? 0;
  columnWidthOverrides.set(columnIndex, Math.max(existingOverride, minColumnWidth, currentColumnWidth));
  updatePinButtonState(element);
  updatePinnedLayout();
  logDockLayout('pin-window');
}

function unpinWindow(element: HTMLElement) {
  if (!appContainer) return;
  if (!isPinned(element)) return;
  const column = element.closest('.pinned-column') as HTMLDivElement | null;
  setPinnedState(element, false);
  element.dataset.pinnedColumn = '';
  element.dataset.pinnedOrder = '';
  element.style.position = 'absolute';
  element.style.left = element.dataset.floatLeft ?? element.style.left;
  element.style.top = element.dataset.floatTop ?? element.style.top;
  element.style.right = element.dataset.floatRight ?? '';
  element.style.transform = element.dataset.floatTransform ?? 'none';
  appContainer.appendChild(element);
  if (column?.classList.contains('pinned-column') && getColumnWindows(column as HTMLDivElement).length === 0) {
    column.remove();
  }
  updatePinButtonState(element);
  updatePinnedLayout();
  logDockLayout('unpin-window');
}


function setPinnedState(element: HTMLElement, pinned: boolean) {
  element.dataset.pinned = pinned ? 'true' : 'false';
  element.classList.toggle('is-pinned', pinned);
  if (!pinned) {
    setPinnedCollapsedState(element, false);
  }
  _onPinnedStateChanged(element, pinned);
}

function updatePinnedLayout() {
  if (!pinnedContainer) return;
  const columns = Array.from(pinnedContainer.querySelectorAll('.pinned-column')) as HTMLDivElement[];
  const containerStyles = window.getComputedStyle(pinnedContainer);
  const paddingLeft = parseFloat(containerStyles.paddingLeft || '0');
  const paddingRight = parseFloat(containerStyles.paddingRight || '0');
  const gapValue = parseFloat(containerStyles.columnGap || containerStyles.gap || `${PINNED_GAP_FALLBACK}`);
  let totalWidth = paddingLeft + paddingRight;
  const visibleColumns: Array<{ column: HTMLDivElement; width: number }> = [];
  columns.forEach((column) => {
    const visibleChildren = getColumnWindows(column)
      .filter(child => window.getComputedStyle(child).display !== 'none');
    if (visibleChildren.length === 0) {
      columnWidthOverrides.delete(getColumnIndex(column));
      column.remove();
      return;
    }
    // Keep grid layout so the right gutter remains a fixed-width resize strip.
    // Setting this to flex causes the resize-handle area to grow with column width.
    column.style.display = 'grid';
    const minColumnWidth = getColumnMinWidth(column) + PINNED_GUTTER;
    const overrideWidth = columnWidthOverrides.get(getColumnIndex(column));
    const columnWidth = Math.max(minColumnWidth, overrideWidth ?? minColumnWidth);
    column.style.width = `${columnWidth}px`;
    column.style.setProperty('--pinned-gutter', `${PINNED_GUTTER}px`);
    visibleChildren.forEach(child => {
      child.style.width = `${Math.max(0, columnWidth - PINNED_GUTTER)}px`;
    });
    visibleColumns.push({ column, width: columnWidth });
  });
  if (visibleColumns.length === 0) {
    document.documentElement.style.setProperty('--pinned-width', '0px');
    ensureFloatingWindowsClearDock();
    _updateLegendPosition();
    updateFiltersPanelLayout();
    logDockLayout('layout-empty');
    return;
  }
  const columnIndices = new Set(visibleColumns.map(entry => getColumnIndex(entry.column)));
  for (const key of columnWidthOverrides.keys()) {
    if (!columnIndices.has(key)) {
      columnWidthOverrides.delete(key);
    }
  }
  visibleColumns.forEach((entry, index) => {
    totalWidth += entry.width;
    if (index < visibleColumns.length - 1) {
      totalWidth += gapValue;
    }
  });
  document.documentElement.style.setProperty('--pinned-width', `${totalWidth}px`);
  ensureFloatingWindowsClearDock();
  _updateLegendPosition();
  updateFiltersPanelLayout();
  logDockLayout('layout');
}

function createPinnedColumn() {
  if (!pinnedContainer) return null;
  const column = document.createElement('div');
  column.className = 'pinned-column';
  const nextIndex = getNextColumnIndex();
  column.dataset.columnIndex = `${nextIndex}`;
  const scrollContent = document.createElement('div');
  scrollContent.className = 'pinned-column-scroll';
  column.appendChild(scrollContent);

  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'pinned-column-resize-handle';
  resizeHandle.setAttribute('aria-hidden', 'true');
  resizeHandle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    isColumnResizing = true;
    resizeColumn = column;
    columnResizeStartX = event.clientX;
    columnResizeStartWidth = column.getBoundingClientRect().width;
    document.body.style.userSelect = 'none';
  });
  column.appendChild(resizeHandle);
  pinnedContainer.appendChild(column);
  return column;
}

function findColumnForWindow(element: HTMLElement) {
  if (!pinnedContainer) return null;
  const columns = Array.from(pinnedContainer.querySelectorAll('.pinned-column')) as HTMLDivElement[];
  const containerHeight = pinnedContainer.getBoundingClientRect().height;
  const gapValue = parseFloat(window.getComputedStyle(pinnedContainer).gap || `${PINNED_GAP_FALLBACK}`);
  for (const column of columns) {
    if (canColumnFitWindow(column, element, containerHeight, gapValue)) {
      return column;
    }
  }
  return null;
}

function canColumnFitWindow(
  column: HTMLDivElement,
  element: HTMLElement,
  containerHeight = pinnedContainer?.getBoundingClientRect().height ?? 0,
  gapValue = parseFloat(window.getComputedStyle(pinnedContainer ?? document.body).gap || `${PINNED_GAP_FALLBACK}`)
) {
  const visibleChildren = getColumnWindows(column)
    .filter(child => window.getComputedStyle(child).display !== 'none');
  const usedHeight = visibleChildren.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0)
    + gapValue * Math.max(0, visibleChildren.length - 1);
  const nextHeight = element.getBoundingClientRect().height;
  const totalHeight = usedHeight + nextHeight + (visibleChildren.length > 0 ? gapValue : 0);
  return totalHeight <= containerHeight;
}

function insertWindowInColumn(column: HTMLDivElement, element: HTMLElement) {
  const desiredOrder = Number(element.dataset.pinnedOrder ?? '');
  const windows = getColumnWindows(column);
  const windowContainer = getColumnWindowContainer(column);
  if (Number.isNaN(desiredOrder)) {
    element.dataset.pinnedOrder = `${windows.length}`;
    windowContainer.appendChild(element);
    return;
  }
  const sorted = windows.sort((a, b) => {
    const orderA = Number(a.dataset.pinnedOrder ?? 0);
    const orderB = Number(b.dataset.pinnedOrder ?? 0);
    return orderA - orderB;
  });
  const target = sorted.find(child => Number(child.dataset.pinnedOrder ?? 0) > desiredOrder);
  if (target) {
    windowContainer.insertBefore(element, target);
  } else {
    windowContainer.appendChild(element);
  }
}

function restorePinnedWindow(element: HTMLElement) {
  if (!pinnedContainer) return;
  let targetColumn: HTMLDivElement | null = null;
  const storedColumnIndex = Number(element.dataset.pinnedColumn ?? '');
  if (!Number.isNaN(storedColumnIndex)) {
    targetColumn = getOrCreateColumnByIndex(storedColumnIndex);
  }
  if (!targetColumn || !canColumnFitWindow(targetColumn, element)) {
    targetColumn = findColumnForWindow(element);
  }
  if (!targetColumn) {
    targetColumn = createPinnedColumn();
  }
  element.dataset.pinnedColumn = `${getColumnIndex(targetColumn)}`;
  insertWindowInColumn(targetColumn, element);
  updatePinnedLayout();
}

function getNextColumnIndex() {
  if (!pinnedContainer) return 0;
  const indices = Array.from(pinnedContainer.querySelectorAll('.pinned-column'))
    .map(column => Number((column as HTMLDivElement).dataset.columnIndex ?? 0));
  if (indices.length === 0) return 0;
  return Math.max(...indices) + 1;
}

function getOrCreateColumnByIndex(index: number) {
  if (!pinnedContainer) return null;
  const existing = Array.from(pinnedContainer.querySelectorAll('.pinned-column'))
    .find(column => Number((column as HTMLDivElement).dataset.columnIndex ?? 0) === index) as HTMLDivElement | undefined;
  if (existing) return existing;
  const column = document.createElement('div');
  column.className = 'pinned-column';
  column.dataset.columnIndex = `${index}`;
  const scrollContent = document.createElement('div');
  scrollContent.className = 'pinned-column-scroll';
  column.appendChild(scrollContent);
  const resizeHandle = document.createElement('div');
  resizeHandle.className = 'pinned-column-resize-handle';
  resizeHandle.setAttribute('aria-hidden', 'true');
  resizeHandle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    isColumnResizing = true;
    resizeColumn = column;
    columnResizeStartX = event.clientX;
    columnResizeStartWidth = column.getBoundingClientRect().width;
    document.body.style.userSelect = 'none';
  });
  column.appendChild(resizeHandle);
  const columns = Array.from(pinnedContainer.querySelectorAll('.pinned-column')) as HTMLDivElement[];
  const insertBefore = columns.find(existingColumn => getColumnIndex(existingColumn) > index);
  if (insertBefore) {
    pinnedContainer.insertBefore(column, insertBefore);
  } else {
    pinnedContainer.appendChild(column);
  }
  return column;
}

function getDockRightEdge() {
  if (!pinnedContainer) return 0;
  if (!hasPinnedWindows()) {
    return 64;
  }
  const rect = pinnedContainer.getBoundingClientRect();
  return rect.right + 10;
}

function ensureFloatingWindowsClearDock() {
  dockableWindows.forEach(entry => {
    const element = entry.element;
    if (isPinned(element)) return;
    if (window.getComputedStyle(element).display === 'none') return;
    clampWindowWithinBounds(element);
  });
}

function isPointInPinnedArea(x: number, y: number) {
  if (!pinnedContainer) return false;
  const rect = pinnedContainer.getBoundingClientRect();
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

function getPinnedDropColumn(x: number, y: number) {
  if (!pinnedContainer) return null;
  const columns = Array.from(pinnedContainer.querySelectorAll('.pinned-column')) as HTMLDivElement[];
  return columns.find(column => {
    const rect = column.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }) ?? null;
}

function getColumnWindowContainer(column: HTMLDivElement) {
  return (column.querySelector(':scope > .pinned-column-scroll') as HTMLDivElement | null) ?? column;
}

function getColumnWindows(column: HTMLDivElement) {
  const windowContainer = getColumnWindowContainer(column);
  return Array.from(windowContainer.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .filter(child => child.classList.contains('viz-window'));
}
