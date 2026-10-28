// Electron main process: window, menu bar, native dialogs and every call to atomsk.

import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, nativeTheme, shell } from 'electron';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog } from './catalog';
import * as command from './command';
import { errorMessage } from './command';
import * as install from './install';

const ATOMSK_URL = 'https://atomsk.univ-lille.fr/';
const ATOMSK_GUI_URL = 'https://github.com/Kuina-chan/atomsk-gui';

let window: BrowserWindow;
let anyDirty = false;
/** Files waiting for the renderer; undefined once it is ready for them. */
let pendingFiles: string[] | undefined = [];
let installing: Promise<string> | undefined;

// ---------------------------------------------------------------- dialogs

/** Error dialog showing `shownDetail`; its "Copy details" button puts `clipboardText` on the clipboard instead. */
async function showError(message: string, shownDetail: string, clipboardText = `${message}\n\n${shownDetail}`): Promise<void> {
  const { response } = await dialog.showMessageBox(window, {
    type: 'error', message, detail: shownDetail, buttons: ['Copy details', 'Close'], defaultId: 1, cancelId: 1,
  });
  if (response === 0) clipboard.writeText(clipboardText);
}

async function confirm(message: string, detail: string, acceptLabel: string): Promise<boolean> {
  const { response } = await dialog.showMessageBox(window, {
    type: 'question', message, detail, buttons: ['Cancel', acceptLabel], defaultId: 0, cancelId: 0,
  });
  return response === 1;
}

/** Returns the index of the clicked button; the last one cancels. */
async function choose(message: string, detail: string, buttons: string[]): Promise<number> {
  const { response } = await dialog.showMessageBox(window, { message, detail, buttons, defaultId: 0, cancelId: buttons.length - 1 });
  return response;
}

/** Formats a dialog may show; `onlyExtension` narrows it to a mode's forced output format (ddplot). */
function fileFilters(forReading: boolean, onlyExtension?: string): Electron.FileFilter[] {
  const formats = onlyExtension
    ? catalog.formats.filter((format) => format.extensions.some((extension) => extension.toLowerCase() === onlyExtension.toLowerCase()))
    : catalog.formats.filter((format) => (forReading ? format.read : format.write));
  // Uppercase entries are bare filenames (POSCAR, CONFIG, OUTCAR), which Electron filters cannot match: use "All files".
  const extensionsOf = (format: Format) => format.extensions.filter((extension) => !/^[A-Z]+$/.test(extension));
  return [
    { name: 'All supported formats', extensions: formats.flatMap(extensionsOf) },
    ...formats.map((format) => ({ name: format.label, extensions: extensionsOf(format) })).filter((filter) => filter.extensions.length > 0),
    { name: 'All files', extensions: ['*'] },
  ];
}

function lastLines(text: string): string {
  return text.trimEnd().split('\n').slice(-15).join('\n');
}

// ----------------------------------------------------------- atomsk setup
// Each step resolves to true once atomsk is available, false when the user gave up.

const MISSING_DETAIL = 'Atomsk does the actual work. Download it, or point to an existing installation.';

/** Lets the user download, locate or give up on atomsk. */
async function offerAtomsk(message: string, detail: string): Promise<boolean> {
  switch (await choose(message, detail, ['Download and install', 'Locate…', 'Cancel'])) {
    case 0: return downloadAtomsk();
    case 1: return pickAtomskFile();
    default: return false;
  }
}

/** Fallback after a failed or impossible download: browser, locate or give up. */
async function offerManual(message: string, detail: string): Promise<boolean> {
  switch (await choose(message, detail, ['Open download page', 'Locate…', 'Cancel'])) {
    case 0: void shell.openExternal(install.DOWNLOAD_PAGE); return false;
    case 1: return pickAtomskFile();
    default: return false;
  }
}

/** Remembers `file` as the atomsk to use. */
async function useAtomsk(file: string): Promise<boolean> {
  try {
    command.saveAtomskPath(file);
    return true;
  } catch (error) {
    await showError('Cannot save the atomsk location', errorMessage(error));
    return false;
  }
}

