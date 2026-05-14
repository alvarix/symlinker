/**
 * Tests for two-mode path mapping (mirror / flat).
 *
 * Run:  node test/modes.test.js
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { ProjectStore } = require('../lib/projects');
const linker = require('../lib/linker');
const { destPathFor, validateFlatBasename } = require('../lib/paths');

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log('  ok  ' + msg);
  } else {
    fail++;
    console.log('  FAIL ' + msg);
  }
}

async function makeWorkspace() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'symlinker-modes-'));
  // source/Areas/Work/note.md — nested path to verify flat mode collapses it
  await fs.mkdir(path.join(root, 'source', 'Areas', 'Work'), { recursive: true });
  await fs.writeFile(path.join(root, 'source', 'Areas', 'Work', 'note.md'), 'note content');
  await fs.writeFile(path.join(root, 'source', 'Areas', 'Work', 'other.md'), 'other content');
  await fs.mkdir(path.join(root, 'dest'), { recursive: true });
  return root;
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

// ── destPathFor unit tests ────────────────────────────────────────────────

function testDestPathForMirror() {
  console.log('\n# destPathFor — mirror mode');
  const project = { destRoot: '/vault/notes', mode: 'mirror' };
  assert(
    destPathFor(project, 'Areas/Work/note.md') === '/vault/notes/Areas/Work/note.md',
    'mirror: preserves full relPath'
  );
}

function testDestPathForFlat() {
  console.log('\n# destPathFor — flat mode');
  const project = { destRoot: '/repo', mode: 'flat' };
  assert(
    destPathFor(project, 'Areas/Work/note.md') === '/repo/note.md',
    'flat: collapses to basename only'
  );
}

function testDestPathForLegacy() {
  console.log('\n# destPathFor — legacy project (no mode field)');
  const project = { destRoot: '/vault/notes' }; // no mode field
  assert(
    destPathFor(project, 'Areas/Work/note.md') === '/vault/notes/Areas/Work/note.md',
    'legacy (undefined mode) behaves as mirror'
  );
}

// ── Store round-trip ──────────────────────────────────────────────────────

async function testFlatModeRoundTrip() {
  console.log('\n# store round-trip — flat project');
  const root = await makeWorkspace();
  try {
    const storePath = path.join(root, 'projects.json');
    const store = new ProjectStore(storePath);
    const p = await store.create({
      name: 'flat-demo',
      sourceRoot: path.join(root, 'source'),
      destRoot: path.join(root, 'dest'),
      mode: 'flat',
    });
    assert(p.mode === 'flat', 'mode stored on create');

    const store2 = new ProjectStore(storePath);
    const list = await store2.list();
    assert(list[0].mode === 'flat', 'mode round-trips through JSON');
  } finally {
    await rmrf(root);
  }
}

// ── Flat-mode link / unlink integration ──────────────────────────────────

async function testFlatLink() {
  console.log('\n# flat mode — link places file at destRoot/basename');
  const root = await makeWorkspace();
  try {
    const project = {
      sourceRoot: path.join(root, 'source'),
      destRoot: path.join(root, 'dest'),
      mode: 'flat',
    };
    const relPath = 'Areas/Work/note.md';
    const sourcePath = path.join(project.sourceRoot, relPath);
    const destPath = destPathFor(project, relPath);

    assert(destPath === path.join(root, 'dest', 'note.md'), 'destPath is at destRoot/note.md');

    await linker.link(sourcePath, destPath);

    const st = await linker.checkStatus(sourcePath, destPath);
    assert(st.state === 'linked', 'item is linked after flat link()');

    // symlink lives at sourcePath, real file at destPath
    const lstat = await fs.lstat(sourcePath);
    assert(lstat.isSymbolicLink(), 'source path is now a symlink');

    const content = await fs.readFile(sourcePath, 'utf8');
    assert(content === 'note content', 'file readable through symlink');
  } finally {
    await rmrf(root);
  }
}

async function testFlatUnlink() {
  console.log('\n# flat mode — unlink (reverse) moves file back to sourceRoot/relPath');
  const root = await makeWorkspace();
  try {
    const project = {
      sourceRoot: path.join(root, 'source'),
      destRoot: path.join(root, 'dest'),
      mode: 'flat',
    };
    const relPath = 'Areas/Work/note.md';
    const sourcePath = path.join(project.sourceRoot, relPath);
    const destPath = destPathFor(project, relPath);

    await linker.link(sourcePath, destPath);
    await linker.unlink(sourcePath, destPath);

    const st = await linker.checkStatus(sourcePath, destPath);
    assert(st.state === 'unlinked', 'state is unlinked after reverse');

    // real file back at original nested location
    const lstat = await fs.lstat(sourcePath);
    assert(!lstat.isSymbolicLink(), 'source is a real file again');

    const content = await fs.readFile(sourcePath, 'utf8');
    assert(content === 'note content', 'content intact after reverse');
  } finally {
    await rmrf(root);
  }
}

// ── Collision handling ────────────────────────────────────────────────────

function testCollisionRefused() {
  console.log('\n# flat mode — basename collision refused');
  const project = {
    sourceRoot: '/repo',
    destRoot: '/vault',
    mode: 'flat',
    items: [{ relPath: 'Areas/Personal/note.md', type: 'file' }],
  };

  let threw = false;
  let msg = '';
  try {
    validateFlatBasename(project, 'Areas/Work/note.md');
  } catch (err) {
    threw = true;
    msg = err.message;
  }
  assert(threw, 'collision throws');
  assert(msg.includes('note.md'), 'error names the colliding basename');
  assert(msg.includes('Areas/Personal/note.md'), 'error names the existing item');
}

function testCollisionMirrorPassthrough() {
  console.log('\n# mirror mode — duplicate basename is fine (different paths)');
  const project = {
    sourceRoot: '/repo',
    destRoot: '/vault',
    mode: 'mirror',
    items: [{ relPath: 'Areas/Personal/note.md', type: 'file' }],
  };
  let threw = false;
  try {
    validateFlatBasename(project, 'Areas/Work/note.md');
  } catch {
    threw = true;
  }
  assert(!threw, 'mirror mode ignores basename collisions');
}

// ── Runner ────────────────────────────────────────────────────────────────

async function main() {
  console.log('symlinker modes tests');

  testDestPathForMirror();
  testDestPathForFlat();
  testDestPathForLegacy();
  await testFlatModeRoundTrip();
  await testFlatLink();
  await testFlatUnlink();
  testCollisionRefused();
  testCollisionMirrorPassthrough();

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
