// fileManager.js - File Operations & Autosave
// Handles opening, saving, and creating new files, plus autosave logic.
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
    this.autosaveTimer = null; // Timer for debounced autosave
    this.AUTOSAVE_DELAY = 1000; // 1 second of inactivity triggers save
    this.historyBase = null;
    this.history = [];
    this.historyIndex = 0;
    this.historyBytes = 0;
    this.historyMutationQueue = Promise.resolve();
    this.historyRestorePendingSave = false;
    this.savePromise = null;

    // UI elements
    this.fileNameEl = document.getElementById("file-name");
    this.dirtyIndicatorEl = document.getElementById("dirty-indicator");
    this.saveStatusEl = document.getElementById("save-status");
    this.saveStatusTimer = null;
    document.addEventListener("editor-status", (event) => {
      this._setStatus(event.detail.message, event.detail.isError);
    });

    // Register for block changes to trigger autosave
    this.blockManager.onChange(() => this._onContentChange());

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
    this._clearAutosaveTimer();
    await window.api.clearCurrentFilePath();

    this.currentFilePath = null;
    this.isDirty = false;
    this.historyRestorePendingSave = false;
    this._resetHistory();
    this._updateUI();

    // Create default content: one block with an h1, in render mode
    await this.blockManager.deserialize("# New document");

    // Add an empty block in edit mode
    await this.blockManager.addBlock();
    this.historyBase = this.blockManager.serialize();
  }

  /**
   * Opens an existing file via dialog.
   * If there are unsaved changes, prompts the user first.
   */
  async openFile() {
    const shouldProceed = await this._checkUnsavedChanges();
    if (!shouldProceed) return;
    await this.historyMutationQueue;
    this._clearAutosaveTimer();

    try {
      const result = await window.api.openFile();
      if (!result) return; // User cancelled

      if (result.error) {
        this._setStatus("Could not open file", true);
        return;
      }

      this.currentFilePath = result.filePath;
      this.isDirty = false;
      this.historyRestorePendingSave = false;
      this._resetHistory();
      this.historyBase = result.content;
      this._updateUI();

      // Load the file content into blocks
      await this.blockManager.deserialize(result.content);
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
    this._clearAutosaveTimer();
    this._setStatus("Saving...");

    try {
      await this.blockManager.flushActiveEdit();
      const content = this.blockManager.serialize();
      const result = await window.api.saveFile({
        filePath: this.currentFilePath,
        content: content,
      });

      if (result.canceled) {
        this._clearStatus();
        return false;
      }

      if (result.error) {
        this._setStatus("Save failed", true);
        return false;
      }

      if (result.success) {
        if (!this.historyRestorePendingSave) {
          this._recordCheckpoint(content);
        }
        this.currentFilePath = result.filePath;
        const contentIsCurrent = this.blockManager.serialize() === content;
        this.isDirty = !contentIsCurrent;
        if (contentIsCurrent) {
          this.historyRestorePendingSave = false;
          this._setStatus("Saved");
        } else {
          this._scheduleAutosave();
        }
        this._updateUI();
        return true;
      }

      this._setStatus("Save failed", true);
      return false;
    } catch (error) {
      console.error("Failed to save file:", error);
      this._setStatus("Save failed", true);
      return false;
    }
  }

  /**
   * Creates an in-memory history checkpoint and writes to disk when the file
   * has a path. New files still receive undo/redo checkpoints before saving.
   */
  async autosave() {
    if (this.isDirty) {
      if (!this.historyRestorePendingSave) {
        this._recordCheckpoint(this.blockManager.serialize());
      }
      if (this.currentFilePath) {
        await this.saveFile();
      } else {
        this.historyRestorePendingSave = false;
      }
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
    const shouldClose = await this._checkUnsavedChanges();
    if (shouldClose) this._clearAutosaveTimer();
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
   * Called whenever block content changes.
   * Marks the file as dirty and schedules an autosave.
   */
  _onContentChange() {
    // A new edit starts a new history branch after undo/redo restoration.
    this.historyRestorePendingSave = false;
    if (this.saveStatusEl.classList.contains("error")) {
      this._clearStatus();
    }
    this.isDirty = true;
    this._updateUI();

    this._scheduleAutosave();
  }

  _scheduleAutosave() {
    this._clearAutosaveTimer();

    this.autosaveTimer = setTimeout(() => {
      this.autosaveTimer = null;
      void this.autosave();
    }, this.AUTOSAVE_DELAY);
  }

  _clearAutosaveTimer() {
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
      this.autosaveTimer = null;
    }
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
      document.title = `• ${displayName} - Markdown Blocks`;
    } else {
      this.dirtyIndicatorEl.classList.remove("visible");
      document.title = `${displayName} - Markdown Blocks`;
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
    this.historyIndex = index;
    // Deserialization intentionally does not notify the change listener, so
    // history restoration must schedule persistence explicitly. It does not
    // create a new checkpoint, which keeps undo/redo from recording itself.
    this.historyRestorePendingSave = true;
    this.isDirty = true;
    this._updateUI();
    this._scheduleAutosave();
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
