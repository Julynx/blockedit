// preload.js - Preload Script
// This script runs in a privileged context before the web page loads.
// It uses contextBridge to safely expose specific APIs to the renderer
// without giving it direct access to Node.js or Electron internals.

const { contextBridge, ipcRenderer } = require("electron");

// Expose a controlled API to the renderer process (the web page)
// This object will be available as `window.api` in renderer scripts.
contextBridge.exposeInMainWorld("api", {
  // File operations
  openFile: () => ipcRenderer.invoke("file:open"),
  chooseImageFile: () => ipcRenderer.invoke("file:choose-image"),
  saveFile: (data) => ipcRenderer.invoke("file:save", data),
  openExternalLink: (url) => ipcRenderer.invoke("link:open-external", url),

  // Markdown formatting
  formatMarkdown: (markdown) => {
    return ipcRenderer.invoke("markdown:format", markdown);
  },

  // Dialogs
  showUnsavedChangesDialog: () => ipcRenderer.invoke("dialog:unsaved-changes"),

  // Page zoom
  getZoom: () => ipcRenderer.invoke("zoom:get"),
  setZoom: (zoom) => ipcRenderer.invoke("zoom:set", zoom),
  changeZoom: (direction) => ipcRenderer.invoke("zoom:change", direction),

  // Utility: get current file path (if we expand main to track it later)
  getCurrentFilePath: () => ipcRenderer.invoke("file:get-current-path"),
});
