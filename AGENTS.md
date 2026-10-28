# Atomsk-gui

## Structure of the program.
Atomsk is a CLI-based program, the backend of the whole atomsk-gui. Atomsk-gui is the front end of it. All interaction of the front end must be send to the Atomsk backend for processing, the gui only provide necessary and visualized option to execute the back end
Atomsk-gui is an Electron app written in TypeScript (`src/`, compiled with `tsc` into `dist/`, no bundler). The main process (`main.ts`) owns the window, menu, native dialogs and every atomsk call; the sandboxed renderer (`renderer.ts`, `index.html`) builds the form and reaches the main process only through the `window.atomsk` bridge from `preload.ts`. `command.ts`, `install.ts` and `mcp.ts` are plain Node with no Electron dependency. `npm start` runs it, `npm test` runs the tests.
Atomsk-gui has three version available. A Linux based version, a Windows based version, and a MacOS **M-series** version; Intel MacOS version will not be available due to lack of hardware to test. The MacOS build is only compatible with M-series silicon for now. All files that are used by all platform will stay at the root directory. Packaging for both is configured in the `build` section of `package.json` (electron-builder); platform-specific notes stay in `./linux-build`, `./windows-build`, `./macos-m-build` respectively

## About the function and UI/UX choices
The program always open to main screen to have the user input fields. The first field are always available: a drop down for the user to choose which type of crystal lattice. After the user has chosen the lattice, show necessary lattice parameter that needed to be filled in, and only once those has been filled in, open up the other options below it. All the options will be in the same way: a drop down to choose, follow by the option to fill in necessary data.

If the user decide to load a pre-made file for the program to use, skip the lattice crystal selection and open all the options

The main screen has `Save` and `Save as…` buttons at the bottom, equivalent to the File menu entries `Save structure` and `Save structure as…`.

The menu bar now only contain the `File`, `View` and `About` Button:

### File button
Contain the standard commands:
- New structure(shortcut: Ctrl-N): create a new tab for the user to interact. Never close the old one without a confirmation prompt
- Open(shortcut: Ctrl-O): open supported file format for modification. Supported files is available in the documentation.
- Save structure(shortcut: Ctrl-S): by default, when a file is being open, save back to the directory that the user pointed to. If there's not a file opened, open the dialog for saving.
- Save structure as...(shortcut: Ctrl-Shift-S): always open the dialog for saving. When a file is being open, the input stays unchanged and the chosen output extension picks the format, so this is also how the user converts between formats. After saving, the tab points to the new file.
- Exit: exit the program

### View button
- Theme: radio choice between `System` (default, follows the OS light/dark preference), `Light` and `Dark`. The choice is saved and restored on the next start.

### About button
- `About atomsk`: open `https://atomsk.univ-lille.fr/` with the user's default browser
- `About atomsk-gui`: open `https://github.com/Kuina-chan/atomsk-gui`

## About the dropdown selection
The dropdown need to contain all of the options and argument that available and the box itself need to act as a search box, which in turn narrow down the options available to select. The suggestion list must scroll (mouse wheel, trackpad and keyboard) when it is taller than its popup.

## About the Linux build
Linux build uses Electron for the user interface. Linux build will provide via either flatpak, AppImage, .rpm package and .deb package (`npm run dist:linux`)

## About the Windows build
Windows build will contain everything it need in a zip folder (`npm run dist:windows`). The installer method where provide a single .exe or .msi for the user to run and self install everything is not viable at the moment.

## About the MacOS build
The macOS build targets Apple silicon only (arm64; there is no Intel build). `npm run dist:mac` builds the arm64 `.app` bundle and packages it as a zip on Linux, Windows or macOS. There is no DMG target, because DMG creation needs macOS tooling. The app is unsigned unless signing credentials are provided. Build notes are in `./macos-m-build`.

## Documentation
All of the atomsk documentation is available at the entry point `https://atomsk.univ-lille.fr/doc/en/index.html`. Strictly follow this documentation for the command needed between the backend and the frontend

## Agent control (MCP)
`atomsk-gui --mcp` runs a Model Context Protocol server over stdio (newline-delimited JSON-RPC) with no window: it reruns itself as plain Node (`ELECTRON_RUN_AS_NODE`), so it also works without a display, and AI agents can drive atomsk through the same catalog and argument building as the GUI. Tools: `list_lattices`, `list_options` (optional `query` filter), `list_formats`, `create_structure` (lattice, params, optional orient/options, output) and `transform_file` (input, optional options, output; converting a format is a transform with no options and a different output extension). Calls are validated against the catalog, and an existing output file is never overwritten unless `overwrite` is true. Register it with `claude mcp add atomsk -- atomsk-gui --mcp`.
