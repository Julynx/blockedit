// selectionManager.js - Margin Drag Selection
// Clicking and dragging from the page margin paints a selection rectangle
// in the accent color. Blocks the rectangle touches become selected and
// stay selected on release. Right-clicking a selected block offers Copy
// and Delete actions that apply to the whole selection.

class SelectionManager {
  /**
   * @param {BlockManager} blockManager
   */
  constructor(blockManager) {
    this.blockManager = blockManager;

    // Drag state (coordinates kept in page space so auto-scroll extends the
    // rectangle over newly revealed content while the anchor stays put).
    this.dragArmed = false; // Margin pressed, threshold not yet crossed
    this.dragging = false; // Rectangle visible
    this.startX = 0;
    this.startY = 0;
    this.lastClientX = 0;
    this.lastClientY = 0;
    this.rectangleEl = null;
    this.scrollAnimationId = null;
    this.scrollAccumulator = 0;
    this.blockRectCache = null; // Page-space block rects, snapshotted per drag

    this.menuEl = null;

    document.addEventListener("mousedown", (event) =>
      this._handleMouseDown(event),
    );
    document.addEventListener("mousemove", (event) =>
      this._handleMouseMove(event),
    );
    document.addEventListener("mouseup", () => this._endDrag());
    document.addEventListener("contextmenu", (event) =>
      this._handleContextMenu(event),
    );
    document.addEventListener("keydown", (event) => this._handleKeyDown(event));
  }

  // ===== Selection rectangle =====

  /**
   * A "margin" press is a left-button mousedown that lands outside every
   * block and outside the app's chrome (header, floating controls, menu).
   */
  _isMarginPress(event) {
    if (event.button !== 0) return false;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return false;
    return !target.closest(
      ".block, #app-header, .zoom-control, #toc-panel, #search-control, .selection-context-menu",
    );
  }

  _handleMouseDown(event) {
    // Any press outside the menu closes it.
    if (
      this.menuEl &&
      !(
        event.target instanceof Element &&
        event.target.closest(".selection-context-menu")
      )
    ) {
      this._closeMenu();
    }

    if (!this._isMarginPress(event)) return;

    // Clicking the margin deselects everything (and arms a possible drag,
    // whose new selection naturally replaces the cleared one).
    this.blockManager.clearSelection();

    // Prevent the browser from starting a native text selection drag.
    event.preventDefault();

    this.dragArmed = true;
    this.startX = event.clientX + window.scrollX;
    this.startY = event.clientY + window.scrollY;
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;
  }

  _handleMouseMove(event) {
    if (!this.dragArmed && !this.dragging) return;
    // Only record coordinates here; all geometry and scroll work happens in
    // the rAF loop so each frame commits a single, consistent update.
    this.lastClientX = event.clientX;
    this.lastClientY = event.clientY;

    if (!this.dragging) {
      // Small dead zone so a plain margin click never flashes a rectangle.
      const dx = event.clientX + window.scrollX - this.startX;
      const dy = event.clientY + window.scrollY - this.startY;
      if (Math.hypot(dx, dy) < 4) return;
      this._beginDrag();
    }
  }

  _beginDrag() {
    this.dragArmed = false;
    this.dragging = true;
    document.body.classList.add("selection-dragging");

    this.rectangleEl = document.createElement("div");
    this.rectangleEl.className = "selection-rectangle";
    document.body.appendChild(this.rectangleEl);

    this.scrollAccumulator = 0;
    this._snapshotBlockRects();

    // Single per-frame update: auto-scroll near viewport edges, then repaint
    // the rectangle and re-hit-test, all in the same frame.
    const frameStep = () => {
      if (!this.dragging) return;
      this._applyEdgeScroll();
      this._updateDrag();
      this.scrollAnimationId = requestAnimationFrame(frameStep);
    };
    this.scrollAnimationId = requestAnimationFrame(frameStep);
  }

  /**
   * Block geometry in page space cannot change during a drag (no re-render
   * happens mid-drag), so measure once and reuse for every hit test.
   */
  _snapshotBlockRects() {
    this.blockRectCache = this.blockManager.blocks.map((block) => {
      const rect = block.element
        ? block.element.getBoundingClientRect()
        : { left: 0, top: 0, right: 0, bottom: 0 };
      return {
        id: block.id,
        element: block.element,
        left: rect.left + window.scrollX,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
      };
    });
  }

  /**
   * Scrolls when the pointer rests near the top/bottom viewport edge. Uses
   * behavior:"instant" to override the global smooth-scroll CSS: launching
   * 60 smooth animations per second is what made this laggy and jittery.
   * A fractional accumulator keeps the speed ramp smooth instead of
   * jumping between integer steps at the zone boundary.
   */
  _applyEdgeScroll() {
    const velocity = this._edgeScrollVelocity(this.lastClientY);
    if (velocity === 0) {
      this.scrollAccumulator = 0;
      return;
    }
    this.scrollAccumulator += velocity;
    const step = Math.trunc(this.scrollAccumulator);
    this.scrollAccumulator -= step;
    if (step !== 0) {
      window.scrollBy({ top: step, behavior: "instant" });
    }
  }

