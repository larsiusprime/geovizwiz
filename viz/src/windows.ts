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

type DockableWindow = {
  element: HTMLElement;
  pinButton: HTMLButtonElement;
};

type ResizeMode = 'both' | 'x' | 'y';

const PINNED_GAP_FALLBACK = 8;
const MIN_WINDOW_WIDTH = 240;
const MIN_WINDOW_HEIGHT = 160;

let pinnedContainer: HTMLDivElement | null = null;
let pinnedResizeHandle: HTMLDivElement | null = null;
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
let isDockResizing = false;
let dockResizeStartX = 0;
let dockResizeStartWidth = 0;
let dockWidthOverride: number | null = null;

/** Must be called once from main.ts to wire in the callbacks. */
export function initWindowCallbacks(callbacks: {
  updateToolbarButtonStates: () => void;
  updateLegendPosition: () => void;
}) {
  _updateToolbarButtonStates = callbacks.updateToolbarButtonStates;
  _updateLegendPosition = callbacks.updateLegendPosition;
}

export function initWindowDocking(config: {
  pinnedContainer: HTMLDivElement;
  pinnedResizeHandle: HTMLDivElement;
  appContainer: HTMLElement;
}) {
  pinnedContainer = config.pinnedContainer;
  pinnedResizeHandle = config.pinnedResizeHandle;
  appContainer = config.appContainer;
  pinnedResizeHandle.addEventListener('mousedown', (event) => {
    if (!pinnedContainer) return;
    if (!hasPinnedWindows()) return;
    event.preventDefault();
    event.stopPropagation();
    isDockResizing = true;
    dockResizeStartX = event.clientX;
    dockResizeStartWidth = getDockWidth();
    document.body.style.userSelect = 'none';
  });
  updatePinnedLayout();
  window.addEventListener('resize', () => updatePinnedLayout());
}

export function registerDockableWindow(windowEl: HTMLElement, pinButton: HTMLButtonElement) {
  dockableWindows.push({ element: windowEl, pinButton });
  pinButton.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    togglePinnedState(windowEl);
  });
  updatePinButtonState(windowEl);
}

