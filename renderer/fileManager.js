// fileManager.js - File Operations & Persistence
// Handles opening, saving, and creating new files, the save-status UI, and
// the commit-time persistence queue. Undo/redo history lives in
// historyManager.js; this class wires it to persistence and the block model.
// Communicates with the main process via the secure API exposed in preload.js.

class FileManager {
  /**
   * @param {BlockManager} blockManager - The block manager to serialize/deserialize
   */
  constructor(blockManager) {
    this.blockManager = blockManager;
    this.currentFilePath = null; // Path of the currently open file
    this.isDirty = false; // Whether there are unsaved changes
    this.savePromise = null;

    // Committed changes are persisted one at a time, in order.
    this.persistenceQueue = EditorUtils.createPromiseQueue((error) => {
      console.error("Committed change failed:", error);
      this._setStatus("Save failed", true);
    });

    // UI elements
    this.fileNameEl = document.getElementById("file-name");
    this.dirtyIndicatorEl = document.getElementById("dirty-indicator");
    this.saveStatusEl = document.getElementById("save-status");
    this.saveStatusTimer = null;
    document.addEventListener("editor-status", (event) => {
      this._setStatus(event.detail.message, event.detail.isError);
    });

    // Undo/redo history. The callbacks keep HistoryManager free of direct
    // BlockManager/FileManager dependencies.
    this.historyManager = new HistoryManager({
      deserialize: async (content) => {
        await this.blockManager.deserialize(content);
        document.dispatchEvent(new CustomEvent("editor-document-replaced"));
      },
      persist: () =>
        this._queuePersistence(() =>
          this._persistContent(this.blockManager.serialize()),
        ),
      isDirty: () => this.isDirty,
      onRestored: () => {
        this.isDirty = true;
        this._updateUI();
      },
    });

    // Register for block edits and committed document changes.
    this.blockManager.onChange((change) => this._onContentChange(change));

    // Wire up header buttons
    this._setupEventListeners();
  }

  /**
   * Creates a new file.
   * If there are unsaved changes, prompts the user first.
   */
  async newFile() {
    const shouldProceed = await this._checkUnsavedChanges();
    if (!shouldProceed) return;
    await this.historyManager.whenIdle();
    await this.persistenceQueue.whenIdle();
    await this.blockManager.whenIdle();
    await window.api.clearCurrentFilePath();
    document.dispatchEvent(new CustomEvent("editor-search-clear"));

    this.currentFilePath = null;
    this.blockManager.documentDirectory = null;
    this.isDirty = false;
    this.historyManager.reset();
    this._updateUI();

    // Create default content: one block with an h1, in render mode
    await this.blockManager.deserialize("# New document");

    // Add an empty block in edit mode
    await this.blockManager.addBlock();
    this.historyManager.setBase(this.blockManager.serialize());
    document.dispatchEvent(new CustomEvent("editor-document-replaced"));
  }

  /**
   * Opens an existing file via dialog.
   * If there are unsaved changes, prompts the user first.
   */
  async openFile(filePath = null) {
    const shouldProceed = await this._checkUnsavedChanges();
    if (!shouldProceed) return;
    await this.historyManager.whenIdle();
    await this.persistenceQueue.whenIdle();
    await this.blockManager.whenIdle();

    try {
      const result = filePath
        ? await window.api.openFilePath(filePath)
        : await window.api.openFile();
      if (!result) return; // User cancelled

      if (result.error) {
        this._setStatus("Could not open file", true);
        return;
      }

      await this.blockManager.whenIdle();
      await this.persistenceQueue.whenIdle();

      this.currentFilePath = result.filePath;
      // Relative images resolve against the document folder at render time,
      // so the directory must be set before the blocks are deserialized.
      this.blockManager.documentDirectory = this._dirname(result.filePath);
      this.isDirty = false;
      this.historyManager.reset();
      this.historyManager.setBase(result.content);
      this._updateUI();
      document.dispatchEvent(new CustomEvent("editor-search-clear"));

      // Load the file content into blocks
      await this.blockManager.deserialize(result.content);
      this.historyManager.setBase(this.blockManager.serialize());
      document.dispatchEvent(new CustomEvent("editor-document-replaced"));
      this._setStatus("Opened");
    } catch (error) {
      console.error("Failed to open file:", error);
      this._setStatus("Could not open file", true);
    }
  }

  /**
   * Saves the current file.
   * If no file path is known, shows a save dialog.
   * @returns {Promise<boolean>} True if saved successfully
   */
  saveFile() {
    if (this.savePromise) return this.savePromise;

    const savePromise = this._saveFile();
    const wrappedPromise = savePromise.finally(() => {
      if (this.savePromise === wrappedPromise) this.savePromise = null;
    });
    this.savePromise = wrappedPromise;
    return wrappedPromise;
  }

  async _saveFile() {
    try {
      await this.persistenceQueue.whenIdle();
      await this.historyManager.whenIdle();
      await this.blockManager.whenIdle();
      await this.blockManager.flushActiveEdit();
      await this.blockManager.whenIdle();
      const content = this.blockManager.serialize();
      this.historyManager.recordCheckpoint(content);
      return await this._persistContent(content, true);
    } catch (error) {
      console.error("Failed to save file:", error);
      this._setStatus("Save failed", true);
      return false;
    }
  }

