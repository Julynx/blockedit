// main.js - Electron Main Process
// This is the entry point of the app. It runs in Node.js (not the browser).
// Its job is to create the app window, handle system menus, and provide
// secure file system access to the renderer via IPC.

const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  dialog,
  shell,
} = require("electron");
const path = require("path");
const fs = require("fs").promises; // Use promises for async/await syntax
const prettier = require("prettier");

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2;
const ZOOM_STEP = 0.1;

// Keep a global reference to the window so it isn't garbage collected
let mainWindow;

/**
 * Creates the main application window and loads the renderer HTML.
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      // preload.js runs before the page loads and can safely expose APIs
      preload: path.join(__dirname, "preload.js"),
      // These settings are security best practices:
      contextIsolation: true, // Isolates preload from page scripts
      nodeIntegration: false, // Prevents renderer from accessing Node directly
      sandbox: true, // Sandboxes the renderer process
    },
    icon: null, // You can add an icon path here later: path.join(__dirname, 'icon.png')
  });

  // Load the HTML file that contains our UI
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  // Open DevTools automatically in development (comment out for production)
  mainWindow.webContents.openDevTools();

  // Remove the default menu bar (we're making our own simple UI)
  Menu.setApplicationMenu(null);

  // Clean up when window is closed
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// This method is called when Electron has finished initialization
app.whenReady().then(() => {
  createWindow();

  // On macOS, re-create a window when the dock icon is clicked and no windows are open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed (except on macOS, where apps stay active)
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

// ===== IPC Handlers =====
// These listen for messages from the renderer process (the web page)
// and perform privileged operations like reading/writing files.

/**
 * Opens a file dialog to let the user pick a .md file.
 * Returns the file path and contents, or null if cancelled.
 */
ipcMain.handle("file:open", async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  try {
    const content = await fs.readFile(filePath, "utf-8");
    return { filePath, content };
  } catch (error) {
    console.error("Failed to read file:", error);
    return { filePath, content: null, error: error.message };
  }
});

// Keep zoom changes in the main process so they use Electron's page zoom.
ipcMain.handle("zoom:get", (event) => event.sender.getZoomFactor());

ipcMain.handle("zoom:set", (event, requestedZoom) => {
  const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(requestedZoom)));
  const nextZoom = Number.isFinite(zoom) ? zoom : 1;
  event.sender.setZoomFactor(nextZoom);
  return nextZoom;
});

ipcMain.handle("zoom:change", (event, direction) => {
  const currentZoom = event.sender.getZoomFactor();
  const nextZoom = Math.min(
    ZOOM_MAX,
    Math.max(
      ZOOM_MIN,
      currentZoom + (direction === "in" ? ZOOM_STEP : -ZOOM_STEP),
    ),
  );
  event.sender.setZoomFactor(nextZoom);
  return nextZoom;
});

/**
 * Opens an image file picker and returns the selected local path.
 * The renderer receives only the chosen path, not direct dialog or file-system
 * access.
 */
ipcMain.handle("file:choose-image", async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp"],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return { filePath: result.filePaths[0] };
});

/**
 * Saves content to the given file path.
 * If no path is provided, shows a save dialog.
 */
ipcMain.handle("file:save", async (event, { filePath, content }) => {
  if (!mainWindow) return { success: false, error: "No window" };

  let targetPath = filePath;

  // If no path is known, ask the user where to save
  if (!targetPath) {
    const result = await dialog.showSaveDialog(mainWindow, {
      defaultPath: "untitled.md",
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }
    targetPath = result.filePath;
  }

  try {
    await fs.writeFile(targetPath, content, "utf-8");
    return { success: true, filePath: targetPath };
  } catch (error) {
    console.error("Failed to save file:", error);
    return { success: false, error: error.message };
  }
});

/**
 * Opens a web link using the operating system's default browser.
 *
 * The URL is validated here in the main process as well as in the renderer's
 * normal click flow. Renderer input must never be trusted just because it
 * came from our own UI.
 */
ipcMain.handle("link:open-external", async (_event, targetUrl) => {
  if (typeof targetUrl !== "string" || targetUrl.length > 2048) {
    return { success: false, error: "Invalid link" };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
  } catch (_error) {
    return { success: false, error: "Invalid link" };
  }

  // Only allow normal web links. This prevents markdown from asking the OS
  // to open file:, javascript:, or other privileged protocols.
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { success: false, error: "Only HTTP and HTTPS links can be opened" };
  }

  try {
    await shell.openExternal(parsedUrl.toString());
    return { success: true };
  } catch (error) {
    console.error("Failed to open external link:", error);
    return { success: false, error: error.message };
  }
});

/**
 * Shows a confirmation dialog for unsaved changes.
 * Returns 'save', 'dontsave', or 'cancel'.
 */
ipcMain.handle("dialog:unsaved-changes", async () => {
  if (!mainWindow) return "cancel";

  const result = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    title: "Unsaved Changes",
    message: "You have unsaved changes. Do you want to save them?",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
  });

  const responses = ["save", "dontsave", "cancel"];
  return responses[result.response];
});

/**
 * Gets the path of the currently opened file (if any).
 * This is mainly used to update the window title.
 */
ipcMain.handle("file:get-current-path", () => {
  // In a more complex app, you might track this in main.
  // For now, the renderer tracks the path and just asks main to update the title.
  return null;
});

/**
 * Formats one block of Markdown using Prettier.
 * Prettier 3 returns a Promise, so this handler is asynchronous.
 */
ipcMain.handle("markdown:format", async (_event, markdown) => {
  if (typeof markdown !== "string") {
    return {
      success: false,
      error: "Markdown content must be a string",
    };
  }

  try {
    const formattedMarkdown = await prettier.format(markdown, {
      parser: "markdown",
    });

    return {
      success: true,
      content: formattedMarkdown,
    };
  } catch (error) {
    console.error("Markdown formatting failed:", error);

    return {
      success: false,
      error: error.message,
    };
  }
});
