# Windows build

Produces `atomsk-gui-<version>-x64.zip`: unzip anywhere and double-click `atomsk-gui.exe`. No installer.

Atomsk is not bundled: install it from https://atomsk.univ-lille.fr/ (or put it on `PATH` / set `ATOMSK_PATH`), or put `atomsk.exe` next to `atomsk-gui.exe`. The website offers no portable Windows binary, so the in-app download is not available on Windows; "Locate…" in the setup dialog points the GUI to an installed `atomsk.exe`.

## Build

1. Install Node.js 22+ (https://nodejs.org/).
2. In the repository root:
   ```
   npm ci
   npm run dist:windows
   ```
   The zip appears in `release/`. Building on Linux works too; setting the exe icon and version info there needs Wine.
