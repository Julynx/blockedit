// utils.js - Shared Renderer Utilities
// Small helpers used by several renderer modules, plus the editor-wide
// persisted preferences. Loaded first so every other script can rely on
// window.EditorUtils and window.EditorSettings.

const EditorUtils = {
  /**
   * Creates a serial promise queue: each enqueued operation runs only after
   * the previous one settles. A rejected operation is reported through
   * onError and does not break the chain — the queue continues with the
   * next operation.
   *
   * @param {function(Error): void} onError - Called when an operation rejects
   * @returns {{enqueue: function(function(): Promise): Promise,
   *            whenIdle: function(): Promise}}
   */
  createPromiseQueue(onError) {
    let tail = Promise.resolve();
    return {
      enqueue(operation) {
        const nextOperation = tail.then(operation);
        tail = nextOperation.catch(onError);
        return nextOperation;
      },
      whenIdle() {
        return tail;
      },
    };
  },

  /**
   * Escapes HTML special characters to prevent injection.
   * @param {string} text - Raw text
   * @returns {string} Escaped text safe for HTML insertion
   */
  escapeHtml(text) {
    const div = document.createElement("div");
    div.textContent = text;
    return div.innerHTML;
  },

  /**
   * Broadcasts a status message through the document. FileManager listens
   * and renders it in the header's save-status area.
   * @param {string} message
   * @param {boolean} isError - Error messages persist until replaced
   */
  dispatchEditorStatus(message, isError = false) {
    document.dispatchEvent(
      new CustomEvent("editor-status", { detail: { message, isError } }),
    );
  },
};

// Editor-wide preferences persisted in localStorage (like the theme) and
// shared by every block toolbar. Values are stored as "on"/"off" strings.
const EditorSettings = {
  LINE_WRAP: "lineWrap",

  get(key, fallback) {
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    return value === "on";
  },

  set(key, enabled) {
    localStorage.setItem(key, enabled ? "on" : "off");
  },
};

// Export for use in other modules
window.EditorUtils = EditorUtils;
window.EditorSettings = EditorSettings;
