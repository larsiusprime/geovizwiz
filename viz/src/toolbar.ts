import { S } from './state';
import {
  handleRectangleMouseDown, handleRectangleMouseMove, handleRectangleMouseUp,
  handleLassoMouseDown, handleLassoMouseMove, handleLassoMouseUp,
  handlePolygonMouseDown, handlePolygonMouseMove, handlePolygonDoubleClick,
} from './selection';

/* ---------- callbacks wired from main.ts ---------- */

let _showLayers: () => void = () => {};
let _minimizeLayers: () => void = () => {};
let _toggleSettingsMenu: () => void = () => {};
let _showLegend: () => void = () => {};
let _minimizeLegend: () => void = () => {};
let _toggleLandSchedule: () => void = () => {};
let _toggleTimeAdjustment: () => void = () => {};
let _showCompFinderMenu: () => void = () => {};
let _setCompFinderToolActive: (active: boolean) => void = () => {};

export interface ToolbarCallbacks {
  showLayers: () => void;
  minimizeLayers: () => void;
  toggleSettingsMenu: () => void;
  showLegend: () => void;
  minimizeLegend: () => void;
  toggleLandSchedule: () => void;
  toggleTimeAdjustment: () => void;
  showCompFinderMenu: () => void;
  setCompFinderToolActive: (active: boolean) => void;
}

export function initToolbarCallbacks(cb: ToolbarCallbacks) {
  _showLayers = cb.showLayers;
  _minimizeLayers = cb.minimizeLayers;
  _toggleSettingsMenu = cb.toggleSettingsMenu;
  _showLegend = cb.showLegend;
  _minimizeLegend = cb.minimizeLegend;
  _toggleLandSchedule = cb.toggleLandSchedule;
  _toggleTimeAdjustment = cb.toggleTimeAdjustment;
  _showCompFinderMenu = cb.showCompFinderMenu;
  _setCompFinderToolActive = cb.setCompFinderToolActive;
}

/* ---------- DOM elements ---------- */

const selectToolButton = document.getElementById('selectToolButton') as HTMLButtonElement;
const layersToolButton = document.getElementById('layersToolButton') as HTMLButtonElement;
const settingsToolButton = document.getElementById('settingsToolButton') as HTMLButtonElement;
const infoToolButton = document.getElementById('infoToolButton') as HTMLButtonElement;
const panToolButton = document.getElementById('panToolButton') as HTMLButtonElement;
const selectSubmenu = document.getElementById('selectSubmenu') as HTMLDivElement;
const submenuButtons = document.querySelectorAll('.submenu-button') as NodeListOf<HTMLButtonElement>;
const legendToolButton = document.getElementById('legendToolButton') as HTMLButtonElement;
const landScheduleToolButton = document.getElementById('landScheduleToolButton') as HTMLButtonElement;
const timeAdjustmentToolButton = document.getElementById('timeAdjustmentToolButton') as HTMLButtonElement;
const compFinderToolButton = document.getElementById('compFinderToolButton') as HTMLButtonElement;

/* ---------- Constants ---------- */

// Hotkey definitions - easily changeable
export const HOTKEYS = {
  PAN: 'h',
  SELECT: 'v',
  INFO: 'i',
  COMP_FINDER: 'c',
};

// Icon mappings for different selection modes
const selectionModeIcons: Record<string, string> = {
  'select-one': new URL('./svg/select_cursor.svg', import.meta.url).href,
  'select-rectangle': new URL('./svg/select_rectangle.svg', import.meta.url).href,
  'select-lasso': new URL('./svg/select_lasso.svg', import.meta.url).href,
  'select-polygon': new URL('./svg/select_polygon.svg', import.meta.url).href
};
const cornerTriangleIcon = new URL('./svg/corner_triangle.svg', import.meta.url).href;

/* ---------- Pan tool mouse handlers ---------- */

function handlePanMouseDown(e: MouseEvent) {
  if (!S.isPanToolActive || e.button !== 0) return;
  S.isPanning = true;
  S.map.getCanvas().style.cursor = 'grabbing';
}

