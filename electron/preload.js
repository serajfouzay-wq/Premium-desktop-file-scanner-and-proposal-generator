'use strict';
const { contextBridge, ipcRenderer } = require('electron');

/*
 * The only bridge between the UI and the machine. Node integration is off in
 * the renderer, the context is isolated, and this surface is an explicit list —
 * the UI cannot reach the file system except through a channel named here.
 */

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

const on = (channel, handler) => {
  const wrapped = (_event, data) => handler(data);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
};

contextBridge.exposeInMainWorld('cabinet', {
  app: {
    info: () => invoke('app:info'),
    openPath: (p) => invoke('app:openPath', p),
    revealPath: (p) => invoke('app:revealPath', p),
  },
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    chooseLibraryRoot: () => invoke('settings:chooseLibraryRoot'),
    pickImage: () => invoke('settings:pickImage'),
  },
  scan: {
    chooseFolder: () => invoke('scan:chooseFolder'),
    chooseFiles: () => invoke('scan:chooseFiles'),
    start: (roots) => invoke('scan:start', roots),
    cancel: () => invoke('scan:cancel'),
    fileOne: (payload) => invoke('scan:fileOne', payload),
    fileAll: (payload) => invoke('scan:fileAll', payload),
    onProgress: (handler) => on('scan:progress', handler),
  },
  library: {
    companies: () => invoke('library:companies'),
    documents: (company) => invoke('library:documents', company),
    document: (id) => invoke('library:document', id),
    tree: () => invoke('library:tree'),
    stats: () => invoke('library:stats'),
    setConfidentiality: (id, level) => invoke('library:setConfidentiality', { id, level }),
    remove: (id) => invoke('library:remove', id),
  },
  studio: {
    generate: (prompt) => invoke('studio:generate', prompt),
    preview: (payload) => invoke('studio:preview', payload),
    exportAs: (payload) => invoke('studio:exportAs', payload),
    saveToLibrary: (payload) => invoke('studio:saveToLibrary', payload),
    onStage: (handler) => on('studio:stage', handler),
  },
});
