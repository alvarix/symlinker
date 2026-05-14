# Changelog

## Unreleased

### Added

- **Two project modes.** Each project now has a `mode` field (`mirror` or `flat`).
  - `mirror` (default) — existing behavior. Dest path preserves the full `relPath` hierarchy. Use this to push project docs into an Obsidian vault.
  - `flat` — new. Dest path collapses to `destRoot/<basename>`. Use this to pull individual vault notes into a project repo so an LLM can read them.
- **Mode picker in new-project dialog.** A radio toggle lets you choose the direction when creating a project. Switching modes swaps the destination field to the matching default.
- **`defaultFlatDestRoot` setting.** A second default-destination row in the sidebar footer, labeled by mode. Flat mode falls back to `~/Sites` when not set.
- **Flat-mode detail view.**
  - Source browser and "Link folder" card are hidden (vault directory listing doesn't apply).
  - An "Add file…" button opens a file picker constrained to the source root.
  - Items table shows just the basename (`note.md`) rather than the full vault-relative path.
- **Basename collision guard.** In flat mode, two files with the same basename but different vault paths would map to the same dest path. Adding the second is refused:
  - UI pre-check shows an inline error naming the existing item.
  - Core (`items:add`) validates independently and throws, guarding against direct IPC calls.
- **`lib/paths.js` helper module.** Extracts `destPathFor` and `validateFlatBasename` out of `main.js` so they can be imported by tests without Electron.
- **`test/modes.test.js`.** 16 new tests covering path mapping (mirror, flat, legacy), store round-trip, flat-mode link/unlink integration, and collision handling.

### Changed

- All dest-path computations in `main.js` IPC handlers go through `destPathFor(project, relPath)` instead of inline `path.join(destRoot, relPath)`.
- `projects:create` accepts and stores the `mode` field.
- `settings:get` returns `defaultFlatDestRoot` falling back to `os.homedir()/Sites` when not user-configured.
- Existing projects without a `mode` field continue to behave as `mirror` — no migration needed.
