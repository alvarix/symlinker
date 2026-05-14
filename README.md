# Symlinker

A small Electron app for moving files or folders out of one location and into another, while leaving a symlink behind in the original spot. Supports two directions: pushing project docs into an Obsidian vault, or pulling individual vault notes into a project repo.

## What it does

Each project pairs a source root with a destination root and operates in one of two modes:

**Mirror (Project → Obsidian):** moves files from a dev repo into a vault, preserving the folder hierarchy. `~/Sites/myrepo/docs` becomes a symlink to `~/Vault/SymDocs/myrepo/docs`. Reading, editing, and committing through the source path all still work because the symlink is transparent.

**Flat (Obsidian → Project):** pulls individual vault notes into a project root, collapsing the vault's folder hierarchy. `Areas/Work/note.md` inside the vault becomes a symlink at `~/Sites/myrepo/note.md` pointing to the actual file at the vault path. The project gets a single-level view of the notes it needs.

For each item you add, the app:

1. Moves the item from the source path to the destination path (creating parent folders as needed).
2. Replaces the original location with a symlink pointing at the destination.

Reversing is a single click: the app removes the symlink and moves the item back where it came from.

## Modes

| Mode | Direction | Dest path | Use case |
|---|---|---|---|
| `mirror` | Project → Obsidian | `destRoot/<relPath>` | Expose repo docs in a vault subfolder |
| `flat` | Obsidian → Project | `destRoot/<basename>` | Pull vault notes into a project for LLM context |

The mode is chosen when creating a project and stored in `projects.json`. Existing projects without a `mode` field are treated as `mirror`.

### Flat mode details

- Source browser and "Link folder" are hidden (they don't apply to vault navigation).
- An **Add file…** button opens a file picker constrained to the source root.
- If two files share a basename (e.g. `Areas/Work/note.md` and `Areas/Personal/note.md`), the second add is refused with an inline error naming the conflict.
- The items table shows just the basename (`note.md`) rather than the full vault path.

## Features

- Two project modes: `mirror` (Project → Obsidian) and `flat` (Obsidian → Project).
- One source root + one destination root per project, with any number of linked items inside.
- Files or folders in mirror mode; files only in flat mode.
- Live status per item: `linked`, `unlinked`, `broken-target`, `broken-dangling`, `missing-source`, `conflict`, `missing-both`.
- Dry-run toggle in the sidebar: every action prints its plan instead of touching disk.
- Per-item reverse, plus reverse-all on a project.
- Re-link button repairs a broken symlink without re-moving the file.
- Separate default-destination settings for mirror and flat modes (flat defaults to `~/Sites`).
- State stored in the OS userData dir as `projects.json`. Files on disk are the source of truth: deleting a project from Symlinker does not move anything.

## Install and run

Requires Node 18+ and npm.

```sh
cd ~/Sites/apps/symlinker
npm install
npm start
```

Run the smoke test against the linker module:

```sh
npm test
```

## Updating the app after code changes

| What changed | How to apply |
|---|---|
| `renderer/` (HTML, CSS, app.js) | `Cmd+R` in the Electron window |
| `main.js` or `preload.js` | Kill the process, run `npm start` again |
| Anything | Run `npm run dist` to rebuild the `.app` |

The installed `.app` does not hot-reload — any code change requires a rebuild:

```sh
npm run dist
```

Output goes to `dist/`. Use `Symlinker-x.x.x-arm64.dmg` on Apple Silicon.

**First launch after install:** macOS blocks unsigned apps. Right-click → Open, or strip the quarantine flag:

```sh
xattr -cr /Applications/Symlinker.app
```

## Safety notes

- Cross-device moves are handled with a copy + remove fallback (important when moving from local disk into iCloud-mounted folders).
- The app refuses to act if both the source and destination already exist as real files (`conflict` state).
- The verification step after every move and every reverse re-checks status and throws if the result isn't what was expected.
- Deleting a project in Symlinker only removes the record. Symlinks and files stay untouched. Always reverse first if you want to undo the moves.

## Layout

```
symlinker/
├── package.json
├── main.js            Electron main process + IPC
├── preload.js         contextBridge surface
├── lib/
│   ├── linker.js      link/unlink/checkStatus
│   ├── paths.js       destPathFor + validateFlatBasename helpers
│   └── projects.js    JSON-backed project store
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── test/
    ├── linker.test.js
    └── modes.test.js  path mapping + flat-mode integration tests
```

## Project state file

Stored at `<userData>/projects.json` where `<userData>` is the platform Electron userData path (on macOS: `~/Library/Application Support/symlinker/projects.json`).

```json
{
  "version": 1,
  "projects": [
    {
      "id": "uuid",
      "name": "MyRepo Docs",
      "mode": "mirror",
      "sourceRoot": "/Users/me/Sites/myrepo",
      "destRoot": "/Users/me/Vault/SymDocs/myrepo",
      "createdAt": "2026-04-30T...",
      "items": [
        { "relPath": "docs", "type": "folder", "createdAt": "..." }
      ]
    }
  ]
}
```

`mode` is optional; projects without it are treated as `mirror`. Settings include `defaultDestRoot` (mirror default) and `defaultFlatDestRoot` (flat default, falls back to `~/Sites`).
