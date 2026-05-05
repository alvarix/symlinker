/**
 * linker.js
 *
 * Core operations for moving a file/folder to a destination and leaving a
 * symlink at the original source path that points to the destination.
 *
 * Design goals:
 *   - Pure node: no Electron deps, fully testable.
 *   - Symmetric: `link` and `unlink` are inverses.
 *   - Safe: every destructive op validates state first, supports dryRun.
 *   - Honest status reporting so the UI can render real state.
 *
 * Status states returned by checkStatus(source, dest):
 *   "linked"          source is a symlink resolving to dest, dest exists
 *   "unlinked"        source is a real file/folder, dest does not exist
 *   "broken-target"   source is a symlink pointing somewhere other than dest
 *   "broken-dangling" source is a symlink whose target does not exist
 *   "missing-source"  source path does not exist at all, dest exists
 *   "conflict"        both source and dest exist as real files/folders
 *   "missing-both"    neither exists
 */

const fs = require('fs').promises;
const fssync = require('fs');
const path = require('path');

async function exists(p) {
  try {
    await fs.lstat(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
}

async function lstatSafe(p) {
  try {
    return await fs.lstat(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

async function statSafe(p) {
  try {
    return await fs.stat(p);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
}

function samePath(a, b) {
  return path.resolve(a) === path.resolve(b);
}

async function checkStatus(sourcePath, destPath) {
  const srcLstat = await lstatSafe(sourcePath);
  const destLstat = await lstatSafe(destPath);
  const sourceExists = !!srcLstat;
  const destExists = !!destLstat;
  const sourceIsSymlink = !!srcLstat && srcLstat.isSymbolicLink();

  let symlinkTarget = null;
  let symlinkTargetExists = false;
  if (sourceIsSymlink) {
    try {
      symlinkTarget = await fs.readlink(sourcePath);
      // Resolve relative symlinks against the link's parent dir
      const resolved = path.isAbsolute(symlinkTarget)
        ? symlinkTarget
        : path.resolve(path.dirname(sourcePath), symlinkTarget);
      const targetStat = await statSafe(resolved);
      symlinkTargetExists = !!targetStat;
      symlinkTarget = resolved;
    } catch {
      symlinkTarget = null;
    }
  }

  let state;
  if (!sourceExists && !destExists) {
    state = 'missing-both';
  } else if (sourceIsSymlink) {
    if (symlinkTarget && samePath(symlinkTarget, destPath) && destExists) {
      state = 'linked';
    } else if (!symlinkTargetExists) {
      state = 'broken-dangling';
    } else {
      state = 'broken-target';
    }
  } else if (sourceExists && !destExists) {
    state = 'unlinked';
  } else if (!sourceExists && destExists) {
    state = 'missing-source';
  } else {
    // Both exist, source is real
    state = 'conflict';
  }

  return {
    state,
    sourceExists,
    destExists,
    sourceIsSymlink,
    symlinkTarget,
    symlinkTargetExists,
    isFolder: srcLstat ? srcLstat.isDirectory() : (destLstat ? destLstat.isDirectory() : null),
  };
}

/**
 * Move source to dest, then create a symlink at source pointing to dest.
 * Idempotent: if already linked, returns immediately.
 */
async function link(sourcePath, destPath, opts = {}) {
  const { dryRun = false } = opts;
  const status = await checkStatus(sourcePath, destPath);
  const plan = [];

  switch (status.state) {
    case 'linked':
      return { ok: true, skipped: true, reason: 'already-linked', plan: [] };
    case 'unlinked': {
      // happy path
      const destParent = path.dirname(destPath);
      plan.push({ op: 'mkdir', path: destParent });
      plan.push({ op: 'rename', from: sourcePath, to: destPath });
      plan.push({ op: 'symlink', target: destPath, link: sourcePath });
      break;
    }
    case 'missing-source': {
      // Dest already has the file, just need to create the symlink
      plan.push({ op: 'symlink', target: destPath, link: sourcePath });
      break;
    }
    case 'conflict':
      throw new Error(
        `Cannot link: both source and destination exist as real files. ` +
        `Resolve manually:\n  source: ${sourcePath}\n  dest:   ${destPath}`
      );
    case 'broken-target':
      throw new Error(
        `Source is a symlink pointing elsewhere (${status.symlinkTarget}). ` +
        `Remove or fix it before linking.`
      );
    case 'broken-dangling':
      throw new Error(
        `Source is a dangling symlink. Remove it before linking.`
      );
    case 'missing-both':
      throw new Error(`Neither source nor destination exists: ${sourcePath}`);
    default:
      throw new Error(`Unknown state: ${status.state}`);
  }

  if (dryRun) return { ok: true, dryRun: true, plan };

  for (const step of plan) {
    if (step.op === 'mkdir') {
      await fs.mkdir(step.path, { recursive: true });
    } else if (step.op === 'rename') {
      await safeMove(step.from, step.to);
    } else if (step.op === 'symlink') {
      await fs.symlink(step.target, step.link);
    }
  }

  // Verify
  const after = await checkStatus(sourcePath, destPath);
  if (after.state !== 'linked') {
    throw new Error(`Link operation completed but verification failed: state=${after.state}`);
  }
  return { ok: true, plan };
}

/**
 * Reverse a link: remove symlink at source, move dest back to source.
 */
async function unlink(sourcePath, destPath, opts = {}) {
  const { dryRun = false } = opts;
  const status = await checkStatus(sourcePath, destPath);
  const plan = [];

  switch (status.state) {
    case 'linked':
      plan.push({ op: 'rmsymlink', path: sourcePath });
      plan.push({ op: 'rename', from: destPath, to: sourcePath });
      break;
    case 'unlinked':
      return { ok: true, skipped: true, reason: 'already-unlinked', plan: [] };
    case 'missing-source':
      // Source doesn't exist, dest does - move dest back
      plan.push({ op: 'rename', from: destPath, to: sourcePath });
      break;
    case 'broken-target':
    case 'broken-dangling':
      throw new Error(
        `Source symlink is in an unexpected state (${status.state}). ` +
        `Resolve manually before unlinking.`
      );
    case 'conflict':
      throw new Error(
        `Both source and destination exist as real files. Cannot determine what to do.`
      );
    case 'missing-both':
      return { ok: true, skipped: true, reason: 'nothing-to-do', plan: [] };
    default:
      throw new Error(`Unknown state: ${status.state}`);
  }

  if (dryRun) return { ok: true, dryRun: true, plan };

  for (const step of plan) {
    if (step.op === 'rmsymlink') {
      await fs.unlink(step.path);
    } else if (step.op === 'rename') {
      await safeMove(step.from, step.to);
    }
  }

  const after = await checkStatus(sourcePath, destPath);
  if (after.state !== 'unlinked') {
    throw new Error(`Unlink completed but verification failed: state=${after.state}`);
  }
  return { ok: true, plan };
}

/**
 * Move that falls back to copy+remove if rename hits EXDEV (cross-device).
 * Important for moving from local disk into iCloud-mounted folders.
 */
async function safeMove(from, to) {
  try {
    await fs.rename(from, to);
  } catch (err) {
    if (err.code === 'EXDEV') {
      await copyRecursive(from, to);
      await removeRecursive(from);
    } else {
      throw err;
    }
  }
}

async function copyRecursive(src, dest) {
  // node 16.7+ has fs.cp with recursive option
  if (fs.cp) {
    await fs.cp(src, dest, { recursive: true, errorOnExist: true, force: false });
    return;
  }
  // Fallback for older node
  const stat = await fs.lstat(src);
  if (stat.isDirectory()) {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src);
    for (const entry of entries) {
      await copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else if (stat.isSymbolicLink()) {
    const target = await fs.readlink(src);
    await fs.symlink(target, dest);
  } else {
    await fs.copyFile(src, dest);
  }
}

async function removeRecursive(p) {
  if (fs.rm) {
    await fs.rm(p, { recursive: true, force: true });
    return;
  }
  const stat = await fs.lstat(p);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(p);
    for (const entry of entries) {
      await removeRecursive(path.join(p, entry));
    }
    await fs.rmdir(p);
  } else {
    await fs.unlink(p);
  }
}

module.exports = {
  checkStatus,
  link,
  unlink,
  // exported for tests
  _internals: { safeMove, copyRecursive, removeRecursive, exists },
};
