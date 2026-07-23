// historyManager.js - Committed Undo/Redo History
// Stores the document's committed states as a base snapshot plus a list of
// character diffs, capped by a byte budget. Restoring a state deserializes
// it into blocks and re-persists it; restores never create new checkpoints.
//
// HistoryManager is UI-agnostic except for the undo/redo buttons: every
// other interaction with the document goes through the callbacks handed to
// the constructor (FileManager wires them to BlockManager and itself).

const MAX_HISTORY_BYTES = 256 * 1024 * 1024;

class HistoryManager {
  /**
   * @param {Object} callbacks
   * @param {function(string): Promise} callbacks.deserialize - Replace the
   *   document with the given markdown (must also dispatch
   *   "editor-document-replaced")
   * @param {function(): Promise} callbacks.persist - Persist the current
   *   document content
   * @param {function(): boolean} callbacks.isDirty - Current dirty flag
   * @param {function(): void} callbacks.onRestored - Called after each
   *   restore so the owner can mark the document dirty and refresh its UI
   */
  constructor(callbacks) {
    this._callbacks = callbacks;
    this.historyBase = null;
    this.history = [];
    this.historyIndex = 0;
    this.historyBytes = 0;
    // True after an undo/redo restore until the next edit or successful
    // save: restored content must not create new checkpoints.
    this.restorePendingSave = false;
    this._mutationQueue = EditorUtils.createPromiseQueue((error) =>
      console.error("History mutation failed:", error),
    );
  }

  /**
   * Resolves when every queued undo/redo operation has settled.
   */
  whenIdle() {
    return this._mutationQueue.whenIdle();
  }

  /**
   * Drops all history. Used when a document is created or opened.
   */
  reset() {
    this.historyBase = null;
    this.history = [];
    this.historyIndex = 0;
    this.historyBytes = 0;
    this.restorePendingSave = false;
  }

  /**
   * Sets the baseline content that checkpoints are diffed against.
   */
  setBase(content) {
    this.historyBase = content;
  }

  /**
   * Clears the restore guard. A fresh edit or a completed save means
   * checkpoints may be recorded again.
   */
  clearRestorePending() {
    this.restorePendingSave = false;
  }

  /**
   * Records a checkpoint for the given committed content. No-ops while a
   * restored state is waiting to be persisted.
   */
  recordCheckpoint(content) {
    if (this.restorePendingSave) return;
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

  undo() {
    return this._mutationQueue.enqueue(async () => {
      if (this.historyBase === null) return;
      if (this._callbacks.isDirty()) await this._loadHistory(this.historyIndex);
      if (this.historyIndex > 0) await this._loadHistory(this.historyIndex - 1);
    });
  }

  redo() {
    return this._mutationQueue.enqueue(async () => {
      if (this.historyBase === null) return;
      if (this._callbacks.isDirty()) await this._loadHistory(this.historyIndex);
      if (this.historyIndex < this.history.length) {
        await this._loadHistory(this.historyIndex + 1);
      }
    });
  }

  /**
   * Enables/disables the header undo and redo buttons.
   */
  updateButtons() {
    const enabled = this.historyBase !== null;
    document.getElementById("undo-btn").disabled =
      !enabled || this.historyIndex === 0;
    document.getElementById("redo-btn").disabled =
      !enabled || this.historyIndex === this.history.length;
  }

  // ===== Private Methods =====

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
    await this._callbacks.deserialize(this._contentAt(index));
    this.historyIndex = index;
    // Deserialization intentionally does not notify the change listener.
    // Restore persistence does not create a new checkpoint.
    this.restorePendingSave = true;
    this._callbacks.onRestored();
    await this._callbacks.persist();
  }
}

// Export for use in other modules
window.HistoryManager = HistoryManager;
