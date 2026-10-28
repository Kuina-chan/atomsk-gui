# macOS build (Apple silicon)

The macOS version is an **arm64** build for M-series Macs. Intel Macs are not supported: there is no
hardware to test them on.

## Build

```
npm ci
npm run dist:mac
```

The command runs `tsc`, then `electron-builder --mac zip --arm64`. It works on **Linux, Windows and
macOS** and writes:

- `release/atomsk-gui-<version>-arm64.zip` — the distributable macOS archive
- `release/mac-arm64/atomsk-gui.app` — the unpacked app bundle

Unzip the archive on the Mac and move `atomsk-gui.app` to `/Applications` (or anywhere else).

There is deliberately **no DMG target**. DMG creation is the only macOS packaging step that needs
macOS tooling (`hdiutil`). ZIP is supported everywhere and is the usual macOS archive format:
it preserves the `.app` bundle's symlinks and executable bits. electron-builder can also build macOS
`tar.gz`, `tar.bz2`, `tar.xz` and `7z` archives on Linux, but ZIP is what this project configures.

## Prerequisites

- Node.js 22+ and npm on the build machine.
- To run the result: an Apple silicon Mac with macOS 13 (Ventura) or newer, the minimum required by
  the bundled Electron.
- No Xcode Command Line Tools are needed to build the unsigned zip. They are needed only on macOS for
  code signing and notarization.

## Building on Linux

Linux produces the complete arm64 `.app` bundle and zip; nothing beyond Node.js and npm is required:

```
npm ci
npm run dist:mac
```

Keep the zip when moving the build to a Mac: it preserves the bundle's symlinks and executable bits,
which plain copies through some filesystems do not.

The Linux build is **unsigned**: code signing and notarization need Apple's `codesign` tooling and a
Developer ID certificate, which are only available on macOS. If Gatekeeper complains after the zip is
transferred, right-click the app → **Open**, or remove the quarantine flag on the Mac:

```
xattr -dr com.apple.quarantine "/Applications/atomsk-gui.app"
```

If macOS still refuses to launch the unsigned bundle, ad-hoc sign it once on the Mac:

```
codesign --force --deep --sign - "/Applications/atomsk-gui.app"
```

For a signed and notarized release, build on macOS with the credentials below.

## Atomsk

Atomsk is not bundled. The atomsk website does not publish a portable macOS binary, so the in-app
download is not available here. Build or install atomsk separately from https://atomsk.univ-lille.fr/
and point the GUI at it with **File → Atomsk location…** (also offered in the first-start dialog). The
chosen path is remembered in `~/.config/atomsk-gui/atomsk-path`.

## Signing and notarization (macOS)

The default build is unsigned. Gatekeeper then blocks a downloaded copy on first launch; open it with
right-click → **Open** (or **System Settings → Privacy & Security → Open Anyway**). A build made and
run locally is not quarantined.

For a signed build, set the standard electron-builder variables before `npm run dist:mac` on macOS:

- `CSC_LINK` (path or URL to a Developer ID Application `.p12`) and `CSC_KEY_PASSWORD`.
- For notarization, either `APPLE_API_KEY`, `APPLE_API_KEY_ID` and `APPLE_API_ISSUER`, or
  `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`.

electron-builder picks up the identity from the login keychain; no certificate means the signing step
is skipped and the build still succeeds.

## Notes

- `icon.png` in the repository root is converted to the `.icns` used by the app.
- The app menu (`About`, `Hide`, `Quit`) is added only on macOS; the File/View/About menus are the same
  as on the other platforms.
- The `arm64`-only zip target is configured in the root `package.json`, in `build.mac`.
- `npm run dist:mac` is the same command on every host, so a Linux machine can produce the Mac
  artifact directly.
