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

    // UI elements
    this.fileNameEl = document.getElementById("file-name");
    this.dirtyIndicatorEl = document.getElementById("dirty-indicator");

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

    this.currentFilePath = null;
    this.isDirty = false;
    this._resetHistory();
    this._updateUI();

    // Create default content: one block with an h1, in render mode
    this.blockManager.deserialize("# New document");

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

    try {
      const result = await window.api.openFile();
      if (!result) return; // User cancelled

      if (result.error) {
        alert(`Error opening file: ${result.error}`);
        return;
      }

      this.currentFilePath = result.filePath;
      this.isDirty = false;
      this._resetHistory();
      this.historyBase = result.content;
      this._updateUI();

      // Load the file content into blocks
      this.blockManager.deserialize(result.content);
    } catch (error) {
      console.error("Failed to open file:", error);
      alert("Failed to open file. See console for details.");
    }
  }

  /**
   * Saves the current file.
   * If no file path is known, shows a save dialog.
   * @returns {Promise<boolean>} True if saved successfully
   */
  async saveFile() {
    const content = this.blockManager.serialize();

    try {
      const result = await window.api.saveFile({
        filePath: this.currentFilePath,
        content: content,
      });

      if (result.canceled) return false;

      if (result.error) {
        alert(`Error saving file: ${result.error}`);
        return false;
      }

      if (result.success) {
        this._recordCheckpoint(content);
        this.currentFilePath = result.filePath;
        this.isDirty = false;
        this._updateUI();
        return true;
      }

      return false;
    } catch (error) {
      console.error("Failed to save file:", error);
      alert("Failed to save file. See console for details.");
      return false;
    }
  }

  /**
   * Creates an in-memory history checkpoint and writes to disk when the file
   * has a path. New files still receive undo/redo checkpoints before saving.
   */
  async autosave() {
    if (this.isDirty) {
      this._recordCheckpoint(this.blockManager.serialize());
      if (this.currentFilePath) {
        await this.saveFile();
      }
      console.log("Autosaved at", new Date().toLocaleTimeString());
    }
  }

  /**
   * Gets the current file path.
   */
  getCurrentFilePath() {
    return this.currentFilePath;
  }

  /**
   * Checks if there are unsaved changes.
   */
  hasUnsavedChanges() {
    return this.isDirty;
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
    this.isDirty = true;
    this._updateUI();

    // Debounce autosave: reset the timer on every change
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer);
    }

    this.autosaveTimer = setTimeout(() => {
      this.autosave();
    }, this.AUTOSAVE_DELAY);
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
      : "Untitled";

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

  _loadHistory(index) {
    this.blockManager.deserialize(this._contentAt(index));
    this.historyIndex = index;
    this.isDirty = false;
    this._updateUI();
  }

  undo() {
    if (this.historyBase === null) return;
    if (this.isDirty) this._loadHistory(this.historyIndex);
    if (this.historyIndex > 0) this._loadHistory(this.historyIndex - 1);
  }

  redo() {
    if (this.historyBase === null) return;
    if (this.isDirty) this._loadHistory(this.historyIndex);
    if (this.historyIndex < this.history.length)
      this._loadHistory(this.historyIndex + 1);
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
