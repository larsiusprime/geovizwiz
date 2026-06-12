/**
 * Reusable Save / Load tab widget.
 *
 * Creates a self-contained DOM subtree with Save and Load tabs,
 * a name input + confirm button for saving, and a <select> dropdown
 * for loading.  All behaviour is driven by the config callbacks.
 */

/* ------------------------------------------------------------------ */
/*  Public types                                                       */
/* ------------------------------------------------------------------ */

export type SaveLoadWidgetConfig = {
  /** Human-readable noun for aria labels & placeholder, e.g. "filter" */
  label: string;
  /** CSS id prefix so multiple widgets on the page get unique ids */
  idPrefix: string;
  /** Called when the user confirms a save.  Return false to cancel. */
  onSave: (name: string) => boolean | void | Promise<boolean | void>;
  /** Called when the user picks an entry from the load dropdown. */
  onLoad: (name: string) => void;
  /** Return the list of saved entry names (dropdown options). */
  getEntries: () => string[];
  /** Return true when saving is possible (e.g. something to save). */
  canSave: () => boolean;
  /** Return true when loading is possible (e.g. entries exist). */
  canLoad: () => boolean;
  /** Return the name of the matching entry, or null. */
  getMatchName: () => string | null;
};

export type SaveLoadWidgetHandle = {
  /** Root DOM element – insert this into any container. */
  element: HTMLDivElement;
  /** Refresh all UI state.  Call after external changes. */
  update: () => void;
};

/* ------------------------------------------------------------------ */
/*  Factory                                                            */
/* ------------------------------------------------------------------ */

export function createSaveLoadWidget(config: SaveLoadWidgetConfig): SaveLoadWidgetHandle {
  let mode: 'none' | 'save' | 'load' = 'none';

  /* ---- build DOM ------------------------------------------------- */
  const root = document.createElement('div');
  root.className = 'saveload-container';

  root.innerHTML = `
    <div class="saveload-tabs" role="tablist" aria-label="Saved ${config.label}s">
      <button class="saveload-tab" type="button" role="tab"
              id="${config.idPrefix}SaveToggle"
              aria-controls="${config.idPrefix}SavePanel"
              aria-selected="false" tabindex="-1">Save</button>
      <button class="saveload-tab" type="button" role="tab"
              id="${config.idPrefix}LoadToggle"
              aria-controls="${config.idPrefix}LoadPanel"
              aria-selected="false" tabindex="-1">Load</button>
    </div>
    <div class="saveload-section">
      <div id="${config.idPrefix}SavePanel" class="saveload-panel"
           role="tabpanel" aria-labelledby="${config.idPrefix}SaveToggle"
           style="display:none;">
        <div class="saveload-save-row" style="display:none;">
          <input type="text" placeholder="type a name" />
          <button type="button" title="Save">save</button>
        </div>
        <div class="saveload-status" style="display:none;"></div>
      </div>
      <div id="${config.idPrefix}LoadPanel" class="saveload-panel"
           role="tabpanel" aria-labelledby="${config.idPrefix}LoadToggle"
           style="display:none;">
        <div class="saveload-load-row" style="display:none;">
          <select></select>
          <button type="button" title="Load">load</button>
        </div>
      </div>
    </div>`;

  /* ---- grab references ------------------------------------------- */
  const saveToggle  = root.querySelector(`#${config.idPrefix}SaveToggle`) as HTMLButtonElement;
  const loadToggle  = root.querySelector(`#${config.idPrefix}LoadToggle`) as HTMLButtonElement;
  const savePanel   = root.querySelector(`#${config.idPrefix}SavePanel`) as HTMLDivElement;
  const loadPanel   = root.querySelector(`#${config.idPrefix}LoadPanel`) as HTMLDivElement;
  const saveRow     = savePanel.querySelector('.saveload-save-row') as HTMLDivElement;
  const nameInput   = saveRow.querySelector('input') as HTMLInputElement;
  const confirmBtn  = saveRow.querySelector('button') as HTMLButtonElement;
  const statusDiv   = savePanel.querySelector('.saveload-status') as HTMLDivElement;
  const loadRow     = loadPanel.querySelector('.saveload-load-row') as HTMLDivElement;
  const loadSelect  = loadRow.querySelector('select') as HTMLSelectElement;
  const loadButton  = loadRow.querySelector('button') as HTMLButtonElement;

  /* ---- internal helpers ------------------------------------------ */

  function setMode(next: 'none' | 'save' | 'load') {
    mode = mode === next ? 'none' : next;
    update();
  }

  function populateDropdown() {
    const previousValue = loadSelect.value;

    loadSelect.replaceChildren();
    const placeholder = new Option(`Choose a saved ${config.label}`, '');
    placeholder.disabled = true;
    loadSelect.appendChild(placeholder);

    const entries = config.getEntries();
    for (const name of entries) {
      loadSelect.appendChild(new Option(name, name));
    }

    if (previousValue && entries.includes(previousValue)) {
      loadSelect.value = previousValue;
    } else {
      loadSelect.value = '';
    }

    loadSelect.disabled = entries.length === 0;
  }

  function update() {
    const canSave = config.canSave();

    if (!canSave && mode === 'save') mode = 'none';

    const matchName = config.getMatchName();

    /* tabs */
    saveToggle.disabled = !canSave;
    const saveActive = mode === 'save';
    saveToggle.classList.toggle('active', saveActive);
    saveToggle.setAttribute('aria-selected', String(saveActive));
    saveToggle.tabIndex = saveActive ? 0 : -1;

    loadToggle.disabled = false;
    const loadActive = mode === 'load';
    loadToggle.classList.toggle('active', loadActive);
    loadToggle.setAttribute('aria-selected', String(loadActive));
    loadToggle.tabIndex = loadActive ? 0 : -1;

    /* panels */
    const showSave = mode === 'save' && canSave;
    const showLoad = mode === 'load';
    const hasMatch = Boolean(matchName);

    savePanel.style.display  = showSave ? 'grid' : 'none';
    loadPanel.style.display  = showLoad ? 'grid' : 'none';
    saveRow.style.display    = showSave && !hasMatch ? 'grid' : 'none';
    statusDiv.style.display  = showSave && hasMatch ? 'block' : 'none';
    if (showSave && hasMatch) {
      statusDiv.textContent = `Saved as: "${matchName}"`;
    }
    loadRow.style.display = showLoad ? 'grid' : 'none';

    confirmBtn.disabled = !showSave || !nameInput.value.trim();

    if (showLoad) populateDropdown();
    loadButton.disabled = !showLoad || !loadSelect.value;
  }

  /* ---- wire events ----------------------------------------------- */

  saveToggle.addEventListener('click', () => {
    if (saveToggle.disabled) return;
    setMode('save');
  });

  loadToggle.addEventListener('click', () => {
    if (loadToggle.disabled) return;
    setMode('load');
  });

  nameInput.addEventListener('input', () => update());

  confirmBtn.addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) return;
    const result = await config.onSave(name);
    if (result === false) return;
    nameInput.value = '';
    update();
  });

  loadSelect.addEventListener('change', () => {
    update();
  });

  loadButton.addEventListener('click', () => {
    const selected = loadSelect.value;
    if (!selected) return;
    config.onLoad(selected);
    update();
  });

  /* ---- initial render -------------------------------------------- */
  update();

  return { element: root, update };
}