function handlePanMouseMove(_e: MouseEvent) {
  // No special handling needed - MapLibre handles the panning
}

function handlePanMouseUp(_e: MouseEvent) {
  if (!S.isPanToolActive || !S.isPanning) return;
  S.isPanning = false;
  S.map.getCanvas().style.cursor = 'grab';
}

/* ---------- Cursor ---------- */

// Update cursor based on active tool
export function updateCursor() {
  if (S.isInfoToolActive) {
    S.map.getCanvas().style.cursor = 'pointer';
  } else if (S.isCompFinderToolActive) {
    S.map.getCanvas().style.cursor = 'pointer';
  } else if (S.isPanToolActive) {
    S.map.getCanvas().style.cursor = 'grab';
  } else {
    // When SELECT mode is engaged, use arrow cursor
    S.map.getCanvas().style.cursor = 'default';
  }
}

/* ---------- Toolbar icon / submenu helpers ---------- */

// Update the main toolbar button icon based on current selection mode
export function updateToolbarIcon() {
  const iconPath = selectionModeIcons[S.currentSelectionMode];
  selectToolButton.innerHTML = `<img src="${iconPath}" alt="Select" />
          <span class="hotkey">V</span>
          <img src="${cornerTriangleIcon}" alt="" class="corner-triangle" />`;
}

// Update submenu active states
export function updateSubmenuActiveStates() {
  submenuButtons.forEach(button => {
    const mode = button.getAttribute('data-mode');
    if (mode === S.currentSelectionMode) {
      button.classList.add('active-tool');
    } else {
      button.classList.remove('active-tool');
    }
  });
}

// Helper function to close all submenus
export function closeAllSubmenus() {
  selectSubmenu.classList.remove('show');
}

export function positionSubmenu(button: HTMLElement, submenu: HTMLElement) {
  submenu.style.top = `${button.offsetTop}px`;
}

/* ---------- Tool activation ---------- */

// Set up event handlers based on current selection mode
export function setupSelectionModeHandlers() {
  const mapContainer = S.map.getContainer();

  // Remove all existing mouse event listeners
  mapContainer.removeEventListener('mousedown', handleRectangleMouseDown);
  mapContainer.removeEventListener('mousemove', handleRectangleMouseMove);
  mapContainer.removeEventListener('mouseup', handleRectangleMouseUp);
  mapContainer.removeEventListener('mousedown', handleLassoMouseDown);
  mapContainer.removeEventListener('mousemove', handleLassoMouseMove);
  mapContainer.removeEventListener('mouseup', handleLassoMouseUp);
  mapContainer.removeEventListener('mousedown', handlePolygonMouseDown);
  mapContainer.removeEventListener('mousemove', handlePolygonMouseMove);
  mapContainer.removeEventListener('dblclick', handlePolygonDoubleClick);
  mapContainer.removeEventListener('mousedown', handlePanMouseDown);
  mapContainer.removeEventListener('mousemove', handlePanMouseMove);
  mapContainer.removeEventListener('mouseup', handlePanMouseUp);

  // Add pan tool event listeners if pan tool is active
  if (S.isPanToolActive) {
    mapContainer.addEventListener('mousedown', handlePanMouseDown);
    mapContainer.addEventListener('mousemove', handlePanMouseMove);
    mapContainer.addEventListener('mouseup', handlePanMouseUp);
    return;
  }

  // If info tool is active, don't add any selection event listeners
  if (S.isInfoToolActive) {
    return;
  }

  if (S.isCompFinderToolActive) {
    return;
  }

  // Add event listeners based on current mode
  switch (S.currentSelectionMode) {
    case 'select-rectangle':
      mapContainer.addEventListener('mousedown', handleRectangleMouseDown);
      mapContainer.addEventListener('mousemove', handleRectangleMouseMove);
      mapContainer.addEventListener('mouseup', handleRectangleMouseUp);
      break;
    case 'select-lasso':
      mapContainer.addEventListener('mousedown', handleLassoMouseDown);
      mapContainer.addEventListener('mousemove', handleLassoMouseMove);
      mapContainer.addEventListener('mouseup', handleLassoMouseUp);
      break;
    case 'select-polygon':
      mapContainer.addEventListener('mousedown', handlePolygonMouseDown);
      mapContainer.addEventListener('mousemove', handlePolygonMouseMove);
      mapContainer.addEventListener('dblclick', handlePolygonDoubleClick);
      break;
    case 'select-one':
      // This mode uses the existing map click handler
      break;
  }
}

