const path = require('path');
const fs = require('fs/promises');
const http = require('http');
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const projectService = require('./project-service.cjs');
const duckdbService = require('./duckdb-service.cjs');
const recentsService = require('./recents-service.cjs');

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

/** Send a File-menu action to the renderer, which owns the project handlers. */
function sendMenuAction(action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('desktop:menu', action);
  }
}

/** Build the native application menu. The File items mirror the project ops;
 *  clicks are forwarded to the renderer (see preload `onMenuAction`). */
function buildAppMenu() {
  const template = [];
  if (isMac) {
    template.push({ role: 'appMenu' });
  }
  template.push({
    label: 'File',
    submenu: [
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => sendMenuAction('open') },
      { label: 'New…', accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('new') },
      { label: 'Close', click: () => sendMenuAction('close') },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => sendMenuAction('save') },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  });
  // View menu: only full-screen (the default viewMenu's zoom items operate on
  // the web/HTML layer, which we don't want).
  template.push({
    label: 'View',
    submenu: [
      { role: 'togglefullscreen' }
    ]
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    title: 'OpenCAMA',
    show: false,
    autoHideMenuBar: false,
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

  const handleRedirect = (event, navigationUrl) => {
    if (navigationUrl.includes('code=') && navigationUrl.includes('state=')) {
      event.preventDefault();
      try {
        const urlObj = new URL(navigationUrl);
        const code = urlObj.searchParams.get('code');
        const state = urlObj.searchParams.get('state');
        const entryFile = resolveRendererEntry();
        mainWindow.loadFile(entryFile, { query: { code, state } });
      } catch (err) {
        console.error("Failed to parse navigation callback url", err);
      }
    }
  };

  mainWindow.webContents.on('will-navigate', (event, navigationUrl) => {
    const allowedPrefix = 'file://';
    if (!navigationUrl.startsWith(allowedPrefix)) {
      if (navigationUrl.startsWith('http://') || navigationUrl.startsWith('https://')) {
        handleRedirect(event, navigationUrl);
      } else {
        event.preventDefault();
      }
    }
  });

  mainWindow.webContents.on('will-redirect', (event, navigationUrl) => {
    handleRedirect(event, navigationUrl);
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

// Perf lines forwarded from the renderer print to the terminal during profiling.
ipcMain.on('desktop:perf', (_evt, line) => {
  console.log(String(line));
});

ipcMain.handle('desktop:getAppConfig', async () => {
  return {
    mode: 'desktop',
    platform: process.platform,
    userDataDir: app.getPath('userData'),
    projectRoot: currentProjectRoot
  };
});

/* ----------------------------------------------------------------------- */
/*  Project lifecycle + database IPC (Milestones 2, 4, 5)                  */
/* ----------------------------------------------------------------------- */

// Pick (or create) the folder that will BE the project root.
ipcMain.handle('desktop:pickProjectDir', async () => {
  if (!mainWindow) throw new Error('Main window unavailable.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose or create the project folder',
    buttonLabel: 'Use This Folder',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, projectRoot: path.resolve(result.filePaths[0]) };
});

ipcMain.handle('desktop:project:create', async (_evt, projectRoot) => {
  const { projectRoot: root, meta } = await projectService.createProject(projectRoot);
  currentProjectRoot = root;
  await recentsService.recordRecent(root, meta?.name);
  return { projectRoot: root, meta };
});

ipcMain.handle('desktop:project:recent', async () => {
  return recentsService.listRecents();
});

ipcMain.handle('desktop:project:open', async (_evt, projectRoot) => {
  // Allow opening via folder picker when no path is supplied.
  let target = projectRoot;
  if (!target) {
    if (!mainWindow) throw new Error('Main window unavailable.');
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Open VIZ Project Folder',
      properties: ['openDirectory']
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    target = path.resolve(result.filePaths[0]);
  }
  const { projectRoot: root, meta } = await projectService.openProject(target);
  currentProjectRoot = root;
  await recentsService.recordRecent(root, meta?.name);
  return { canceled: false, projectRoot: root, meta };
});

ipcMain.handle('desktop:project:delete', async (_evt, projectRoot) => {
  const result = await projectService.deleteProject(projectRoot ?? currentProjectRoot);
  if ((projectRoot ?? currentProjectRoot) === currentProjectRoot) {
    currentProjectRoot = null;
  }
  return result;
});

ipcMain.handle('desktop:project:saveAppState', async (_evt, appBlock) => {
  if (!currentProjectRoot) throw new Error('No active project.');
  return projectService.saveAppState(currentProjectRoot, appBlock);
});

ipcMain.handle('desktop:project:close', async () => {
  await duckdbService.closeDatabase().catch(() => {});
  currentProjectRoot = null;
  return { ok: true };
});

ipcMain.handle('desktop:project:current', async () => {
  if (!currentProjectRoot) return { projectRoot: null, meta: null };
  const meta = await projectService.readProjectFile(currentProjectRoot).catch(() => null);
  return { projectRoot: currentProjectRoot, meta };
});

// Pick a data source file to import.
ipcMain.handle('desktop:pickSourceFile', async () => {
  if (!mainWindow) throw new Error('Main window unavailable.');
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select data source to import',
    properties: ['openFile'],
    filters: [
      { name: 'Geospatial', extensions: ['parquet', 'geojson', 'json', 'gpkg', 'fgb', 'zip', 'shp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return { canceled: true };
  return { canceled: false, sourcePath: path.resolve(result.filePaths[0]) };
});

ipcMain.handle('desktop:db:importSource', async (_evt, opts) => {
  if (!currentProjectRoot) throw new Error('No active project.');
  return projectService.importSource({ ...opts, projectRoot: currentProjectRoot });
});

ipcMain.handle('desktop:db:query', async (_evt, sql, params) => {
  return duckdbService.query(String(sql), Array.isArray(params) ? params : []);
});

ipcMain.handle('desktop:db:exec', async (_evt, sql, params) => {
  return duckdbService.exec(String(sql), Array.isArray(params) ? params : []);
});

ipcMain.handle('desktop:exchangeToken', async (_evt, tokenEndpoint, params) => {
  const response = await fetch(tokenEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(params).toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Token exchange failed: ${response.status} ${response.statusText}. Details: ${errorText}`);
  }

  return await response.json();
});

let oidcServer = null;

function startOidcServer() {
  oidcServer = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const urlObj = new URL(req.url, 'http://localhost:5173');
    const code = urlObj.searchParams.get('code');
    const state = urlObj.searchParams.get('state');

    if (code && state) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        const entryFile = resolveRendererEntry();
        mainWindow.loadFile(entryFile, { query: { code, state } });
        mainWindow.focus();
      }
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>Login Successful</title>
            <style>
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                background-color: #0f172a;
                color: #f8fafc;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
              }
              h2 { color: #38bdf8; margin-bottom: 8px; }
              p { color: #94a3b8; font-size: 14px; }
            </style>
          </head>
          <body>
            <h2>Login Successful!</h2>
            <p>You can close this tab and return to the OpenCAMA app.</p>
            <script>
              setTimeout(() => { window.close(); }, 3000);
            </script>
          </body>
        </html>
      `);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
    }
  });

  oidcServer.listen(5173, () => {
    console.log('OIDC Desktop redirect server listening on port 5173');
  });

  oidcServer.on('error', (err) => {
    console.error('Failed to start OIDC Desktop redirect server (port 5173 might be in use):', err);
  });
}

app.whenReady().then(async () => {
  buildAppMenu();
  startOidcServer();
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

app.on('before-quit', async () => {
  if (oidcServer) {
    oidcServer.close();
  }
  await duckdbService.closeDatabase().catch(() => {});
});
