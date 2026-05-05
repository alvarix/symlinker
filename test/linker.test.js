/**
 * Smoke test for lib/linker.js. Pure node, no Electron required.
 *
 * Run:  node test/linker.test.js
 *
 * Exits non-zero on any failure.
 */

const fs = require('fs').promises;
const path = require('path');
const os = require('os');
const { ProjectStore } = require('../lib/projects');
const linker = require('../lib/linker');

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
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'symlinker-test-'));
  await fs.mkdir(path.join(root, 'source', 'docs'), { recursive: true });
  await fs.writeFile(path.join(root, 'source', 'docs', 'README.md'), '# hi');
  await fs.writeFile(path.join(root, 'source', 'docs', 'guide.md'), 'guide');
  await fs.writeFile(path.join(root, 'source', 'NOTES.md'), 'top-level note');
  await fs.mkdir(path.join(root, 'dest'), { recursive: true });
  return root;
}

async function rmrf(p) {
  await fs.rm(p, { recursive: true, force: true });
}

async function testFolderLinkAndUnlink() {
  console.log('\n# folder link + unlink');
  const root = await makeWorkspace();
  try {
    const src = path.join(root, 'source', 'docs');
    const dest = path.join(root, 'dest', 'docs');

    let st = await linker.checkStatus(src, dest);
    assert(st.state === 'unlinked', 'initial state is unlinked');

    const linkResult = await linker.link(src, dest);
    assert(linkResult.ok, 'link returns ok');

    st = await linker.checkStatus(src, dest);
    assert(st.state === 'linked', 'state is linked after link()');

    // Symlink readability: file inside should be reachable through the symlink
    const guide = await fs.readFile(path.join(src, 'guide.md'), 'utf8');
    assert(guide === 'guide', 'file is readable through symlink');

    // Idempotent
    const dup = await linker.link(src, dest);
    assert(dup.skipped, 'link is idempotent');

    const unlinkResult = await linker.unlink(src, dest);
    assert(unlinkResult.ok, 'unlink returns ok');

    st = await linker.checkStatus(src, dest);
    assert(st.state === 'unlinked', 'state is unlinked after unlink()');

    const guideAfter = await fs.readFile(path.join(src, 'guide.md'), 'utf8');
    assert(guideAfter === 'guide', 'file is still readable after reverse');
  } finally {
    await rmrf(root);
  }
}

async function testFileLink() {
  console.log('\n# single file link + unlink');
  const root = await makeWorkspace();
  try {
    const src = path.join(root, 'source', 'NOTES.md');
    const dest = path.join(root, 'dest', 'NOTES.md');

    await linker.link(src, dest);
    const st = await linker.checkStatus(src, dest);
    assert(st.state === 'linked', 'file linked');
    assert(st.isFolder === false, 'is detected as file');

    const text = await fs.readFile(src, 'utf8');
    assert(text === 'top-level note', 'file readable through symlink');

    await linker.unlink(src, dest);
    const st2 = await linker.checkStatus(src, dest);
    assert(st2.state === 'unlinked', 'file unlinked');
  } finally {
    await rmrf(root);
  }
}

async function testDryRun() {
  console.log('\n# dry run does not touch disk');
  const root = await makeWorkspace();
  try {
    const src = path.join(root, 'source', 'docs');
    const dest = path.join(root, 'dest', 'docs');
    const result = await linker.link(src, dest, { dryRun: true });
    assert(result.dryRun === true, 'dry run flagged');
    assert(Array.isArray(result.plan) && result.plan.length > 0, 'dry run returns a plan');
    const st = await linker.checkStatus(src, dest);
    assert(st.state === 'unlinked', 'state unchanged after dry run');
  } finally {
    await rmrf(root);
  }
}

async function testConflict() {
  console.log('\n# conflict when both source and dest are real');
  const root = await makeWorkspace();
  try {
    const src = path.join(root, 'source', 'docs');
    const dest = path.join(root, 'dest', 'docs');
    await fs.mkdir(dest, { recursive: true });
    await fs.writeFile(path.join(dest, 'other.md'), 'other');
    const st = await linker.checkStatus(src, dest);
    assert(st.state === 'conflict', 'detected as conflict');
    let threw = false;
    try {
      await linker.link(src, dest);
    } catch {
      threw = true;
    }
    assert(threw, 'link refuses on conflict');
  } finally {
    await rmrf(root);
  }
}

async function testProjectStore() {
  console.log('\n# project store CRUD');
  const root = await makeWorkspace();
  try {
    const storePath = path.join(root, 'projects.json');
    const store = new ProjectStore(storePath);
    const p = await store.create({
      name: 'demo',
      sourceRoot: path.join(root, 'source'),
      destRoot: path.join(root, 'dest'),
    });
    assert(!!p.id, 'project gets an id');

    await store.addItem(p.id, { relPath: 'docs', type: 'folder' });

    // Reload from disk
    const store2 = new ProjectStore(storePath);
    const list = await store2.list();
    assert(list.length === 1 && list[0].items.length === 1, 'state persisted to disk');

    let dup = false;
    try {
      await store2.addItem(p.id, { relPath: 'docs', type: 'folder' });
    } catch {
      dup = true;
    }
    assert(dup, 'duplicate item rejected');

    const removedItem = await store2.removeItem(p.id, 'docs');
    assert(removedItem === true, 'removeItem returns true on hit');

    const removedProj = await store2.remove(p.id);
    assert(removedProj === true, 'remove returns true on hit');

    const empty = await store2.list();
    assert(empty.length === 0, 'project list empty after remove');
  } finally {
    await rmrf(root);
  }
}

async function main() {
  console.log('symlinker smoke tests');
  await testFolderLinkAndUnlink();
  await testFileLink();
  await testDryRun();
  await testConflict();
  await testProjectStore();
  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Test runner error:', err);
  process.exit(1);
});
