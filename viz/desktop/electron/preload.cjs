const { contextBridge, ipcRenderer } = require('electron');

const desktopApi = {
  selectProjectFolder: () => ipcRenderer.invoke('desktop:selectProjectFolder'),
  createProjectFolder: (parentDir, projectFolderName) => ipcRenderer.invoke('desktop:createProjectFolder', parentDir, projectFolderName),
  readTextFile: (relativePath) => ipcRenderer.invoke('desktop:readTextFile', relativePath),
  writeTextFile: (relativePath, content) => ipcRenderer.invoke('desktop:writeTextFile', relativePath, content),
  getAppConfig: () => ipcRenderer.invoke('desktop:getAppConfig')
};

contextBridge.exposeInMainWorld('vizDesktop', desktopApi);
