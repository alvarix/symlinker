
# Standalone app
electron-builder` is the standard tool for this. It produces a `.app` on macOS that you can double-click or drag to `/Applications`.

Here's the plan:

1. Install `electron-builder` as a dev dependency
2. Add a `build` config to `package.json` (app id, icon, targets)
3. Add a `dist` npm script
4. Run `npm run dist` — outputs a `.dmg` + `.app` to `dist/`

One thing to know: macOS will block unsigned apps by default (Gatekeeper). You'd right-click → Open the first time, or we can add a `--no-sandbox` workaround flag. For full distribution you'd need an Apple Developer account to sign/notarize — but for personal use, right-click → Open works fine.

Icon file needs to be a `.icns` for macOS.
