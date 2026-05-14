# Spec: Two project modes (mirror, flat)

Status: draft
Source: `docs/p2.md`

## Problem

Today a project assumes one shape:

- `sourceRoot` is a folder (typically a dev repo).
- `destRoot` is a folder (typically an Obsidian vault subfolder).
- Each item lives at `sourceRoot/<relPath>` and is mirrored to `destRoot/<relPath>`. Symlink remains at source.

This works for "expose project docs in Obsidian." It does **not** work for the reverse use case: pulling a single Obsidian note into a project repo so an LLM can read it. The source's directory tree (`Areas/Work/note.md`) ends up mirrored under the project repo, which is wrong — the user wants the note at the project root.

## Solution

Introduce a per-project `mode`:

- `mirror` — current behavior. `destPath = destRoot/<relPath>`. Project → Obsidian.
- `flat` — new. `destPath = destRoot/<basename(relPath)>`. Obsidian → Project.

Linker semantics (`link`, `unlink`, `checkStatus`) do **not** change. Only the dest-path computation changes.

## Schema changes

`projects.json` items gain `mode`:

```json
{
  "id": "uuid",
  "name": "...",
  "mode": "mirror",          // new; defaults to "mirror" when missing
  "sourceRoot": "...",
  "destRoot": "...",
  "items": [
    { "relPath": "Areas/Work/note.md", "type": "file", "createdAt": "..." }
  ]
}
```

- `mode` is optional in stored data. Reader treats missing as `"mirror"` — no migration step needed.
- `relPath` continues to record location under `sourceRoot`. Reverse still moves the file back to `sourceRoot/<relPath>`.

## Path mapping helper

Single source of truth in `main.js` (or a small helper module):

```js
function destPathFor(project, relPath) {
  if (project.mode === 'flat') {
    return path.join(project.destRoot, path.basename(relPath));
  }
  return path.join(project.destRoot, relPath);
}
```

Used by `projects:list`, `projects:get`, `items:add`, `items:remove`, `items:status`, `items:reverseAll`. Replaces every existing `path.join(destRoot, relPath)` against a project.

## Settings

Add a second default:

- `defaultDestRoot` — existing, used as the default destRoot for `mirror` projects.
- `defaultFlatDestRoot` — new, default value `~/Sites` (expanded via `os.homedir()` at read time).

The new-project dialog reads whichever default matches the selected mode. Both are user-overridable in the existing default-destination control (add a second row, labeled by mode).

## UI changes

### New-project dialog

- Add a mode toggle (radio): "Project → Obsidian (mirror)" / "Obsidian → Project (flat)".
- When mode flips, swap which default destRoot fills the dest field (if empty).
- Source-root picker stays as a folder picker in both modes (`sourceRoot` is always a folder).

### Project detail view (flat mode)

- Hide the source browser list (recursive `.md` listing is wrong shape for a vault).
- Hide the "Link folder" button (`linkRoot`) — linking the whole vault into a repo is not the intent.
- Show an **Add file…** button. Click opens `pickItem` constrained to files under `sourceRoot`. Validate: chosen file must resolve inside `sourceRoot` (path.relative does not start with `..`).
- Items table displays just the basename for flat-mode items (so the user sees `note.md`, not `Areas/Work/note.md`).
- Per-item Reveal targets remain `destPath` and `sourcePath` — both still computed correctly via `destPathFor`.

### Project detail view (mirror mode)

- No change.

## Collision handling (flat mode)

In flat mode, two source files with different `relPath` but the same basename would land on the same `destPath`. Two layers:

1. **Disable in UI.** Before opening `pickItem` we know the tracked basenames in this project. After the user picks a file, if its basename is already linked, the Add-file flow:
   - shows an inline error in the dialog footer ("`note.md` is already linked from `Areas/Personal/note.md`"),
   - does not proceed.
2. **Refuse in core.** `items:add` validates basename uniqueness in flat mode before calling `linker.link`. Throws `Error('Basename collision: <name> already linked from <existing relPath>')`. This guards against direct IPC calls and stale UI state.

(1) is the primary UX, (2) is the safety net.

## Defaults summary

| Mode | sourceRoot picker | destRoot picker | destRoot default setting |
|---|---|---|---|
| mirror | folder | folder | `defaultDestRoot` |
| flat | folder | folder | `defaultFlatDestRoot` (init `~/Sites`) |

## Tests

New unit/integration tests added alongside existing `test/linker.test.js`:

- `destPathFor` returns mirrored path in `mirror` mode.
- `destPathFor` returns `destRoot/basename` in `flat` mode.
- `items:add` in flat mode places file at `destRoot/<basename>` and symlinks `sourceRoot/<relPath>` to it.
- `items:remove` (reverse) in flat mode moves the file back to `sourceRoot/<relPath>`.
- `items:add` refuses second flat-mode add with colliding basename.
- Legacy project record (no `mode` field) behaves as `mirror`.
- Reading and writing a project with `mode: 'flat'` round-trips through `projects.json`.

Existing tests must continue to pass unchanged (mirror behavior unaffected).

## Out of scope

- Per-item custom dest paths (more flexible than mode, but not requested).
- Renaming the file at the dest (e.g. `note.md` → `obsidian-note.md`).
- Bidirectional projects (one project covering both directions).
- Migrating an existing mirror project to flat or vice versa.

## Implementation order

One commit per step. Pause for testing after each.

1. **Schema + helper.** Add `mode` to the project store with default `'mirror'`. Add `destPathFor`. Replace every `path.join(destRoot, relPath)` call. All existing tests must still pass; no UI changes yet.
2. **Tests for path mapping and collision.** Add the test cases above. Drive a flat-mode project end-to-end via the linker in tests, without UI.
3. **Mode picker in new-project dialog.** Add radio, wire default-destRoot swap, default flat to `~/Sites`.
4. **Flat-mode UI in detail view.** Hide source browser + link-folder button. Add "Add file…" button using `pickItem`. Show basenames in the items table.
5. **Collision UX.** Pre-check basenames after pick, surface inline error.
6. **README + changelog.** Document both modes, the new default setting, and reverse-the-arrow examples.
