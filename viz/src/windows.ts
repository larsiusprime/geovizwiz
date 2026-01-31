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

/** Must be called once from main.ts to wire in the callbacks. */
export function initWindowCallbacks(callbacks: {
  updateToolbarButtonStates: () => void;
  updateLegendPosition: () => void;
}) {
  _updateToolbarButtonStates = callbacks.updateToolbarButtonStates;
  _updateLegendPosition = callbacks.updateLegendPosition;
}

export function createWindowManager(config: WindowConfig): WindowManager {
  const display = config.contentDisplay ?? 'grid';

  function minimize() {
    config.setMinimized(true);
    config.contentEl.style.display = 'none';
    config.controlsEl.style.display = 'none';
    config.onMinimize?.();
    _updateToolbarButtonStates();
  }

  function show() {
    config.setMinimized(false);
    config.contentEl.style.display = display;
    config.controlsEl.style.display = 'grid';
    config.positionFn?.();
    config.onShow?.();
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
    S.isDragging = true;
    S.dragTarget = element;
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
  if (!S.isDragging || !S.dragTarget) return;

  const x = e.clientX - S.dragOffset.x;
  const y = e.clientY - S.dragOffset.y;

  // Keep window within viewport bounds
  const rect = S.dragTarget.getBoundingClientRect();
  const maxX = window.innerWidth - rect.width;
  const maxY = window.innerHeight - rect.height;

  const clampedX = Math.max(0, Math.min(x, maxX));
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
  const releasedTarget = S.dragTarget;
  S.isDragging = false;
  S.dragTarget = null;
  document.body.style.userSelect = '';
  if (releasedTarget?.id === 'filtersControls') {
    updateFiltersPanelLayout();
  }
}
