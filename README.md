# update mac app
npm run dist


# Symlinker

A small Electron app for moving files or folders out of one location and into another, while leaving a symlink behind in the original spot. Built so that docs (or any other files) can live inside an Obsidian vault while still being reachable from a dev repo.

## What it does

Each project pairs a source root (a folder you want to keep tidy, like a dev repo) with a destination root (somewhere you want the actual files to live, like a vault subfolder). For each item you add to a project, the app:

1. Moves the item from the source path to the destination path (creating parent folders as needed).
2. Replaces the original location with a symlink pointing at the destination.

So `~/Sites/myrepo/docs` becomes a symlink to `~/Vault/SymDocs/myrepo/docs`. Reading, editing, and committing through the source path all still work because the symlink is transparent.

Reversing is a single click: the app removes the symlink and moves the item back where it came from.

## Features

- One source root + one destination root per project, with any number of linked items inside.
- Files or folders, mixed within a project.
- Live status per item: `linked`, `unlinked`, `broken-target`, `broken-dangling`, `missing-source`, `conflict`, `missing-both`.
- Dry-run toggle in the sidebar: every action prints its plan instead of touching disk.
- Per-item reverse, plus reverse-all on a project.
- Re-link button repairs a broken symlink without re-moving the file.
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
│   └── projects.js    JSON-backed project store
├── renderer/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── test/
    └── linker.test.js
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
