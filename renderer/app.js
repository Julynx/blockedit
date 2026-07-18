// app.js - Application Entry Point
// Initializes all modules and wires them together.
// This is the last script loaded in index.html.

// Wait for the DOM to be fully loaded before initializing
document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("theme-toggle");
  const iconLoader = new Toolbar();
  iconLoader.loadSvgIcon(
    "icons/search.svg",
    document.getElementById("search-btn"),
  );
  iconLoader.loadSvgIcon(
    "icons/previous-match.svg",
    document.getElementById("search-prev"),
  );
  iconLoader.loadSvgIcon(
    "icons/next-match.svg",
    document.getElementById("search-next"),
  );
  iconLoader.loadSvgIcon(
    "icons/case-sensitive.svg",
    document.getElementById("search-case"),
  );
  iconLoader.loadSvgIcon("icons/moon.svg", themeToggle);
  iconLoader.loadSvgIcon(
    "icons/minus.svg",
    document.getElementById("zoom-out"),
  );
  iconLoader.loadSvgIcon("icons/plus.svg", document.getElementById("zoom-in"));
  iconLoader.loadSvgIcon("icons/undo.svg", document.getElementById("undo-btn"));
  iconLoader.loadSvgIcon("icons/redo.svg", document.getElementById("redo-btn"));
  const savedTheme = localStorage.getItem("theme");

  const applyTheme = (theme) => {
    const isDark = theme === "dark";
    document.documentElement.dataset.theme = isDark ? "dark" : "light";
    themeToggle.title = isDark ? "Disable dark mode" : "Enable dark mode";
    themeToggle.setAttribute(
      "aria-label",
      isDark ? "Disable dark mode" : "Enable dark mode",
    );
  };

  applyTheme(savedTheme === "dark" ? "dark" : "light");
  themeToggle.addEventListener("click", () => {
    const nextTheme =
      document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);
    localStorage.setItem("theme", nextTheme);
  });

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

    if (key === "f") {
      event.preventDefault();
      searchManager.open();
      return;
    }

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

  // Search observes block edits and controls edit-mode match navigation.
  const searchManager = new SearchManager(blockManager);
  window.searchManager = searchManager;

  // Initialize the FileManager: handles file I/O and committed history
  const fileManager = new FileManager(blockManager);
  const startupPromise = window.api
    .getInitialFilePath()
    .then((filePath) =>
      filePath ? fileManager.openFile(filePath) : fileManager.newFile(),
    );
  window.api.onFileOpen((filePath) =>
    startupPromise.then(() => fileManager.openFile(filePath)),
  );
  window.api.onCloseRequested(() =>
    fileManager.handleCloseRequest().catch((error) => {
      console.error("Close request failed:", error);
      return window.api.respondToClose("cancel");
    }),
  );

  // Start with a new file (which creates a default "New document" block)
  const startupControls = [
    "btn-new",
    "btn-open",
    "btn-save",
    "undo-btn",
    "redo-btn",
  ].map((id) => document.getElementById(id));
  startupControls.forEach((control) => {
    control.disabled = true;
  });
  startupPromise.finally(() => {
    startupControls.forEach((control) => {
      control.disabled = false;
    });
  });
});
