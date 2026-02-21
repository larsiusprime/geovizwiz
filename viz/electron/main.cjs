const path = require('path');
const fs = require('fs/promises');
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');

const isMac = process.platform === 'darwin';
let mainWindow = null;
let currentProjectRoot = null;

function resolveRendererEntry() {
  return path.join(__dirname, '..', 'dist', 'index.html');
}

function isPathInsideProjectRoot(candidatePath) {
  if (!currentProjectRoot) return false;
  const root = path.resolve(currentProjectRoot);
  const candidate = path.resolve(candidatePath);
  return candidate === root || candidate.startsWith(`${root}${path.sep}`);
}

function assertProjectBoundPath(candidatePath) {
  if (!currentProjectRoot) {
    throw new Error('No active project root selected.');
  }
  if (!isPathInsideProjectRoot(candidatePath)) {
    throw new Error('Path is outside active project root.');
  }
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) {
      void shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowedPrefix = 'file://';
    if (!navigationUrl.startsWith(allowedPrefix)) {
      event.preventDefault();
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  await mainWindow.loadFile(resolveRendererEntry());
}

ipcMain.handle('desktop:selectProjectFolder', async () => {
  if (!mainWindow) throw new Error('Main window unavailable.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select VIZ Project Folder',
    properties: ['openDirectory', 'createDirectory']
  });

  if (result.canceled || !result.filePaths[0]) {
    return { canceled: true };
  }

  currentProjectRoot = path.resolve(result.filePaths[0]);
  return { canceled: false, projectRoot: currentProjectRoot };
});

ipcMain.handle('desktop:createProjectFolder', async (_evt, parentDir, projectFolderName) => {
  if (!parentDir || !projectFolderName) {
    throw new Error('parentDir and projectFolderName are required.');
  }

  const folderName = String(projectFolderName).trim();
  if (!folderName) {
    throw new Error('projectFolderName cannot be empty.');
  }

  const target = path.resolve(parentDir, folderName);
  await fs.mkdir(target, { recursive: true });
  currentProjectRoot = target;
  return { projectRoot: currentProjectRoot };
});

ipcMain.handle('desktop:readTextFile', async (_evt, relativePath) => {
  if (!relativePath) throw new Error('relativePath is required.');
  const target = path.resolve(currentProjectRoot ?? '', String(relativePath));
  assertProjectBoundPath(target);
  const content = await fs.readFile(target, 'utf-8');
  return { content };
});

ipcMain.handle('desktop:writeTextFile', async (_evt, relativePath, content) => {
  if (!relativePath) throw new Error('relativePath is required.');
  const target = path.resolve(currentProjectRoot ?? '', String(relativePath));
  assertProjectBoundPath(target);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, String(content ?? ''), 'utf-8');
  return { ok: true };
});

ipcMain.handle('desktop:getAppConfig', async () => {
  return {
    mode: 'desktop',
    platform: process.platform,
    userDataDir: app.getPath('userData'),
    projectRoot: currentProjectRoot
  };
});

app.whenReady().then(async () => {
  await createWindow();

  app.on('activate', async () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      await createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
