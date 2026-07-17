// app.js - Application Entry Point
// Initializes all modules and wires them together.
// This is the last script loaded in index.html.

// Wait for the DOM to be fully loaded before initializing
document.addEventListener("DOMContentLoaded", () => {
  const zoomLevel = document.getElementById("zoom-level");

  const updateZoomLabel = (zoom) => {
    zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
  };

  const changeZoom = async (direction) => {
    updateZoomLabel(await window.api.changeZoom(direction));
  };

  document
    .getElementById("zoom-out")
    .addEventListener("click", () => changeZoom("out"));
  document
    .getElementById("zoom-in")
    .addEventListener("click", () => changeZoom("in"));

  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;

    const isTextareaTarget =
      event.target instanceof HTMLTextAreaElement &&
      document.activeElement === event.target;
    const key = event.key.toLowerCase();

    // Textareas retain the browser's native undo and redo behavior.
    if (isTextareaTarget && (key === "z" || key === "y")) return;

    if (key === "z" && !event.shiftKey) {
      event.preventDefault();
      fileManager.undo();
    } else if (key === "y" || (key === "z" && event.shiftKey)) {
      event.preventDefault();
      fileManager.redo();
    } else if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      changeZoom("in");
    } else if (event.key === "-" || event.key === "_") {
      event.preventDefault();
      changeZoom("out");
    } else if (event.key === "0") {
      event.preventDefault();
      window.api.setZoom(1).then(updateZoomLabel);
    }
  });

  window.api.getZoom().then(updateZoomLabel);

  // Get the container where blocks will be rendered
  const blocksContainer = document.getElementById("blocks-container");

  // Initialize the BlockManager: handles all block lifecycle
  const blockManager = new BlockManager(blocksContainer);

  // Initialize the FileManager: handles file I/O and autosave
  const fileManager = new FileManager(blockManager);
  window.api.onCloseRequested(() =>
    fileManager.handleCloseRequest().catch((error) => {
      console.error("Close request failed:", error);
      return window.api.respondToClose("cancel");
    }),
  );

  // Start with a new file (which creates a default "New document" block)
  fileManager.newFile();

});