export function enableWindowResizing(windowEl: HTMLElement) {
  const handle = windowEl.querySelector('.window-resize-handle') as HTMLElement | null;
  const edge = windowEl.querySelector('.window-resize-edge') as HTMLElement | null;
  const contentEl = windowEl.querySelector('[data-window-content]') as HTMLElement | null;

  const startResize = (mode: ResizeMode) => (event: MouseEvent) => {
    if (mode === 'x' && isPinned(windowEl)) return;
    event.preventDefault();
    event.stopPropagation();
    isResizing = true;
    resizeTarget = windowEl;
    resizeMode = (isPinned(windowEl) && mode === 'both') ? 'y' : mode;
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
      ensureWindowMinHeight(windowEl);
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
    config.positionFn?.();
    config.onShow?.();
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
  paintControlsEl: HTMLDivElement;
  settingsControlsEl: HTMLDivElement;
  statisticsControlsEl: HTMLDivElement;
  scatterplotControlsEl: HTMLDivElement;
  filtersControlsEl: HTMLDivElement;
  filtersContent: HTMLDivElement;
  filtersListEl: HTMLDivElement;
  landScheduleControlsEl: HTMLDivElement;
};

let els: PositionElements;

/** Must be called once from main.ts to pass in the DOM elements. */
export function initPositionElements(elements: PositionElements) {
  els = elements;
}

export function positionPaintPanel() {
  if (!els.controlsEl || !els.paintControlsEl) return;
  if (isPinned(els.paintControlsEl)) return;
  if (els.paintControlsEl.dataset.userPositioned === 'true') return;
  const rect = els.controlsEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const gap = 10;
  els.paintControlsEl.style.left = `${rect.left}px`;
  els.paintControlsEl.style.top = `${rect.bottom + gap}px`;
  els.paintControlsEl.style.transform = 'none';
}

export function positionSettingsPanel() {
  if (!els.controlsEl || !els.settingsControlsEl) return;
  if (isPinned(els.settingsControlsEl)) return;
  if (els.settingsControlsEl.dataset.userPositioned === 'true') return;
  const rect = els.controlsEl.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const gap = 10;
  els.settingsControlsEl.style.left = `${rect.right + gap}px`;
  els.settingsControlsEl.style.top = `${rect.top}px`;
  els.settingsControlsEl.style.transform = 'none';
}

export function positionStatisticsPanel() {
  if (!els.statisticsControlsEl) return;
  if (isPinned(els.statisticsControlsEl)) return;
  if (els.statisticsControlsEl.dataset.userPositioned === 'true') return;
  const anchor = (!S.isSettingsMenuMinimized && els.settingsControlsEl) ? els.settingsControlsEl : els.controlsEl;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const gap = 10;
  els.statisticsControlsEl.style.left = `${rect.right + gap}px`;
  els.statisticsControlsEl.style.top = `${rect.top}px`;
  els.statisticsControlsEl.style.transform = 'none';
}

export function positionScatterplotPanel() {
  if (!els.scatterplotControlsEl) return;
  if (isPinned(els.scatterplotControlsEl)) return;
  if (els.scatterplotControlsEl.dataset.userPositioned === 'true') return;
  const anchor = (!S.isStatisticsMinimized && els.statisticsControlsEl)
    ? els.statisticsControlsEl
    : (!S.isSettingsMenuMinimized && els.settingsControlsEl)
      ? els.settingsControlsEl
      : els.controlsEl;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const gap = 10;
  els.scatterplotControlsEl.style.left = `${rect.right + gap}px`;
  els.scatterplotControlsEl.style.top = `${rect.top}px`;
  els.scatterplotControlsEl.style.transform = 'none';
}

export function positionFiltersPanel() {
  if (!els.filtersControlsEl) return;
  if (isPinned(els.filtersControlsEl)) return;
  if (els.filtersControlsEl.dataset.userPositioned === 'true') return;
  const anchor = (!S.isScatterplotMinimized && els.scatterplotControlsEl)
    ? els.scatterplotControlsEl
    : (!S.isStatisticsMinimized && els.statisticsControlsEl)
      ? els.statisticsControlsEl
      : (!S.isSettingsMenuMinimized && els.settingsControlsEl)
        ? els.settingsControlsEl
        : els.controlsEl;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const gap = 10;
  els.filtersControlsEl.style.left = `${rect.right + gap}px`;
  els.filtersControlsEl.style.top = `${rect.top}px`;
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
  const anchor = (!S.isFiltersMinimized && els.filtersControlsEl)
    ? els.filtersControlsEl
    : (!S.isScatterplotMinimized && els.scatterplotControlsEl)
      ? els.scatterplotControlsEl
      : (!S.isStatisticsMinimized && els.statisticsControlsEl)
        ? els.statisticsControlsEl
        : (!S.isSettingsMenuMinimized && els.settingsControlsEl)
          ? els.settingsControlsEl
          : els.controlsEl;
  if (!anchor) return;
  const rect = anchor.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const gap = 10;
  els.landScheduleControlsEl.style.left = `${rect.right + gap}px`;
  els.landScheduleControlsEl.style.top = `${rect.top}px`;
  els.landScheduleControlsEl.style.transform = 'none';
}

// ---------------------------------------------------------------------------
// updatePaintButtonState
// ---------------------------------------------------------------------------

export function updatePaintButtonState(btnPaintMenu: HTMLButtonElement | null) {
  if (!btnPaintMenu) return;
  if (S.isPaintMinimized) {
    btnPaintMenu.classList.add('inactive');
    btnPaintMenu.classList.remove('active');
  } else {
    btnPaintMenu.classList.remove('inactive');
    btnPaintMenu.classList.add('active');
  }
}

// ---------------------------------------------------------------------------
// Draggable
// ---------------------------------------------------------------------------

export function makeDraggable(element: HTMLElement) {
  const header = element.querySelector('.window-header') as HTMLElement;
  if (!header) return;

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

    // Prevent text selection during drag
    e.preventDefault();
    document.body.style.userSelect = 'none';
  });
}