  /**
   * Checks if there are unsaved changes.
   */
  hasUnsavedChanges() {
    return this.isDirty;
  }

  async handleCloseRequest() {
    if (this.savePromise) await this.savePromise;
    await this.historyManager.whenIdle();
    await this.persistenceQueue.whenIdle();
    await this.blockManager.whenIdle();
    const shouldClose = await this._checkUnsavedChanges();
    await window.api.respondToClose(shouldClose ? "close" : "cancel");
  }

  /**
   * Delegated to HistoryManager so buttons and shortcuts keep working
   * against the same public API.
   */
  undo() {
    return this.historyManager.undo();
  }

  redo() {
    return this.historyManager.redo();
  }

  // ===== Private Methods =====

  /**
   * Sets up button event listeners and keyboard shortcuts.
   */
  _setupEventListeners() {
    // Header buttons
    document
      .getElementById("btn-new")
      .addEventListener("click", () => this.newFile());
    document
      .getElementById("btn-open")
      .addEventListener("click", () => this.openFile());
    document
      .getElementById("btn-save")
      .addEventListener("click", () => this.saveFile());
    document
      .getElementById("undo-btn")
      .addEventListener("click", () => this.undo());
    document
      .getElementById("redo-btn")
      .addEventListener("click", () => this.redo());

    // Keyboard shortcut: Ctrl+S / Cmd+S to save
    document.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        this.saveFile();
      }
    });
  }

  /**
   * Called whenever block content changes. Typing only marks the document
   * dirty; committed changes also enter the history and persistence queue.
   */
  _onContentChange(change = { type: "edit" }) {
    // A new edit starts a new history branch after undo/redo restoration.
    this.historyManager.clearRestorePending();
    if (this.saveStatusEl.classList.contains("error")) {
      this._clearStatus();
    }
    this.isDirty = true;
    this._updateUI();

    if (change.type === "commit") {
      this._queueCommit(change.content, change.previousContent);
    }
  }

  _queueCommit(content, previousContent = null) {
    this._queuePersistence(() => {
      if (previousContent !== null) {
        this.historyManager.recordCheckpoint(previousContent);
      }
      this.historyManager.recordCheckpoint(content);
      return this._persistContent(content);
    });
  }

  _queuePersistence(operation) {
    return this.persistenceQueue.enqueue(operation);
  }

  /**
   * Returns the folder portion of a file path, using either slash style.
   */
  _dirname(filePath) {
    return filePath.replace(/[\\/][^\\/]*$/, "");
  }

  async _persistContent(content, allowSaveDialog = false) {
    if (!this.currentFilePath && !allowSaveDialog) return true;

    this._setStatus("Saving...");
    const result = await window.api.saveFile({
      filePath: this.currentFilePath,
      content,
    });

    if (result.canceled) {
      this._clearStatus();
      return false;
    }
    if (result.error || !result.success) {
      this._setStatus("Save failed", true);
      return false;
    }

    this.currentFilePath = result.filePath;
    const newDirectory = this._dirname(result.filePath);
    if (this.blockManager.documentDirectory !== newDirectory) {
      this.blockManager.documentDirectory = newDirectory;
      // A first save gives relative images a folder to resolve against.
      this.blockManager.refreshImageUrls();
    }
    const contentIsCurrent = this.blockManager.serialize() === content;
    this.isDirty = !contentIsCurrent;
    if (contentIsCurrent) {
      this.historyManager.clearRestorePending();
      this._setStatus("Saved");
    }
    this._updateUI();
    return true;
  }

  _setStatus(message, isError = false) {
    if (this.saveStatusTimer) {
      clearTimeout(this.saveStatusTimer);
      this.saveStatusTimer = null;
    }

    this.saveStatusEl.textContent = message;
    this.saveStatusEl.classList.toggle("error", isError);

    if (!isError && message) {
      this.saveStatusTimer = setTimeout(() => this._clearStatus(), 1800);
    }
  }

  _clearStatus() {
    if (this.saveStatusTimer) {
      clearTimeout(this.saveStatusTimer);
      this.saveStatusTimer = null;
    }
    this.saveStatusEl.textContent = "";
    this.saveStatusEl.classList.remove("error");
  }

  /**
   * Checks for unsaved changes and prompts the user if needed.
   * @returns {Promise<boolean>} True if it's safe to proceed (saved or discarded)
   */
  async _checkUnsavedChanges() {
    if (!this.isDirty) return true;

    const choice = await window.api.showUnsavedChangesDialog();

    switch (choice) {
      case "save":
        return await this.saveFile();
      case "dontsave":
        return true;
      case "cancel":
      default:
        return false;
    }
  }

  /**
   * Updates the UI to reflect current file state (name, dirty indicator).
   */
  _updateUI() {
    // Update file name display
    const displayName = this.currentFilePath
      ? this.currentFilePath.split(/[\\/]/).pop() // Get just the filename
      : "Untitled (Not saved)";

    this.fileNameEl.textContent = displayName;

    // Update dirty indicator
    if (this.isDirty) {
      this.dirtyIndicatorEl.classList.add("visible");
      document.title = `• ${displayName} - BlockEdit`;
    } else {
      this.dirtyIndicatorEl.classList.remove("visible");
      document.title = `${displayName} - BlockEdit`;
    }
    this.historyManager.updateButtons();
  }
}

// Export for use in other modules
window.FileManager = FileManager;
