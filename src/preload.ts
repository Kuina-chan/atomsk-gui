// Bridge between the sandboxed renderer and the main process: the renderer sees only `window.atomsk`.

import { contextBridge, ipcRenderer } from 'electron';

const api: AtomskApi = {
  catalog: () => ipcRenderer.invoke('catalog'),
  initialFiles: () => ipcRenderer.invoke('initial-files'),
  save: (request) => ipcRenderer.invoke('save', request),
  showError: (message, detail) => ipcRenderer.invoke('show-error', message, detail),
  confirm: (message, detail, acceptLabel) => ipcRenderer.invoke('confirm', message, detail, acceptLabel),
  setDirty: (dirty) => ipcRenderer.send('set-dirty', dirty),
  onMenu: (listener) => { ipcRenderer.on('menu', (_event, menuCommand) => listener(menuCommand)); },
  onOpenFile: (listener) => { ipcRenderer.on('open-file', (_event, file) => listener(file)); },
  onBusy: (listener) => { ipcRenderer.on('busy', (_event, message) => listener(message)); },
};

contextBridge.exposeInMainWorld('atomsk', api);
