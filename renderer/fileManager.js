// fileManager.js - File Operations & Committed History
// Handles opening, saving, and creating new files, plus committed history.
// Communicates with the main process via the secure API exposed in preload.js.

const MAX_HISTORY_BYTES = 256 * 1024 * 1024;

class FileManager {
  /**
   * @param {BlockManager} blockManager - The block manager to serialize/deserialize
   */
  constructor(blockManager) {
    this.blockManager = blockManager;
    this.currentFilePath = null; // Path of the currently open file
    this.isDirty = false; // Whether there are unsaved changes
    this.historyBase = null;
    this.history = [];
    this.historyIndex = 0;
    this.historyBytes = 0;
    this.historyMutationQueue = Promise.resolve();
    this.historyRestorePendingSave = false;
    this.savePromise = null;
    this.commitQueue = Promise.resolve();

    // UI elements
    this.fileNameEl = document.getElementById("file-name");
    this.dirtyIndicatorEl = document.getElementById("dirty-indicator");
    this.saveStatusEl = document.getElementById("save-status");
    this.saveStatusTimer = null;
    document.addEventListener("editor-status", (event) => {
      this._setStatus(event.detail.message, event.detail.isError);
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
    await this.historyMutationQueue;
    await this.commitQueue;
    await this.blockManager.whenIdle();
    await window.api.clearCurrentFilePath();
    document.dispatchEvent(new CustomEvent("editor-search-clear"));

    this.currentFilePath = null;
    this.blockManager.documentDirectory = null;
    this.isDirty = false;
    this.historyRestorePendingSave = false;
    this._resetHistory();
    this._updateUI();

    // Create default content: one block with an h1, in render mode
    await this.blockManager.deserialize("# New document");

    // Add an empty block in edit mode
    await this.blockManager.addBlock();
    this.historyBase = this.blockManager.serialize();
    document.dispatchEvent(new CustomEvent("editor-document-replaced"));
  }

  /**
   * Opens an existing file via dialog.
   * If there are unsaved changes, prompts the user first.
   */
  async openFile(filePath = null) {
    const shouldProceed = await this._checkUnsavedChanges();
    if (!shouldProceed) return;
    await this.historyMutationQueue;
    await this.commitQueue;
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
      await this.commitQueue;

      this.currentFilePath = result.filePath;
      // Relative images resolve against the document folder at render time,
      // so the directory must be set before the blocks are deserialized.
      this.blockManager.documentDirectory = this._dirname(result.filePath);
      this.isDirty = false;
      this.historyRestorePendingSave = false;
      this._resetHistory();
      this.historyBase = result.content;
      this._updateUI();
      document.dispatchEvent(new CustomEvent("editor-search-clear"));

      // Load the file content into blocks
      await this.blockManager.deserialize(result.content);
      this.historyBase = this.blockManager.serialize();
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
      await this.commitQueue;
      await this.historyMutationQueue;
      await this.blockManager.whenIdle();
      await this.blockManager.flushActiveEdit();
      await this.blockManager.whenIdle();
      const content = this.blockManager.serialize();
      if (!this.historyRestorePendingSave) {
        this._recordCheckpoint(content);
      }
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
    await this.historyMutationQueue;
    await this.commitQueue;
    await this.blockManager.whenIdle();
    const shouldClose = await this._checkUnsavedChanges();
    await window.api.respondToClose(shouldClose ? "close" : "cancel");
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
    this.historyRestorePendingSave = false;
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
      if (!this.historyRestorePendingSave) {
        if (previousContent !== null) {
          this._recordCheckpoint(previousContent);
        }
        this._recordCheckpoint(content);
      }
      return this._persistContent(content);
    });
  }

  _queuePersistence(operation) {
    const nextOperation = this.commitQueue.then(operation);
    this.commitQueue = nextOperation.catch((error) => {
      console.error("Committed change failed:", error);
      this._setStatus("Save failed", true);
    });
    return nextOperation;
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
      this.historyRestorePendingSave = false;
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
    this._updateHistoryUI();
  }

  _resetHistory() {
    this.historyBase = null;
    this.history = [];
    this.historyIndex = 0;
    this.historyBytes = 0;
  }

  _recordCheckpoint(content) {
    if (this.historyBase === null) {
      this.historyBase = content;
      this.history = [];
      this.historyIndex = 0;
      return;
    }
    const previous = this._contentAt(this.historyIndex);
    if (previous === content) return;
    this.history.splice(this.historyIndex);
    this.history.push(Diff.diffChars(previous, content));
    this.historyIndex = this.history.length;
    this._pruneHistory();
  }

  _pruneHistory() {
    this.historyBytes = this.history.reduce(
      (total, diff) => total + this._estimateDiffBytes(diff),
      0,
    );

    // Keep at least one checkpoint. A single very large diff is retained so
    // the newest state remains available even if it exceeds the budget.
    while (this.historyBytes > MAX_HISTORY_BYTES && this.history.length > 1) {
      // The first diff becomes the new baseline when its checkpoint is dropped.
      this.historyBase = this._contentAt(1);
      this.history.shift();
      this.historyIndex = Math.max(0, this.historyIndex - 1);
      this.historyBytes = this.history.reduce(
        (total, diff) => total + this._estimateDiffBytes(diff),
        0,
      );
    }
  }

  _estimateDiffBytes(diff) {
    // Account for UTF-16 string storage plus a small per-change object cost.
    return diff.reduce((total, part) => total + part.value.length * 2 + 32, 0);
  }

  _contentAt(index) {
    let content = this.historyBase;
    for (let i = 0; i < index; i++) {
      content = this.history[i]
        .filter((part) => !part.removed)
        .map((part) => part.value)
        .join("");
    }
    return content;
  }

  async _loadHistory(index) {
    await this.blockManager.deserialize(this._contentAt(index));
    document.dispatchEvent(new CustomEvent("editor-document-replaced"));
    this.historyIndex = index;
    // Deserialization intentionally does not notify the change listener.
    // Restore persistence does not create a new checkpoint.
    this.historyRestorePendingSave = true;
    this.isDirty = true;
    this._updateUI();
    await this._queuePersistence(() =>
      this._persistContent(this.blockManager.serialize()),
    );
  }

  undo() {
    return this._enqueueHistoryMutation(async () => {
      if (this.historyBase === null) return;
      if (this.isDirty) await this._loadHistory(this.historyIndex);
      if (this.historyIndex > 0) await this._loadHistory(this.historyIndex - 1);
    });
  }

  redo() {
    return this._enqueueHistoryMutation(async () => {
      if (this.historyBase === null) return;
      if (this.isDirty) await this._loadHistory(this.historyIndex);
      if (this.historyIndex < this.history.length) {
        await this._loadHistory(this.historyIndex + 1);
      }
    });
  }

  _enqueueHistoryMutation(operation) {
    const nextOperation = this.historyMutationQueue.then(operation);
    this.historyMutationQueue = nextOperation.catch((error) => {
      console.error("History mutation failed:", error);
    });
    return nextOperation;
  }

  _updateHistoryUI() {
    const enabled = this.historyBase !== null;
    document.getElementById("undo-btn").disabled =
      !enabled || this.historyIndex === 0;
    document.getElementById("redo-btn").disabled =
      !enabled || this.historyIndex === this.history.length;
  }
}

// Export for use in other modules
window.FileManager = FileManager;