export function handleMouseMove(e: MouseEvent) {
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;

  if (isDockResizing && pinnedContainer) {
    const dx = e.clientX - dockResizeStartX;
    const minDockWidth = getMinDockWidth();
    const nextWidth = Math.max(minDockWidth, dockResizeStartWidth + dx);
    dockWidthOverride = nextWidth;
    updatePinnedLayout();
    return;
  }

  if (isResizing && resizeTarget) {
    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;
    if (resizeMode !== 'y') {
      const nextWidth = Math.max(MIN_WINDOW_WIDTH, resizeStartWidth + dx);
      resizeTarget.style.width = `${nextWidth}px`;
    }
    if (resizeMode === 'both') {
      const nextHeight = Math.max(resizeMinHeight, resizeStartHeight + dy);
      resizeTarget.style.height = `${nextHeight}px`;
    }
    if (resizeMode === 'y') {
      const nextHeight = Math.max(resizeMinHeight, resizeStartHeight + dy);
      resizeTarget.style.height = `${nextHeight}px`;
    }
    if (resizeTarget.id === 'filtersControls') {
      updateFiltersPanelLayout();
    }
    if (isPinned(resizeTarget)) {
      updatePinnedLayout();
    }
    ensureWindowMinHeight(resizeTarget);
    return;
  }

  if (!S.isDragging || !S.dragTarget) return;

  const x = e.clientX - S.dragOffset.x;
  const y = e.clientY - S.dragOffset.y;

  // Keep window within viewport bounds
  const rect = S.dragTarget.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width;
  const maxY = window.innerHeight - rect.height;

  const minX = getDockRightEdge();
  const clampedX = Math.max(minX, Math.min(x, maxX));
  const clampedY = Math.max(0, Math.min(y, maxY));

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
  if (isDockResizing) {
    isDockResizing = false;
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
  return Math.max(MIN_WINDOW_WIDTH, element.scrollWidth);
}

function hasPinnedWindows() {
  if (!pinnedContainer) return false;
  return pinnedContainer.querySelectorAll('.pinned-column > .viz-window').length > 0;
}

function getMinDockWidth() {
  const pinnedWindows = dockableWindows
    .map(entry => entry.element)
    .filter(element => isPinned(element) && window.getComputedStyle(element).display !== 'none');
  if (pinnedWindows.length === 0) return 0;
  return pinnedWindows.reduce((maxWidth, element) => Math.max(maxWidth, getMinWindowWidth(element)), MIN_WINDOW_WIDTH);
}

function getDockWidth() {
  const minDockWidth = getMinDockWidth();
  if (dockWidthOverride !== null) {
    return Math.max(minDockWidth, dockWidthOverride);
  }
  return minDockWidth;
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
  if (!targetColumn) {
    targetColumn = document.createElement('div');
    targetColumn.className = 'pinned-column';
    pinnedContainer.appendChild(targetColumn);
  }
  targetColumn.appendChild(element);
  updatePinButtonState(element);
  dockWidthOverride = dockWidthOverride ?? getMinDockWidth();
  updatePinnedLayout();
}

function unpinWindow(element: HTMLElement) {
  if (!appContainer) return;
  if (!isPinned(element)) return;
  const column = element.parentElement;
  setPinnedState(element, false);
  element.style.position = 'absolute';
  element.style.left = element.dataset.floatLeft ?? element.style.left;
  element.style.top = element.dataset.floatTop ?? element.style.top;
  element.style.right = element.dataset.floatRight ?? '';
  element.style.transform = element.dataset.floatTransform ?? 'none';
  appContainer.appendChild(element);
  if (column?.classList.contains('pinned-column') && column.children.length === 0) {
    column.remove();
  }
  updatePinButtonState(element);
  updatePinnedLayout();
}

function setPinnedState(element: HTMLElement, pinned: boolean) {
  element.dataset.pinned = pinned ? 'true' : 'false';
  element.classList.toggle('is-pinned', pinned);
}

function updatePinnedLayout() {
  if (!pinnedContainer) return;
  const columns = Array.from(pinnedContainer.querySelectorAll('.pinned-column')) as HTMLDivElement[];
  const containerStyles = window.getComputedStyle(pinnedContainer);
  const paddingLeft = parseFloat(containerStyles.paddingLeft || '0');
  const paddingRight = parseFloat(containerStyles.paddingRight || '0');
  const gapValue = parseFloat(containerStyles.columnGap || containerStyles.gap || `${PINNED_GAP_FALLBACK}`);
  let totalWidth = paddingLeft + paddingRight;
  const dockWidth = getDockWidth();
  const visibleColumns: Array<{ column: HTMLDivElement; width: number }> = [];
  columns.forEach((column) => {
    const children = Array.from(column.children) as HTMLElement[];
    const visibleChildren = children.filter(child => window.getComputedStyle(child).display !== 'none');
    if (visibleChildren.length === 0) {
      column.style.display = 'none';
      column.style.width = '0px';
      return;
    }
    column.style.display = 'flex';
    const columnWidth = Math.max(MIN_WINDOW_WIDTH, dockWidth);
    column.style.width = `${columnWidth}px`;
    visibleChildren.forEach(child => {
      child.style.width = `${columnWidth}px`;
    });
    visibleColumns.push({ column, width: columnWidth });
  });
  visibleColumns.forEach((entry, index) => {
    totalWidth += entry.width;
    if (index < visibleColumns.length - 1) {
      totalWidth += gapValue;
    }
  });
  document.documentElement.style.setProperty('--pinned-width', `${totalWidth}px`);
  updatePinnedResizeHandle();
  ensureFloatingWindowsClearDock();
  _updateLegendPosition();
  updateFiltersPanelLayout();
}

function updatePinnedResizeHandle() {
  if (!pinnedResizeHandle) return;
  if (!hasPinnedWindows()) {
    pinnedResizeHandle.style.display = 'none';
    return;
  }
  pinnedResizeHandle.style.display = 'block';
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
  const dockRight = getDockRightEdge();
  dockableWindows.forEach(entry => {
    const element = entry.element;
    if (isPinned(element)) return;
    if (window.getComputedStyle(element).display === 'none') return;
    const rect = element.getBoundingClientRect();
    if (rect.left < dockRight) {
      element.style.left = `${dockRight}px`;
      element.style.transform = 'none';
    }
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
