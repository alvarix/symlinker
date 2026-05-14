/**
 * Path helpers for dest-path computation.
 * Extracted so tests can import them without Electron.
 */

const path = require('path');

/**
 * Compute the destination path for an item, respecting the project's mode.
 * - mirror (default): destRoot/<relPath>  — preserves directory hierarchy
 * - flat:             destRoot/<basename> — collapses hierarchy to a single level
 *
 * @param {{ destRoot: string, mode?: string }} project
 * @param {string} relPath
 * @returns {string}
 */
function destPathFor(project, relPath) {
  if (project.mode === 'flat') {
    return path.join(project.destRoot, path.basename(relPath));
  }
  return path.join(project.destRoot, relPath);
}

/**
 * In flat mode, assert that no existing item in the project shares a basename
 * with relPath. Throws if a collision is found — call before linker.link.
 *
 * No-op for mirror-mode projects.
 *
 * @param {{ mode?: string, items: Array<{ relPath: string }> }} project
 * @param {string} relPath
 */
function validateFlatBasename(project, relPath) {
  if (project.mode !== 'flat') return;
  const basename = path.basename(relPath);
  const collision = project.items.find((i) => path.basename(i.relPath) === basename);
  if (collision) {
    throw new Error(`Basename collision: ${basename} already linked from ${collision.relPath}`);
  }
}

module.exports = { destPathFor, validateFlatBasename };
