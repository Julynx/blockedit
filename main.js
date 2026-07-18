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
const MAX_FILE_BYTES = 64 * 1024 * 1024;

// Keep a global reference to the window so it isn't garbage collected
let mainWindow;
let approvedFilePath = null;
let closeRequestPending = false;
let isClosing = false;
let pendingFilePath = null;
let rendererReady = false;
const initialFilePath = filePathFromArguments(
  process.defaultApp ? process.argv.slice(2) : process.argv.slice(1),
);

function filePathFromArguments(args) {
  return args.find(
    (argument) =>
      !argument.startsWith("-") && /\.(md|markdown)$/i.test(argument),
  );
}

function openFileInRenderer(filePath) {
  if (!filePath) return;
  if (mainWindow && rendererReady) {
    mainWindow.webContents.send("file:open-path", filePath);
  } else {
    pendingFilePath = filePath;
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, commandLine) => {
    const filePath = filePathFromArguments(commandLine);
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
    openFileInRenderer(filePath);
  });
}

function isMainWindowSender(event) {
  return mainWindow && event.sender === mainWindow.webContents;
}

function pathsMatch(left, right) {
  return left && right && path.resolve(left) === path.resolve(right);
}

async function writeFileAtomically(targetPath, content) {
  const directory = path.dirname(targetPath);
  const fileName = path.basename(targetPath);
  const suffix = `${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}`;
  const temporaryPath = path.join(directory, `.${fileName}.${suffix}.tmp`);
  const backupPath = path.join(directory, `.${fileName}.${suffix}.bak`);
  let handle;

  try {
    handle = await fs.open(temporaryPath, "w");
    await handle.writeFile(content, "utf-8");
    await handle.sync();
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await handle?.close();
  }

  try {
    // This is atomic on platforms that allow rename-overwrite.
    await fs.rename(temporaryPath, targetPath);
  } catch (error) {
    if (!["EEXIST", "EPERM", "ENOTEMPTY"].includes(error.code)) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }

    // Windows does not replace an existing file with rename(). Keep a backup
    // while replacing it so a failed second rename can restore the original.
    let originalMoved = false;
    try {
      await fs.rename(targetPath, backupPath);
      originalMoved = true;
      await fs.rename(temporaryPath, targetPath);
      await fs.rm(backupPath, { force: true });
    } catch (replacementError) {
      await fs.rm(temporaryPath, { force: true });
      if (originalMoved) {
        try {
          await fs.rename(backupPath, targetPath);
        } catch (restoreError) {
          replacementError.message += ` Original file could not be restored: ${restoreError.message}`;
        }
      }
      throw replacementError;
    }
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
}

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
    icon: path.join(__dirname, "assets", "app-icon.ico"),
  });

  // Load the HTML file that contains our UI
  mainWindow.loadFile(path.join(__dirname, "renderer", "index.html"));

  mainWindow.webContents.once("did-finish-load", () => {
    rendererReady = true;
    if (pendingFilePath) {
      const filePath = pendingFilePath;
      pendingFilePath = null;
      openFileInRenderer(filePath);
    }
  });

  // Keep DevTools available during development without opening them in builds.
  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools();
  }

  // Remove the default menu bar (we're making our own simple UI)
  Menu.setApplicationMenu(null);

  // Clean up when window is closed
  mainWindow.on("closed", () => {
    mainWindow = null;
    rendererReady = false;
    approvedFilePath = null;
  });

  mainWindow.on("close", (event) => {
    if (isClosing) return;

    event.preventDefault();
    if (closeRequestPending) return;

    closeRequestPending = true;
    mainWindow.webContents.send("app:close-requested");
  });
}

// This method is called when Electron has finished initialization
app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;
  createWindow();

  // On macOS, re-create a window when the dock icon is clicked and no windows are open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  openFileInRenderer(filePath);
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
async function readFile(filePath) {
  try {
    const fileInfo = await fs.stat(filePath);
    if (fileInfo.size > MAX_FILE_BYTES) {
      return { filePath, content: null, error: "File is too large" };
    }
    const content = await fs.readFile(filePath, "utf-8");
    approvedFilePath = filePath;
    return { filePath, content };
  } catch (error) {
    console.error("Failed to read file:", error);
    return { filePath, content: null, error: error.message };
  }
}

ipcMain.handle("app:initial-file-path", () => initialFilePath || null);

ipcMain.handle("file:open", async () => {
  if (!mainWindow) return null;

  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ["openFile"],
    filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return readFile(result.filePaths[0]);
});

ipcMain.handle("file:open-path", async (event, filePath) => {
  if (!isMainWindowSender(event) || typeof filePath !== "string") return null;
  return readFile(filePath);
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
ipcMain.handle("file:save", async (event, data) => {
  if (!mainWindow) return { success: false, error: "No window" };
  if (!isMainWindowSender(event)) {
    return { success: false, error: "Unauthorized save request" };
  }
  if (!data || typeof data.content !== "string") {
    return { success: false, error: "File content must be a string" };
  }
  if (Buffer.byteLength(data.content, "utf8") > MAX_FILE_BYTES) {
    return { success: false, error: "File content is too large" };
  }
  if (
    data.filePath !== undefined &&
    data.filePath !== null &&
    typeof data.filePath !== "string"
  ) {
    return { success: false, error: "File path must be a string" };
  }

  const { filePath, content } = data;

  let targetPath = filePath;

  if (targetPath && !pathsMatch(targetPath, approvedFilePath)) {
    return { success: false, error: "The requested file is not approved" };
  }

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
    await writeFileAtomically(targetPath, content);
    approvedFilePath = targetPath;
    return { success: true, filePath: targetPath };
  } catch (error) {
    console.error("Failed to save file:", error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle("file:clear-current-path", (event) => {
  if (!isMainWindowSender(event)) return false;
  approvedFilePath = null;
  return true;
});

ipcMain.handle("app:close-response", (event, decision) => {
  if (!isMainWindowSender(event) || !closeRequestPending) return false;
  if (!["close", "cancel"].includes(decision)) return false;

  closeRequestPending = false;
  if (decision === "close") {
    isClosing = true;
    mainWindow.close();
  }
  return true;
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