// Function to activate a specific tool and deactivate others
export function activateTool(tool: 'pan' | 'info' | 'select' | 'comp-finder') {
  // Deactivate all tools first
  S.isPanToolActive = false;
  S.isInfoToolActive = false;
  S.isCompFinderToolActive = false;

  // Remove active-tool class from all buttons
  panToolButton.classList.remove('active-tool');
  infoToolButton.classList.remove('active-tool');
  selectToolButton.classList.remove('active-tool');
  compFinderToolButton.classList.remove('active-tool');

  // Activate the specified tool
  switch (tool) {
    case 'pan':
      S.isPanToolActive = true;
      panToolButton.classList.add('active-tool');
      // Enable drag pan for pan tool
      S.map.dragPan.enable();
      _setCompFinderToolActive(false);
      break;
    case 'info':
      S.isInfoToolActive = true;
      infoToolButton.classList.add('active-tool');
      // Disable drag pan for info tool
      S.map.dragPan.disable();
      _setCompFinderToolActive(false);
      break;
    case 'select':
      selectToolButton.classList.add('active-tool');
      // Disable drag pan for select tool
      S.map.dragPan.disable();
      _setCompFinderToolActive(false);
      break;
    case 'comp-finder':
      S.isCompFinderToolActive = true;
      compFinderToolButton.classList.add('active-tool');
      // Disable drag pan for comp finder tool
      S.map.dragPan.disable();
      _showCompFinderMenu();
      _setCompFinderToolActive(true);
      break;
  }

  // Update selection mode handlers
  setupSelectionModeHandlers();

  // Update cursor
  updateCursor();

  // Close popup if info tool is deactivated
  if (!S.isInfoToolActive && S.activePopup) {
    S.activePopup.remove();
    S.activePopup = null;
    S.lastPicked = null;
  }
}

// Handle submenu button clicks
export function handleSubmenuButtonClick(mode: string) {
  S.currentSelectionMode = mode as any;
  updateToolbarIcon();
  updateSubmenuActiveStates();
  selectSubmenu.classList.remove('show');

  // Activate select tool
  activateTool('select');

  console.log(`Selection mode changed to: ${mode}`);
}

/* ---------- Toolbar button states ---------- */

// Update toolbar button states based on window visibility
export function updateToolbarButtonStates() {
  // Settings button state
  if (S.isLayersMinimized) {
    layersToolButton.classList.add('inactive');
    layersToolButton.classList.remove('active');
  } else {
    layersToolButton.classList.remove('inactive');
    layersToolButton.classList.add('active');
  }

  if (S.isSettingsMenuMinimized) {
    settingsToolButton.classList.add('inactive');
    settingsToolButton.classList.remove('active');
  } else {
    settingsToolButton.classList.remove('inactive');
    settingsToolButton.classList.add('active');
  }

  // Legend button state
  if (S.isLegendMinimized) {
    legendToolButton.classList.add('inactive');
    legendToolButton.classList.remove('active');
  } else {
    legendToolButton.classList.remove('inactive');
    legendToolButton.classList.add('active');
  }

  if (S.isLandScheduleMinimized) {
    landScheduleToolButton.classList.add('inactive');
    landScheduleToolButton.classList.remove('active');
  } else {
    landScheduleToolButton.classList.remove('inactive');
    landScheduleToolButton.classList.add('active');
  }

  if (S.isTimeAdjustmentMinimized) {
    timeAdjustmentToolButton.classList.add('inactive');
    timeAdjustmentToolButton.classList.remove('active');
  } else {
    timeAdjustmentToolButton.classList.remove('inactive');
    timeAdjustmentToolButton.classList.add('active');
  }

}

