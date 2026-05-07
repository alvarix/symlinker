/**
 * preload.js
 *
 * Exposes a narrow API surface to the renderer. The renderer never touches
 * Node directly - everything goes through window.api.
 */

const { contextBridge, ipcRenderer } = require('electron');

function call(channel, ...args) {
  return ipcRenderer.invoke(channel, ...args).then((res) => {
    if (!res.ok) throw new Error(res.error);
    return res.data;
  });
}

contextBridge.exposeInMainWorld('api', {
  projects: {
    list: () => call('projects:list'),
    get: (id) => call('projects:get', id),
    create: (input) => call('projects:create', input),
    rename: (id, name) => call('projects:rename', { id, name }),
    remove: (id) => call('projects:remove', id),
  },
  items: {
    add: (projectId, relPath, opts = {}) =>
      call('items:add', { projectId, relPath, dryRun: !!opts.dryRun }),
    remove: (projectId, relPath, opts = {}) =>
      call('items:remove', { projectId, relPath, dryRun: !!opts.dryRun }),
    status: (projectId, relPath) => call('items:status', { projectId, relPath }),
    reverseAll: (projectId, opts = {}) =>
      call('items:reverseAll', { projectId, dryRun: !!opts.dryRun }),
    linkRoot: (projectId, opts = {}) =>
      call('items:linkRoot', { projectId, dryRun: !!opts.dryRun }),
  },
  dialog: {
    pickDirectory: (opts) => call('dialog:pickDirectory', opts),
    pickItem: (opts) => call('dialog:pickItem', opts),
  },
  shell: {
    reveal: (p) => call('shell:reveal', p),
  },
  paths: {
    relative: (from, to) => call('paths:relative', { from, to }),
    userData: () => call('paths:userData'),
  },
  source: {
    list: (sourceRoot) => call('source:list', sourceRoot),
  },
});
