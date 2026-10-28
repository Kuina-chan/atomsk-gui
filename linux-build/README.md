# Linux build

Electron build, packaged with electron-builder (config in the root `package.json`, `build` section). Packages contain only `atomsk-gui`. Atomsk is not bundled: install it from https://atomsk.univ-lille.fr/ (or put it on `PATH` / set `ATOMSK_PATH`), or let the GUI download it on first start. The download needs `tar` (declared as a package dependency).

```
npm ci
npm run dist:linux                         # all targets into release/
npx tsc && npx electron-builder --linux deb   # a single target: deb, rpm, AppImage, flatpak
```

## Prerequisites

- All: Node.js 22+ and npm.
- rpm: `rpmbuild` (`rpm` package on Debian/Ubuntu).
- Flatpak: `flatpak-builder`, plus the `org.freedesktop.Platform`/`Sdk` and `org.electronjs.Electron2.BaseApp` runtimes from Flathub (electron-builder picks the versions).

## Notes

- `deb.depends` / `rpm.depends` replace electron-builder's defaults instead of extending them, so they repeat Electron's runtime libraries plus `tar`. Re-check them against `getDefaultDepends` in `app-builder-lib/out/targets/FpmTarget.js` when upgrading electron-builder.
- `io.github.kuina_chan.AtomskGui.metainfo.xml` (AppStream) is installed by the deb, rpm and Flatpak targets; its id matches `desktopName`.
- `icon.png` in the root is rendered from `icon.svg`; regenerate it when the SVG changes.
- The Flatpak sandbox cannot see a host-installed atomsk, so the in-app download (stored in the sandbox's data dir) is the supported path there. electron-builder's default Flatpak permissions include network access and the home directory.
- The repository on a Windows drive under WSL (`/mnt/…`) cannot run Electron (`Couldn't mmap icu data file`): run it from the Linux filesystem or from Windows.