  /**
   * Scroll speed (px/frame) based on pointer proximity to the top/bottom
   * viewport edge.
   */
  _edgeScrollVelocity(clientY) {
    const zone = 48;
    const maxSpeed = 18;
    if (clientY < zone) {
      return -((zone - clientY) / zone) * maxSpeed;
    }
    if (clientY > window.innerHeight - zone) {
      return ((clientY - (window.innerHeight - zone)) / zone) * maxSpeed;
    }
    return 0;
  }

  /**
   * Repositions the rectangle and re-selects every block it touches.
   * Runs once per animation frame from the drag loop.
   */
  _updateDrag() {
    if (!this.dragging || !this.rectangleEl) return;

    const endX = this.lastClientX + window.scrollX;
    const endY = this.lastClientY + window.scrollY;
    const left = Math.min(this.startX, endX);
    const top = Math.min(this.startY, endY);
    const width = Math.abs(endX - this.startX);
    const height = Math.abs(endY - this.startY);

    Object.assign(this.rectangleEl.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${width}px`,
      height: `${height}px`,
    });

    // Hit-test against the cached page-space rects: any intersection
    // ("touch") selects. Block order cannot change mid-drag, so a cheap
    // index-aligned identity check detects the rare mid-drag re-render
    // and rebuilds the snapshot only then.
    const blocks = this.blockManager.blocks;
    if (
      !this.blockRectCache ||
      this.blockRectCache.length !== blocks.length ||
      this.blockRectCache.some(
        (entry, index) => entry.element !== blocks[index].element,
      )
    ) {
      this._snapshotBlockRects();
    }

    const selRight = left + width;
    const selBottom = top + height;
    const touchedIds = [];
    for (const entry of this.blockRectCache) {
      if (!entry.element || !entry.element.isConnected) continue;
      const touches =
        entry.left < selRight &&
        entry.right > left &&
        entry.top < selBottom &&
        entry.bottom > top;
      if (touches) touchedIds.push(entry.id);
    }
    this.blockManager.selectBlocks(touchedIds);
  }

  _endDrag() {
    this.dragArmed = false;
    if (!this.dragging) return;
    this.dragging = false;
    document.body.classList.remove("selection-dragging");
    if (this.scrollAnimationId !== null) {
      cancelAnimationFrame(this.scrollAnimationId);
      this.scrollAnimationId = null;
    }
    this.rectangleEl?.remove();
    this.rectangleEl = null;
    this.blockRectCache = null;
    // The selection built during the drag stays put on release.
  }

  // ===== Context menu (Copy / Delete) =====

  _handleContextMenu(event) {
    const target = event.target instanceof Element ? event.target : null;
    const blockEl = target?.closest(".block");

    // Only selected blocks offer actions; anything else keeps the default.
    if (
      !blockEl ||
      !this.blockManager.selectedBlockIds.has(blockEl.dataset.blockId)
    ) {
      this._closeMenu();
      return;
    }

    event.preventDefault();
    this._openMenu(event.clientX, event.clientY);
  }

  _openMenu(clientX, clientY) {
    this._closeMenu();

    const menu = document.createElement("div");
    menu.className = "selection-context-menu";

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "selection-menu-item";
    copyBtn.textContent = "Copy";
    copyBtn.addEventListener("click", () => {
      this._copySelection();
      this._closeMenu();
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "selection-menu-item danger";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => {
      this.blockManager.removeBlocks(this.blockManager.getSelectedIds());
      this._closeMenu();
    });

    menu.appendChild(copyBtn);
    menu.appendChild(deleteBtn);
    document.body.appendChild(menu);
    this.menuEl = menu;

    // Clamp to the viewport now that the menu has measurable size.
    const left = Math.min(clientX, window.innerWidth - menu.offsetWidth - 8);
    const top = Math.min(clientY, window.innerHeight - menu.offsetHeight - 8);
    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;

    window.addEventListener("scroll", this._boundCloseMenu, true);
    window.addEventListener("resize", this._boundCloseMenu);
  }

  _boundCloseMenu = () => this._closeMenu();

  _closeMenu() {
    if (!this.menuEl) return;
    this.menuEl.remove();
    this.menuEl = null;
    window.removeEventListener("scroll", this._boundCloseMenu, true);
    window.removeEventListener("resize", this._boundCloseMenu);
  }

  async _copySelection() {
    const ids = this.blockManager.getSelectedIds();
    if (ids.length === 0) return;
    const text = this.blockManager.serializeBlocks(ids);
    try {
      await navigator.clipboard.writeText(text);
      this._dispatchStatus(
        `Copied ${ids.length} block${ids.length === 1 ? "" : "s"}`,
      );
    } catch (error) {
      console.error("Copy failed:", error);
      this._dispatchStatus("Copy failed", true);
    }
  }

  _dispatchStatus(message, isError = false) {
    document.dispatchEvent(
      new CustomEvent("editor-status", { detail: { message, isError } }),
    );
  }

  // ===== Keyboard =====

  _handleKeyDown(event) {
    if (event.key !== "Escape") return;
    if (this.menuEl) {
      this._closeMenu();
      return;
    }
    this._endDrag();
    this.blockManager.clearSelection();
  }
}

// Export for use in other modules
window.SelectionManager = SelectionManager;
