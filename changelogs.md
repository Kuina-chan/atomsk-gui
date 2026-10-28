# Changelog

All notable changes to Atomsk GUI are listed here. The project is at version 0.1.0.

## Unreleased — 2026-10-26

### Added

- **macOS (Apple silicon) build.** `npm run dist:mac` compiles the TypeScript and runs
  `electron-builder --mac zip --arm64`. It produces
  `release/atomsk-gui-<version>-arm64.zip` and the unpacked
  `release/mac-arm64/atomsk-gui.app` on Linux, Windows or macOS. The build targets `arm64` only:
  there is no Intel Mac build.
- **`build.mac` configuration** in `package.json`: an arm64 zip target,
  `public.app-category.education`, dark-mode support, and the root `icon.png` converted to
  `icon.icns`.
- **Native macOS application menu.** On macOS the menu bar now starts with the app menu, which
  contains About atomsk-gui, About atomsk, Hide/Hide Others/Show All and Quit (Cmd+Q). The existing
  File, View and About menus remain unchanged.
- **`macos-m-build/README.md`** with the build command, prerequisites, artifact names, atomsk
  setup, building on Linux, and signing/notarization notes.

### Changed

- **The macOS build is zip-only and runs on any host.** `npm run dist:mac` no longer depends on
  `hdiutil`: it builds the arm64 `.app` and packages it with `electron-builder --mac zip --arm64` on
  Linux, Windows and macOS. This covers the request to build a Mac version on Linux. The `.zip`
  preserves the bundle's symlinks and executable bits, so it can be transferred to Apple silicon and
  unzipped there.
- **Removed the DMG target and `build.dmg` configuration.** DMG creation is the only macOS packaging
  step that requires macOS tooling, and the project no longer needs it. `npm run dist:mac` is now a
  single command that works on every host, so no host-detection helper is needed.
- **Dropdowns now use a custom scrollable suggestion list** instead of the browser's native
  `<datalist>` popup. The list has a maximum height (`min(320px, 45vh)`) and `overflow-y: auto`, so
  long catalogs — the options dropdown has 79 entries — can be browsed with the mouse wheel,
  trackpad or scrollbar. `overscroll-behavior: contain` stops the page from scrolling when the list
  reaches its end.
- **The searchable dropdown keeps its search and selection behaviour** while adding keyboard
  navigation: type to filter (case-insensitive substring), Arrow Down/Arrow Up to move the
  highlight, Enter to select, Escape to close and restore the previous choice, and Tab to close and
  move on. The highlighted row is scrolled into view automatically.
- **Dropdown styling** now follows the app theme (including light/dark) with a bordered popup,
  shadow, hover state and a separate accent-colored keyboard highlight. The list exposes
  `combobox`/`listbox`/`option` roles and `aria-expanded`, `aria-controls` and
  `aria-activedescendant` for assistive technology.
- **`AGENTS.md`** documents the macOS build (`npm run dist:mac`) and the requirement that dropdown
  suggestion lists scroll.
- **`macos-m-build/README.md`** pins the minimum system version to macOS 13 (Ventura), matching the
  bundled Electron 45 runtime, and lists the zip artifact plus the unpacked app bundle.

### Fixed

- **Dropdown menus could not be scrolled** when they contained more entries than fit in the popup.
  This affected both the crystal-lattice dropdown and the option/argument dropdowns. Replacing the
  native datalist with a real scrollable list fixes it and also makes hover, keyboard highlight and
  theme colors predictable across platforms.

### Verification

- `npm test` passes (10 tests passed, 1 network test skipped as usual).
- `npm run dist:mac` was run successfully on Linux and produced the arm64 `atomsk-gui.app` with the
  expected `Info.plist` (`LSMinimumSystemVersion 13.0`, category
  `public.app-category.education`, `icon.icns`) plus `atomsk-gui-0.1.0-arm64.zip`. No DMG is
  produced. The zip keeps the framework symlinks and the arm64 executable bits.
- No signing certificate was available, so signing was skipped, as expected on Linux. A signed build
  requires macOS and Apple's signing credentials.
