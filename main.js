/**
 * Electron main process.
 *
 * Owns the project store and exposes link/unlink/scan operations to the
 * renderer over IPC. Renderer talks to it through the preload bridge
 * (window.api.*).
 */

const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs').promises;

const { ProjectStore } = require('./lib/projects');
const linker = require('./lib/linker');

let store;
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 760,
    minHeight: 480,
    title: 'Symlinker',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(async () => {
  const userData = app.getPath('userData');
  store = new ProjectStore(path.join(userData, 'projects.json'));
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// ---------- IPC handlers ----------

function wrap(fn) {
  return async (event, ...args) => {
    try {
      const data = await fn(...args);
      return { ok: true, data };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };
}

ipcMain.handle('projects:list', wrap(async () => {
  const projects = await store.list();
  // Annotate with item statuses
  const annotated = await Promise.all(
    projects.map(async (p) => ({
      ...p,
      itemStatuses: await Promise.all(
        p.items.map(async (item) => {
          const sourcePath = path.join(p.sourceRoot, item.relPath);
          const destPath = path.join(p.destRoot, item.relPath);
          const status = await linker.checkStatus(sourcePath, destPath);
          return { relPath: item.relPath, ...status };
        })
      ),
    }))
  );
  return annotated;
}));

ipcMain.handle('projects:get', wrap(async (id) => {
  const project = await store.get(id);
  if (!project) throw new Error('Project not found');
  const itemStatuses = await Promise.all(
    project.items.map(async (item) => {
      const sourcePath = path.join(project.sourceRoot, item.relPath);
      const destPath = path.join(project.destRoot, item.relPath);
      const status = await linker.checkStatus(sourcePath, destPath);
      return { ...item, ...status };
    })
  );
  return { ...project, items: itemStatuses };
}));

ipcMain.handle('projects:create', wrap(async ({ name, sourceRoot, destRoot }) => {
  // Validate roots
  try {
    const stat = await fs.stat(sourceRoot);
    if (!stat.isDirectory()) throw new Error('Source root is not a directory');
  } catch (err) {
    if (err.code === 'ENOENT') throw new Error('Source root does not exist');
    throw err;
  }
  // Dest root: create if missing
  await fs.mkdir(destRoot, { recursive: true });
  return store.create({ name, sourceRoot, destRoot });
}));

ipcMain.handle('projects:rename', wrap(async ({ id, name }) => {
  return store.update(id, { name });
}));

ipcMain.handle('projects:remove', wrap(async (id) => {
  return store.remove(id);
}));

ipcMain.handle('items:add', wrap(async ({ projectId, relPath, dryRun }) => {
  const project = await store.get(projectId);
  if (!project) throw new Error('Project not found');
  const sourcePath = path.join(project.sourceRoot, relPath);
  const destPath = path.join(project.destRoot, relPath);
  // Determine type from source
  let type = 'folder';
  try {
    const stat = await fs.lstat(sourcePath);
    type = stat.isDirectory() ? 'folder' : 'file';
  } catch {
    // Source might already be missing if dest exists - try dest
    try {
      const stat = await fs.lstat(destPath);
      type = stat.isDirectory() ? 'folder' : 'file';
    } catch {
      throw new Error('Neither source nor destination exists for ' + relPath);
    }
  }
  const result = await linker.link(sourcePath, destPath, { dryRun });
  if (!dryRun) {
    try {
      await store.addItem(projectId, { relPath, type });
    } catch (err) {
      // If already tracked, that's fine
      if (!String(err.message).includes('already tracked')) throw err;
    }
  }
  return result;
}));

ipcMain.handle('items:remove', wrap(async ({ projectId, relPath, dryRun }) => {
  const project = await store.get(projectId);
  if (!project) throw new Error('Project not found');
  const sourcePath = path.join(project.sourceRoot, relPath);
  const destPath = path.join(project.destRoot, relPath);
  const result = await linker.unlink(sourcePath, destPath, { dryRun });
  if (!dryRun) {
    await store.removeItem(projectId, relPath);
  }
  return result;
}));

ipcMain.handle('items:status', wrap(async ({ projectId, relPath }) => {
  const project = await store.get(projectId);
  if (!project) throw new Error('Project not found');
  const sourcePath = path.join(project.sourceRoot, relPath);
  const destPath = path.join(project.destRoot, relPath);
  return linker.checkStatus(sourcePath, destPath);
}));

ipcMain.handle('items:reverseAll', wrap(async ({ projectId, dryRun }) => {
  const project = await store.get(projectId);
  if (!project) throw new Error('Project not found');
  const results = [];
  for (const item of project.items) {
    const sourcePath = path.join(project.sourceRoot, item.relPath);
    const destPath = path.join(project.destRoot, item.relPath);
    try {
      const r = await linker.unlink(sourcePath, destPath, { dryRun });
      results.push({ relPath: item.relPath, ok: true, ...r });
      if (!dryRun) await store.removeItem(projectId, item.relPath);
    } catch (err) {
      results.push({ relPath: item.relPath, ok: false, error: err.message });
    }
  }
  return results;
}));

ipcMain.handle('dialog:pickDirectory', wrap(async ({ title, defaultPath } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose folder',
    defaultPath: defaultPath || undefined,
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}));

ipcMain.handle('dialog:pickItem', wrap(async ({ title, defaultPath } = {}) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: title || 'Choose file or folder',
    defaultPath: defaultPath || undefined,
    properties: ['openFile', 'openDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
}));

ipcMain.handle('shell:reveal', wrap(async (p) => {
  shell.showItemInFolder(p);
  return true;
}));

ipcMain.handle('paths:relative', wrap(async ({ from, to }) => {
  return path.relative(from, to);
}));

ipcMain.handle('paths:userData', wrap(async () => app.getPath('userData')));

ipcMain.handle('source:list', wrap(async (sourceRoot) => {
  const entries = await fs.readdir(sourceRoot, { withFileTypes: true });
  return entries
    .filter(e => !e.name.startsWith('.'))
    .map(e => ({
      name: e.name,
      relPath: e.name,
      type: e.isDirectory() ? 'folder' : 'file',
    }));
}));
