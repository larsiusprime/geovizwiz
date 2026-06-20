const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = {
  // --- Legacy folder/file helpers (Milestone 1) ---
  selectProjectFolder: () => ipcRenderer.invoke('desktop:selectProjectFolder'),
  createProjectFolder: (parentDir, projectFolderName) => ipcRenderer.invoke('desktop:createProjectFolder', parentDir, projectFolderName),
  readTextFile: (relativePath) => ipcRenderer.invoke('desktop:readTextFile', relativePath),
  writeTextFile: (relativePath, content) => ipcRenderer.invoke('desktop:writeTextFile', relativePath, content),
  getAppConfig: () => ipcRenderer.invoke('desktop:getAppConfig'),

  // --- Perf profiling (desktop only) ---
  perf: (line) => ipcRenderer.send('desktop:perf', line),

  // --- Native menu bridge ---
  // Subscribe to native File-menu actions ('open' | 'new' | 'close' | 'save').
  onMenuAction: (cb) => {
    const listener = (_evt, action) => cb(action);
    ipcRenderer.on('desktop:menu', listener);
    return () => ipcRenderer.removeListener('desktop:menu', listener);
  },

  // --- Project lifecycle (Milestone 2) ---
  pickProjectDir: () => ipcRenderer.invoke('desktop:pickProjectDir'),
  project: {
    create: (projectRoot) => ipcRenderer.invoke('desktop:project:create', projectRoot),
    open: (projectRoot) => ipcRenderer.invoke('desktop:project:open', projectRoot),
    close: () => ipcRenderer.invoke('desktop:project:close'),
    recent: () => ipcRenderer.invoke('desktop:project:recent'),
    delete: (projectRoot) => ipcRenderer.invoke('desktop:project:delete', projectRoot),
    current: () => ipcRenderer.invoke('desktop:project:current'),
    saveAppState: (appBlock) => ipcRenderer.invoke('desktop:project:saveAppState', appBlock)
  },

  // --- Import + database (Milestones 4, 5) ---
  pickSourceFile: () => ipcRenderer.invoke('desktop:pickSourceFile'),
  db: {
    importSource: (opts) => ipcRenderer.invoke('desktop:db:importSource', opts),
    query: (sql, params) => ipcRenderer.invoke('desktop:db:query', sql, params),
    exec: (sql, params) => ipcRenderer.invoke('desktop:db:exec', sql, params)
  }
};

contextBridge.exposeInMainWorld('vizDesktop', desktopApi);
