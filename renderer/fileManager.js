// fileManager.js - File Operations & Autosave
// Handles opening, saving, and creating new files, plus autosave logic.
// Communicates with the main process via the secure API exposed in preload.js.

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
    this._updateUI();

    // Create default content: one block with an h1, in render mode
    this.blockManager.deserialize("# New document");

    // Add an empty block in edit mode
    this.blockManager.addBlock();
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
   * Triggers an autosave if the file has been saved before.
   * If it's a new file, autosave is skipped (user must save manually first).
   */
  async autosave() {
    if (this.currentFilePath && this.isDirty) {
      await this.saveFile();
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
  }
}

// Export for use in other modules
window.FileManager = FileManager;
