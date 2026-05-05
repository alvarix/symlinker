/**
 * projects.js
 *
 * Persistent store of projects and the items linked within them.
 * State lives in a single JSON file. The path is supplied by the caller
 * (so this module stays free of Electron's `app` dependency for testing).
 *
 * Schema:
 * {
 *   "version": 1,
 *   "projects": [
 *     {
 *       "id": "uuid",
 *       "name": "Display name",
 *       "sourceRoot": "/abs/path/to/repo",
 *       "destRoot": "/abs/path/to/vault/sub",
 *       "createdAt": "ISO",
 *       "items": [
 *         { "relPath": "docs", "type": "folder", "createdAt": "ISO" }
 *       ]
 *     }
 *   ]
 * }
 */

const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const CURRENT_VERSION = 1;

function emptyState() {
  return { version: CURRENT_VERSION, projects: [] };
}

class ProjectStore {
  constructor(filePath) {
    this.filePath = filePath;
    this._state = null;
  }

  async _load() {
    if (this._state) return this._state;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      // Migrate / sanity-check
      if (!parsed.projects) parsed.projects = [];
      if (!parsed.version) parsed.version = CURRENT_VERSION;
      this._state = parsed;
    } catch (err) {
      if (err.code === 'ENOENT') {
        this._state = emptyState();
      } else {
        throw err;
      }
    }
    return this._state;
  }

  async _save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = this.filePath + '.tmp';
    await fs.writeFile(tmp, JSON.stringify(this._state, null, 2), 'utf8');
    await fs.rename(tmp, this.filePath);
  }

  async list() {
    const state = await this._load();
    return state.projects.slice();
  }

  async get(id) {
    const state = await this._load();
    return state.projects.find((p) => p.id === id) || null;
  }

  async create({ name, sourceRoot, destRoot }) {
    const state = await this._load();
    const project = {
      id: crypto.randomUUID(),
      name: name || path.basename(sourceRoot),
      sourceRoot: path.resolve(sourceRoot),
      destRoot: path.resolve(destRoot),
      createdAt: new Date().toISOString(),
      items: [],
    };
    state.projects.push(project);
    await this._save();
    return project;
  }

  async update(id, patch) {
    const state = await this._load();
    const idx = state.projects.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error('Project not found: ' + id);
    state.projects[idx] = { ...state.projects[idx], ...patch, id };
    await this._save();
    return state.projects[idx];
  }

  async remove(id) {
    const state = await this._load();
    const before = state.projects.length;
    state.projects = state.projects.filter((p) => p.id !== id);
    if (state.projects.length === before) return false;
    await this._save();
    return true;
  }

  async addItem(projectId, item) {
    const state = await this._load();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Project not found: ' + projectId);
    if (!item.relPath) throw new Error('Item must have relPath');
    if (project.items.some((i) => i.relPath === item.relPath)) {
      throw new Error(`Item already tracked in this project: ${item.relPath}`);
    }
    const entry = {
      relPath: item.relPath,
      type: item.type || 'folder',
      createdAt: new Date().toISOString(),
    };
    project.items.push(entry);
    await this._save();
    return entry;
  }

  async removeItem(projectId, relPath) {
    const state = await this._load();
    const project = state.projects.find((p) => p.id === projectId);
    if (!project) throw new Error('Project not found: ' + projectId);
    const before = project.items.length;
    project.items = project.items.filter((i) => i.relPath !== relPath);
    if (project.items.length === before) return false;
    await this._save();
    return true;
  }
}

module.exports = { ProjectStore, CURRENT_VERSION };
