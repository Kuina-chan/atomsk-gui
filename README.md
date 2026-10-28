# Atomsk GUI

**Atomsk GUI** is a graphical front end for the [Atomsk](https://atomsk.univ-lille.fr/)
command-line tool. Atomsk is the back end that builds, modifies and converts atomic structures;
this program is the front end that provides a visual interface for it. All interactions of the
front end are sent to the Atomsk back end for processing — the GUI only supplies the visualized
options needed to execute it.

Atomsk GUI is an Electron app written in TypeScript (`src/`, compiled with `tsc` into `dist/`,
no bundler). It runs on Linux, Windows and macOS (Apple silicon / M-series only; there is no Intel
macOS build).

The project is at version **0.1.0** and is developed by **Kuina-chan**.
Homepage: https://github.com/Kuina-chan/atomsk-gui

## What this program is used for

Atomsk GUI lets you work with atomic structures without using the command line directly:

- **Build a new structure** from a crystal lattice. Pick the lattice type from a dropdown, then fill
  in the lattice parameters that appear. Additional options (orientation, supercell, etc.) unlock
  once the required data has been entered.
- **Open an existing structure file** in a supported format for modification (skipping the lattice
  selection step).
- **Save** a structure back to its file, or **Save as…** to a new path or format (this is also how
  you convert between formats).
- The main screen offers `Save` and `Save as…` buttons, equivalent to the File menu entries
  `Save structure` (Ctrl-S) and `Save structure as…` (Ctrl-Shift-S).
- Menu bar entries: **File** (New structure Ctrl-N, Open Ctrl-O, Save structure Ctrl-S, Save
  structure as… Ctrl-Shift-S, Exit), **View** (Theme: System/Light/Dark) and **About**
  (About atomsk, About atomsk-gui).
- **Atomsk control (MCP):** `atomsk-gui --mcp` runs a Model Context Protocol server over stdio with
  no window, so AI agents can drive Atomsk through the same catalog and argument building as the GUI
  (`list_lattices`, `list_options`, `list_formats`, `create_structure`, `transform_file`).

Full documentation for the Atomsk commands used between the back end and the front end is at
https://atomsk.univ-lille.fr/doc/en/index.html.

## How to build from source

### Prerequisites

- Node.js 22+ and npm

### Build and run

From the repository root:

```bash
# Install dependencies
npm ci

# Compile TypeScript (tsc -> dist/)
npm run build

# Run the app
npm start        # runs: tsc && electron .
```

### Platform packaging

Use `electron-builder` (configured in the `build` section of `package.json`). All artifacts are
written to `release/`.

| Platform | Command | Output |
|----------|---------|--------|
| Linux | `npm run dist:linux` | AppImage, .deb, .rpm and Flatpak |
| Windows | `npm run dist:windows` | `atomsk-gui-<version>-x64.zip` (no installer) |
| macOS (Apple silicon) | `npm run dist:mac` | `atomsk-gui-<version>-arm64.zip` + unpacked `.app` |

```bash
# All targets into release/
npm run dist:linux

# A single Linux target only
npx tsc && npx electron-builder --linux deb

# Windows zip
npm run dist:windows

# macOS arm64 zip (works on Linux, Windows and macOS hosts)
npm run dist:mac
```

- **Linux:** packages contain only `atomsk-gui`. Atomsk is not bundled (see disclaimer below).
- **Windows:** unzip anywhere and double-click `atomsk-gui.exe`. There is no `.exe`/`.msi`
  installer at the moment. Building on Linux works too; setting the exe icon and version info there
  needs Wine.
- **macOS:** targets Apple silicon (`arm64`) only; there is no Intel build. The build produces an
  unsigned `.app` bundle packaged as a zip — there is no DMG target, because DMG creation needs
  macOS tooling (`hdiutil`). Code signing and notarization require macOS and Apple credentials.
- Platform-specific notes live in `./linux-build`, `./windows-build` and `./macos-m-build`.

### Tests

```bash
npm test   # runs: tsc && node --test "dist/**/*.test.js"
```

## Disclaimer about Atomsk

Atomsk GUI does **not** bundle Atomsk. Atomsk is a separate program developed and distributed by
the Atomsk project (https://atomsk.univ-lille.fr/). You must install Atomsk yourself:

- On **Linux**, the GUI can download and install the official portable Atomsk binary on first start
  (the download needs `tar`, which is declared as a package dependency). Alternatively, install
  Atomsk from https://atomsk.univ-lille.fr/ and put it on `PATH`, set `ATOMSK_PATH`, or point the GUI
  at it through the first-start setup dialog / File → Atomsk location….
- On **Windows**, the Atomsk website offers no portable binary (only an installer), so the in-app
  download is not available. Install Atomsk separately and point the GUI at the installed
  `atomsk.exe` ("Locate…" in the setup dialog), or place `atomsk.exe` next to `atomsk-gui.exe`.
- On **macOS**, the Atomsk website publishes no portable macOS binary. Build or install Atomsk
  separately from https://atomsk.univ-lille.fr/ and point the GUI at it through
  File → Atomsk location… (also offered in the first-start dialog). The chosen path is remembered
  in `~/.config/atomsk-gui/atomsk-path`.

Atomsk GUI is not affiliated with, endorsed by, or part of the Atomsk project. Use of Atomsk is
subject to Atomsk's own license and terms. All Atomsk commands executed through this GUI follow the
Atomsk documentation at https://atomsk.univ-lille.fr/doc/en/index.html.

## License

Atomsk GUI is distributed under the **GNU General Public License v3.0 or later (GPL-3.0-or-later)**.

Copyright (C) Kuina-chan

Tldr about the license:
This program is free software: you can redistribute it and/or modify it under the terms of the GNU
General Public License as published by the Free Software Foundation, either version 3 of the License,
or (at your option) any later version.

This program is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without
even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU
General Public License for more details.

You should have received a copy of the GNU General Public License along with this program. If not,
see <https://www.gnu.org/licenses/>.