/* ---------- Initialize ---------- */

// Initialize toolbar
export function initializeToolbar() {
  // Set initial state
  updateToolbarIcon();
  updateSubmenuActiveStates();

  // Set initial button states based on window visibility
  updateToolbarButtonStates();

  // Activate pan tool by default
  activateTool('pan');

  // Set up initial selection mode handlers
  setupSelectionModeHandlers();

  // Set initial cursor state
  updateCursor();

  // Handle main select button click and hold behavior
  let selectButtonHoldTimer: number | null = null;
  let selectButtonHoldDuration = 200; // milliseconds to hold before showing submenu

  selectToolButton.addEventListener('mousedown', (e) => {
    e.stopPropagation();

    // Start hold timer
    selectButtonHoldTimer = window.setTimeout(() => {
      positionSubmenu(selectToolButton, selectSubmenu);
      selectSubmenu.classList.add('show');
      selectButtonHoldTimer = null;
    }, selectButtonHoldDuration);
  });

  selectToolButton.addEventListener('mouseup', (e) => {
    e.stopPropagation();

    // If timer is still running, it was a quick click - toggle current option
    if (selectButtonHoldTimer) {
      clearTimeout(selectButtonHoldTimer);
      selectButtonHoldTimer = null;

      // Toggle the current selection mode
      const currentButton = selectSubmenu.querySelector(`[data-mode="${S.currentSelectionMode}"]`) as HTMLButtonElement;
      if (currentButton) {
        handleSubmenuButtonClick(S.currentSelectionMode);
      }
      // Close submenu after toggling
      closeAllSubmenus();
    }
  });

  selectToolButton.addEventListener('mouseleave', () => {
    // Clear timer if mouse leaves button
    if (selectButtonHoldTimer) {
      clearTimeout(selectButtonHoldTimer);
      selectButtonHoldTimer = null;
    }
  });

  // Handle layers button click
  layersToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    if (S.isLayersMinimized) {
      _showLayers();
    } else {
      _minimizeLayers();
    }
  });

  settingsToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    _toggleSettingsMenu();
  });

  // Handle pan button click
  panToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();

    if (S.isPanToolActive) {
      // If pan is already active, deactivate it
      activateTool('select');
    } else {
      // Activate pan tool
      activateTool('pan');
    }
  });

  // Handle info button click
  infoToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();

    if (S.isInfoToolActive) {
      // If info is already active, deactivate it
      activateTool('select');
    } else {
      // Activate info tool
      activateTool('info');
    }
  });

  // Handle comp finder button click
  compFinderToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();

    if (S.isCompFinderToolActive) {
      activateTool('select');
    } else {
      activateTool('comp-finder');
    }
  });

  // Handle legend button click
  legendToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    if (S.isLegendMinimized) {
      _showLegend();
    } else {
      _minimizeLegend();
    }
  });

  landScheduleToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    _toggleLandSchedule();
  });

  timeAdjustmentToolButton.addEventListener('click', (e) => {
    e.stopPropagation();
    closeAllSubmenus();
    _toggleTimeAdjustment();
  });

  // Handle submenu button clicks
  submenuButtons.forEach(button => {
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      const mode = button.getAttribute('data-mode');
      if (mode) {
        handleSubmenuButtonClick(mode);
        // Close submenu after selecting an option
        closeAllSubmenus();
      }
    });
  });

  // Close submenu when clicking outside
  document.addEventListener('click', (e) => {
    const target = e.target as Node;
    if (!selectToolButton.contains(target) && !selectSubmenu.contains(target)) {
      closeAllSubmenus();
    }
  });
}
