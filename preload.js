// preload.js - Preload Script
// This script runs in a privileged context before the web page loads.
// It uses contextBridge to safely expose specific APIs to the renderer
// without giving it direct access to Node.js or Electron internals.

const { contextBridge, ipcRenderer } = require("electron");

// Expose a controlled API to the renderer process (the web page)
// This object will be available as `window.api` in renderer scripts.
contextBridge.exposeInMainWorld("api", {
  // File operations
  getInitialFilePath: () => ipcRenderer.invoke("app:initial-file-path"),
  openFile: () => ipcRenderer.invoke("file:open"),
  openFilePath: (filePath) => ipcRenderer.invoke("file:open-path", filePath),
  chooseImageFile: () => ipcRenderer.invoke("file:choose-image"),
  saveFile: (data) => ipcRenderer.invoke("file:save", data),
  clearCurrentFilePath: () => ipcRenderer.invoke("file:clear-current-path"),
  openExternalLink: (url) => ipcRenderer.invoke("link:open-external", url),

  // Markdown formatting
  formatMarkdown: (markdown) => {
    return ipcRenderer.invoke("markdown:format", markdown);
  },

  // Dialogs
  showUnsavedChangesDialog: () => ipcRenderer.invoke("dialog:unsaved-changes"),
  onCloseRequested: (callback) => {
    const listener = () => callback();
    ipcRenderer.on("app:close-requested", listener);
    return () => ipcRenderer.removeListener("app:close-requested", listener);
  },
  respondToClose: (decision) =>
    ipcRenderer.invoke("app:close-response", decision),

  // Page zoom
  getZoom: () => ipcRenderer.invoke("zoom:get"),
  setZoom: (zoom) => ipcRenderer.invoke("zoom:set", zoom),
  changeZoom: (direction) => ipcRenderer.invoke("zoom:change", direction),
});