async function pickAtomskFile(): Promise<boolean> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, { title: 'Locate atomsk', properties: ['openFile'] });
  if (canceled || filePaths.length === 0) return false;
  try {
    await command.verifyAtomsk(filePaths[0]);
  } catch (error) {
    return offerAtomsk('That is not a working atomsk', errorMessage(error));
  }
  return useAtomsk(filePaths[0]);
}

/** Finds the official archive, asks for confirmation, then installs it. */
async function downloadAtomsk(): Promise<boolean> {
  let url: string;
  try {
    url = await install.resolveArchiveUrl();
  } catch (error) {
    return offerManual('Cannot download atomsk automatically', errorMessage(error));
  }
  const installDirectory = command.managedDirectory();
  if (!await confirm('Download atomsk?', `Download:\n${url}\n\nInstall into:\n${installDirectory}`, 'Download')) return false;
  window.webContents.send('busy', 'Downloading and installing atomsk…');
  let installed: string;
  try {
    // A second request (startup offer, File menu, Save) joins the running install: they share the work directory.
    installing ??= install
      .downloadAndInstall(url, path.join(path.dirname(installDirectory), 'download'), installDirectory)
      .finally(() => { installing = undefined; });
    installed = await installing;
  } catch (error) {
    return offerManual('Download failed', errorMessage(error));
  } finally {
    window.webContents.send('busy', null);
  }
  return useAtomsk(installed);
}

async function showAtomskLocation(): Promise<void> {
  const current = command.locateAtomsk();
  await offerAtomsk('Atomsk location', current ? `Currently used: ${current}` : 'atomsk was not found.');
}

// ------------------------------------------------------------------ save

/** Asks for a destination when there is no known one, runs atomsk and reports failures in a dialog. */
async function save({ source, options, knownPath }: SaveRequest): Promise<SaveResult | undefined> {
  const output = command.outputKind(source);
  let destination = knownPath;
  if (!destination && output === 'folder') {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Choose the output folder', properties: ['openDirectory', 'createDirectory'],
    });
    if (canceled || filePaths.length === 0) return undefined;
    destination = filePaths[0];
  } else if (!destination && output !== 'none') {
    const mode = source.kind === 'mode' ? command.modeById(source.mode) : undefined;
    const { canceled, filePath } = await dialog.showSaveDialog(window, {
      title: output === 'prefix' || output === 'numbered' ? 'Choose the output name; snapshots get a number' : 'Save structure as',
      filters: fileFilters(false, mode?.outputExtension),
    });
    if (canceled || !filePath) return undefined;
    destination = filePath;
  }
  destination ??= process.cwd();
  let program = command.locateAtomsk();
  if (!program && await offerAtomsk('atomsk was not found.', MISSING_DETAIL)) program = command.locateAtomsk();
  if (!program) return undefined;

  const { success, log } = await command.writeStructure(program, source, options, destination);
  if (success) return { log, savedTo: output === 'none' ? undefined : destination, output };
  // Not awaited: the renderer shows the log while the dialog is open.
  void showError('Atomsk failed', lastLines(log), log);
  return { log, output };
}

// ---------------------------------------------------------------- window

/** Existing files among command-line arguments: paths, or `file://` URIs from the desktop file's `%U`. */
function filesFromArguments(args: string[], workingDirectory: string): string[] {
  return args
    .filter((argument) => !argument.startsWith('-'))
    .map((argument) => {
      if (!argument.startsWith('file:')) return path.resolve(workingDirectory, argument);
      try {
        return fileURLToPath(argument);
      } catch {
        return '';
      }
    })
    .filter(command.isFile);
}

/** Opens a tab for `file`; held back until the renderer has asked for its first files. */
function deliverFile(file: string): void {
  if (pendingFiles) pendingFiles.push(file);
  else window.webContents.send('open-file', file);
}

async function openFile(): Promise<void> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Open structure', properties: ['openFile'], filters: fileFilters(true),
  });
  if (!canceled && filePaths.length > 0) deliverFile(filePaths[0]);
}

function setTheme(theme: command.Theme): void {
  nativeTheme.themeSource = theme;
  try {
    command.saveTheme(theme);
  } catch (error) {
    console.error(`Cannot save the theme choice: ${errorMessage(error)}`);
  }
}

