// popup.js - Generic Anchored Popup
// One shared implementation of the popup lifecycle used by the toolbar's
// menus and popovers: position under an anchor element, ignore clicks
// inside, close on the next outside click, and clean up listeners.

class Popup {
  constructor() {
    this.activeElement = null;
    this._onCancel = null;
    this._cancelled = true;
    this._boundOutsideClick = null;
  }

  /**
   * Opens a popup anchored below anchorEl, closing any previous one. A
   * popup replaced this way counts as cancelled (its onCancel runs).
   *
   * @param {HTMLElement} anchorEl - Element the popup is positioned under
   * @param {function(HTMLElement): (HTMLElement|undefined)} buildContent -
   *   Fills the popup element; may return an element to focus once attached
   * @param {Object} options - onCancel: called when closed without confirm()
   * @returns {HTMLElement} The popup element (already attached to the DOM)
   */
  open(anchorEl, buildContent, { onCancel = null } = {}) {
    this.close();

    const rect = anchorEl.getBoundingClientRect();
    const element = document.createElement("div");
    element.style.left = `${rect.left}px`;
    element.style.top = `${rect.bottom + 8}px`;
    // Clicks inside the popup must not count as outside clicks (they would
    // close the popup and look like clicks outside the edited block).
    element.addEventListener("click", (event) => event.stopPropagation());

    const focusTarget = buildContent(element);
    document.body.appendChild(element);
    this.activeElement = element;
    this._onCancel = onCancel;
    this._cancelled = true;

    // Defer the outside-click listener so the click that opened the popup
    // does not immediately close it.
    setTimeout(() => {
      this._boundOutsideClick = () => this.close();
      document.addEventListener("click", this._boundOutsideClick, {
        once: true,
      });
    }, 0);

    focusTarget?.focus();
    return element;
  }

  /**
   * Closes the popup as a confirmation: onCancel is NOT called.
   */
  confirm() {
    this._cancelled = false;
    this.close();
  }

  /**
   * Closes the popup if open. A popup closed without confirm() first is
   * treated as cancelled and its onCancel callback runs.
   */
  close() {
    if (this.activeElement) {
      this.activeElement.remove();
      this.activeElement = null;
      if (this._cancelled && this._onCancel) this._onCancel();
      this._onCancel = null;
      this._cancelled = true;
    }
    if (this._boundOutsideClick) {
      document.removeEventListener("click", this._boundOutsideClick);
      this._boundOutsideClick = null;
    }
  }
}

// Export for use in other modules
window.Popup = Popup;
