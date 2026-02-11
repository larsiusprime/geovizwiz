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
const PINNED_GUTTER = 8;
const MIN_WINDOW_WIDTH = 240;
const MIN_WINDOW_HEIGHT = 160;

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
  appContainer: HTMLElement;
}) {
  pinnedContainer = config.pinnedContainer;
  appContainer = config.appContainer;
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
  const minWidth = getWindowRequiredMinWidth(windowEl);
  const storedMin = Number(windowEl.dataset.minWidth ?? MIN_WINDOW_WIDTH);
  windowEl.dataset.minWidth = `${Math.max(storedMin, minWidth)}`;
  updatePinButtonState(windowEl);
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
      const currentMinWidth = Number(windowEl.dataset.minWidth ?? MIN_WINDOW_WIDTH);
      if (contentEl.scrollWidth > contentEl.clientWidth) {
        const nextMinWidth = Math.max(currentMinWidth, contentEl.scrollWidth);
        windowEl.dataset.minWidth = `${nextMinWidth}`;
      }
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

  function avoidWindowOverlap(target: HTMLElement) {
    if (isPinned(target)) return;
    const rect = target.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const padding = 12;
    const windows = Array.from(document.querySelectorAll<HTMLElement>('.viz-window'))
      .filter(el => el !== target)
      .filter(el => window.getComputedStyle(el).display !== 'none');
    const targetArea = rect.width * rect.height;
    if (!windows.length || targetArea === 0) return;

    const overlaps = windows.map(win => {
      const r = win.getBoundingClientRect();
      const overlapX = Math.max(0, Math.min(rect.right, r.right) - Math.max(rect.left, r.left));
      const overlapY = Math.max(0, Math.min(rect.bottom, r.bottom) - Math.max(rect.top, r.top));
      return overlapX * overlapY;
    });
    const maxOverlap = Math.max(...overlaps, 0);
    if (maxOverlap / targetArea < 0.35) return;

    const candidates: Array<{ left: number; top: number }> = [
      { left: padding, top: padding },
      { left: viewportWidth - rect.width - padding, top: padding },
      { left: padding, top: viewportHeight - rect.height - padding },
      { left: viewportWidth - rect.width - padding, top: viewportHeight - rect.height - padding },
    ];

    windows.forEach(win => {
      const r = win.getBoundingClientRect();
      candidates.push({ left: r.right + padding, top: r.top });
      candidates.push({ left: r.left, top: r.bottom + padding });
    });

    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
    let best = { left: rect.left, top: rect.top, overlap: maxOverlap };

    candidates.forEach(candidate => {
      const left = clamp(candidate.left, padding, viewportWidth - rect.width - padding);
      const top = clamp(candidate.top, padding, viewportHeight - rect.height - padding);
      const candidateRect = {
        left,
        top,
        right: left + rect.width,
        bottom: top + rect.height,
      };
      let overlap = 0;
      windows.forEach(win => {
        const r = win.getBoundingClientRect();
        const overlapX = Math.max(0, Math.min(candidateRect.right, r.right) - Math.max(candidateRect.left, r.left));
        const overlapY = Math.max(0, Math.min(candidateRect.bottom, r.bottom) - Math.max(candidateRect.top, r.top));
        overlap += overlapX * overlapY;
      });
      if (overlap < best.overlap) {
        best = { left, top, overlap };
      }
    });

    if (best.left !== rect.left || best.top !== rect.top) {
      target.style.left = `${best.left}px`;
      target.style.top = `${best.top}px`;
    }
  }

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
    avoidWindowOverlap(config.controlsEl);
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


export function positionTimeAdjustmentPanel() {
  if (!els.timeAdjustmentControlsEl) return;
  if (isPinned(els.timeAdjustmentControlsEl)) return;
  if (els.timeAdjustmentControlsEl.dataset.userPositioned === 'true') return;
  const anchor = (!S.isLandScheduleMinimized && els.landScheduleControlsEl)
    ? els.landScheduleControlsEl
    : (!S.isFiltersMinimized && els.filtersControlsEl)
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
  els.timeAdjustmentControlsEl.style.left = `${rect.right + gap}px`;
  els.timeAdjustmentControlsEl.style.top = `${rect.top}px`;
  els.timeAdjustmentControlsEl.style.transform = 'none';
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

  if (isColumnResizing && resizeColumn) {
    const dx = e.clientX - columnResizeStartX;
    const minColumnWidth = getColumnMinWidth(resizeColumn) + PINNED_GUTTER;
    const nextWidth = Math.max(minColumnWidth, columnResizeStartWidth + dx);
    columnWidthOverrides.set(getColumnIndex(resizeColumn), nextWidth);
    updatePinnedLayout();
    return;
  }

  if (isResizing && resizeTarget) {
    const dx = e.clientX - resizeStartX;
    const dy = e.clientY - resizeStartY;
    const pinnedColumn = isPinned(resizeTarget)
      ? (resizeTarget.parentElement?.classList.contains('pinned-column') ? resizeTarget.parentElement as HTMLDivElement : null)
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
  const minRequired = [
    Number.isFinite(cssMinWidth) ? cssMinWidth : 0,
    headerEl?.scrollWidth ?? 0,
  ];
  return Math.max(MIN_WINDOW_WIDTH, ...minRequired);
}

function getColumnMinWidth(column: HTMLDivElement) {
  const children = Array.from(column.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .filter(child => child.classList.contains('viz-window'))
    .filter(child => window.getComputedStyle(child).display !== 'none');
  if (children.length === 0) return MIN_WINDOW_WIDTH;
  return children.reduce((maxWidth, child) => Math.max(maxWidth, getMinWindowWidth(child)), MIN_WINDOW_WIDTH);
}

function getColumnIndex(column: HTMLDivElement) {
  return Number(column.dataset.columnIndex ?? 0);
}

function hasPinnedWindows() {
  if (!pinnedContainer) return false;
  return pinnedContainer.querySelectorAll('.pinned-column > .viz-window').length > 0;
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
}

function unpinWindow(element: HTMLElement) {
  if (!appContainer) return;
  if (!isPinned(element)) return;
  const column = element.parentElement;
  setPinnedState(element, false);
  element.dataset.pinnedColumn = '';
  element.dataset.pinnedOrder = '';
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
  const visibleColumns: Array<{ column: HTMLDivElement; width: number }> = [];
  columns.forEach((column) => {
    const children = Array.from(column.children) as HTMLElement[];
    const visibleChildren = children
      .filter(child => child.classList.contains('viz-window'))
      .filter(child => window.getComputedStyle(child).display !== 'none');
    if (visibleChildren.length === 0) {
      columnWidthOverrides.delete(getColumnIndex(column));
      column.remove();
      return;
    }
    column.style.display = 'flex';
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
}

function createPinnedColumn() {
  if (!pinnedContainer) return null;
  const column = document.createElement('div');
  column.className = 'pinned-column';
  const nextIndex = getNextColumnIndex();
  column.dataset.columnIndex = `${nextIndex}`;
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
  const visibleChildren = Array.from(column.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .filter(child => child.classList.contains('viz-window'))
    .filter(child => window.getComputedStyle(child).display !== 'none');
  const usedHeight = visibleChildren.reduce((sum, child) => sum + child.getBoundingClientRect().height, 0)
    + gapValue * Math.max(0, visibleChildren.length - 1);
  const nextHeight = element.getBoundingClientRect().height;
  const totalHeight = usedHeight + nextHeight + (visibleChildren.length > 0 ? gapValue : 0);
  return totalHeight <= containerHeight;
}

function insertWindowInColumn(column: HTMLDivElement, element: HTMLElement) {
  const desiredOrder = Number(element.dataset.pinnedOrder ?? '');
  const windows = Array.from(column.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement)
    .filter(child => child.classList.contains('viz-window'));
  if (Number.isNaN(desiredOrder)) {
    element.dataset.pinnedOrder = `${windows.length}`;
    column.appendChild(element);
    return;
  }
  const sorted = windows.sort((a, b) => {
    const orderA = Number(a.dataset.pinnedOrder ?? 0);
    const orderB = Number(b.dataset.pinnedOrder ?? 0);
    return orderA - orderB;
  });
  const target = sorted.find(child => Number(child.dataset.pinnedOrder ?? 0) > desiredOrder);
  if (target) {
    column.insertBefore(element, target);
  } else {
    column.appendChild(element);
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