function buildMenu(): Menu {
  const send = (menuCommand: MenuCommand) => () => window.webContents.send('menu', menuCommand);
  const themes: [command.Theme, string][] = [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']];
  const template: Electron.MenuItemConstructorOptions[] = [
    { label: 'File', submenu: [
      { label: 'New structure', accelerator: 'CmdOrCtrl+N', click: send('new') },
      { label: 'Open', accelerator: 'CmdOrCtrl+O', click: () => void openFile() },
      { label: 'Save structure', accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: 'Save structure as…', accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
      { label: 'Atomsk location…', click: () => void showAtomskLocation() },
      { type: 'separator' },
      { label: 'Exit', click: () => window.close() },
    ] },
    { label: 'View', submenu: [
      { label: 'Theme', submenu: themes.map(([theme, label]) => ({
        label, type: 'radio' as const, checked: nativeTheme.themeSource === theme, click: () => setTheme(theme),
      })) },
    ] },
    { label: 'About', submenu: [
      { label: 'About atomsk', click: () => void shell.openExternal(ATOMSK_URL) },
      { label: 'About atomsk-gui', click: () => void shell.openExternal(ATOMSK_GUI_URL) },
    ] },
  ];
  // macOS expects the application menu first: it owns About, Hide and the Cmd+Q Quit shortcut.
  if (process.platform === 'darwin') {
    template.unshift({
      label: app.name,
      submenu: [
        { label: 'About atomsk-gui', click: () => void shell.openExternal(ATOMSK_GUI_URL) },
        { label: 'About atomsk', click: () => void shell.openExternal(ATOMSK_URL) },
        { type: 'separator' },
        { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    });
  }
  return Menu.buildFromTemplate(template);
}

function createWindow(): void {
  window = new BrowserWindow({
    width: 900,
    height: 700,
    title: 'Atomsk GUI',
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  Menu.setApplicationMenu(buildMenu());
  window.once('ready-to-show', () => {
    window.show();
    if (!command.locateAtomsk()) void offerAtomsk('atomsk was not found.', MISSING_DETAIL);
  });
  // Closing the window (Exit included) asks first when any structure has unsaved changes.
  window.on('close', (event) => {
    if (!anyDirty) return;
    event.preventDefault();
    void confirm('Quit Atomsk GUI?', 'Some structures have unsaved changes.', 'Quit').then((quit) => quit && window.destroy());
  });
  // Links never navigate the app window.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void window.loadFile(path.join(__dirname, '..', 'src', 'index.html'));
}

function startGui(): void {
  // One window: a second launch hands its files to the running one, like a GTK single-instance app.
  if (!app.requestSingleInstanceLock()) {
    app.quit();
    return;
  }
  app.on('second-instance', (_event, argv, workingDirectory) => {
    filesFromArguments(argv.slice(1), workingDirectory).forEach(deliverFile);
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  pendingFiles = filesFromArguments(process.argv.slice(1), process.cwd());
  nativeTheme.themeSource = command.loadTheme();

  ipcMain.handle('catalog', () => catalog);
  // The renderer asks once its listeners are in place; from then on files are sent directly.
  ipcMain.handle('initial-files', () => {
    const files = pendingFiles ?? [];
    pendingFiles = undefined;
    return files;
  });
  ipcMain.handle('save', (_event, request: SaveRequest) => save(request));
  ipcMain.handle('pick-files', async (_event, multiple: boolean) => {
    const { canceled, filePaths } = await dialog.showOpenDialog(window, {
      title: 'Choose a structure file',
      properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: fileFilters(true),
    });
    return canceled ? [] : filePaths;
  });
  ipcMain.handle('show-error', (_event, message: string, detail: string) => showError(message, detail));
  ipcMain.handle('confirm', (_event, message: string, detail: string, acceptLabel: string) => confirm(message, detail, acceptLabel));
  ipcMain.on('set-dirty', (_event, dirty: boolean) => { anyDirty = dirty; });

  app.on('window-all-closed', () => app.quit());
  void app.whenReady().then(createWindow);
}

// MCP server mode: no window is ever created. Chromium wants a display even without windows, so the
// server runs as plain Node; blocking here, before the event loop starts, keeps Electron from
// initializing its display platform.
if (process.argv.includes('--mcp')) {
  const { status } = spawnSync(process.execPath, [path.join(__dirname, 'mcp.js')], {
    stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  });
  process.exit(status ?? 1);
} else {
  startGui();
}
