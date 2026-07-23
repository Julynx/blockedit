// searchManager.js - Literal document search and edit-mode highlighting.

// Debounce before re-scanning the document after a query/case change.
const REBUILD_DEBOUNCE_MS = 1000;
// Grace period before hiding the search bar after its query is cleared.
const HIDE_DELAY_MS = 400;

class SearchManager {
  constructor(blockManager) {
    this.blockManager = blockManager;
    this.searchButton = document.getElementById("search-btn");
    this.control = document.getElementById("search-control");
    this.input = document.getElementById("search-input");
    this.caseButton = document.getElementById("search-case");
    this.previousButton = document.getElementById("search-prev");
    this.nextButton = document.getElementById("search-next");
    this.count = document.getElementById("search-count");
    this.query = "";
    this.caseSensitive = false;
    this.nodes = [];
    this.byBlock = new Map();
    this.current = null;
    this.rebuildTimer = null;
    this.hideTimer = null;
    this.active = false;

    this.searchButton.addEventListener("click", () => this.open());
    this.caseButton.addEventListener("click", () => {
      this.caseSensitive = !this.caseSensitive;
      this.caseButton.setAttribute("aria-pressed", String(this.caseSensitive));
      this.caseButton.classList.toggle("active", this.caseSensitive);
      this.scheduleRebuild();
    });
    this.input.addEventListener("input", () => {
      this.query = this.input.value;
      if (!this.query) {
        this.clearOccurrences();
        this.scheduleHide(true);
        return;
      }
      clearTimeout(this.hideTimer);
      this.scheduleRebuild();
    });
    this.control.addEventListener("focusout", (event) => {
      if (!this.control.contains(event.relatedTarget)) this.scheduleHide();
    });
    this.previousButton.addEventListener("click", () => this.navigate(-1));
    this.nextButton.addEventListener("click", () => this.navigate(1));

    document.addEventListener("editor-search-clear", () => this.close());
    document.addEventListener("editor-document-replaced", () => {
      if (this.active) this.rebuild();
    });
    this.blockManager.onChange((change) => this._handleBlockChange(change));
    // Keep the highlight layer aligned when a block's DOM changes for
    // reasons other than typing (re-render, scroll, line-wrap toggle).
    this.blockManager.onBlockDomChange((blockId) => this.refreshBlock(blockId));
    this.close();
  }

  open() {
    clearTimeout(this.hideTimer);
    this.active = true;
    this.searchButton.hidden = true;
    this.control.hidden = false;
    this.input.focus();
    this.input.select();
  }

  close() {
    clearTimeout(this.hideTimer);
    this.active = false;
    this.query = "";
    this.input.value = "";
    this.clearOccurrences();
    this.control.hidden = true;
    this.searchButton.hidden = false;
    this.input.blur();
  }

  /**
   * Hides the search bar when it has no query. With delay=true (the query
   * was just cleared by editing) the hide happens after a grace period and
   * regardless of focus; otherwise (focus left the control) it happens
   * immediately, but only when focus is really outside the control.
   */
  scheduleHide(delay = false) {
    clearTimeout(this.hideTimer);
    if (!this.active || this.query) return;
    const hide = () => {
      const focusInsideSearch = this.control.contains(document.activeElement);
      if (!this.query && (delay || !focusInsideSearch)) this.close();
    };
    if (!delay) {
      hide();
      return;
    }
    this.hideTimer = setTimeout(hide, HIDE_DELAY_MS);
  }

  scheduleRebuild() {
    clearTimeout(this.rebuildTimer);
    this.rebuildTimer = setTimeout(() => this.rebuild(true), REBUILD_DEBOUNCE_MS);
  }

  rebuild(resetCurrent = false) {
    if (!this.active || !this.query) {
      this.clearOccurrences();
      return;
    }
    const previousKey =
      !resetCurrent && this.current
        ? { blockId: this.current.blockId, start: this.current.start }
        : null;
    this.nodes = [];
    this.byBlock.clear();
    for (const block of this.blockManager.blocks) {
      this._appendBlockOccurrences(block.id, this._blockText(block));
    }
    this._sortNodes();
    this.current = previousKey
      ? this._findClosest(previousKey) || this.nodes[0] || null
      : null;
    this._updateUI();
    this.refreshAllHighlights();
  }

  updateBlock(blockId, content) {
    if (!this.active || !this.query) return;
    const oldCurrent = this.current;
    const oldStart = oldCurrent?.blockId === blockId ? oldCurrent.start : null;
    this.nodes = this.nodes.filter((node) => node.blockId !== blockId);
    this.byBlock.delete(blockId);
    this._appendBlockOccurrences(blockId, content);
    this._sortNodes();
    if (oldCurrent?.blockId === blockId) {
      const replacement = this.nodes.find(
        (node) => node.blockId === blockId && node.start >= (oldStart ?? 0),
      );
      this.current =
        replacement ||
        this._findClosest({ blockId, start: oldStart ?? 0 }) ||
        this.nodes[0] ||
        null;
    } else if (oldCurrent && !this.nodes.includes(this.current)) {
      this.current = this.nodes[0] || null;
    }
    this._updateUI();
    this.refreshBlock(blockId);
  }

  _handleBlockChange(change) {
    if (!this.active || !this.query) return;
    if (change.type === "edit" && change.blockId) {
      if (change.blockContent !== undefined) {
        this.updateBlock(change.blockId, change.blockContent);
      }
      return;
    }
    if (change.type === "commit") this.rebuild();
  }

  clearOccurrences() {
    clearTimeout(this.rebuildTimer);
    this.nodes = [];
    this.byBlock.clear();
    this.current = null;
    this._updateUI();
    document.querySelectorAll(".search-highlight-layer").forEach((layer) => {
      layer.parentElement?.classList.remove("has-search-highlights");
      layer.remove();
    });
  }

  async navigate(direction) {
    if (!this.nodes.length) return;
    const previous = this.current;
    if (!this.current) {
      // No focused match yet: Next selects the first, Previous wraps to last.
      this.current =
        direction === 1 ? this.nodes[0] : this.nodes[this.nodes.length - 1];
    } else {
      const index = this.nodes.indexOf(this.current);
      const nextIndex =
        (index + direction + this.nodes.length) % this.nodes.length;
      this.current = this.nodes[nextIndex];
    }
    await this.blockManager.editBlock(this.current.blockId);
    const block = this.blockManager.blocks.find(
      (item) => item.id === this.current.blockId,
    );
    if (!block?.textarea) return;
    block.textarea.focus({ preventScroll: true });
    block.textarea.setSelectionRange(this.current.start, this.current.end);
    if (previous && previous.blockId !== this.current.blockId) {
      this.refreshBlock(previous.blockId);
    }
    this._syncLayer(block);
    block.element?.scrollIntoView({ block: "nearest" });
    this._updateUI();
  }

  refreshAllHighlights() {
    for (const block of this.blockManager.blocks) this.refreshBlock(block.id);
  }

  refreshBlock(blockId) {
    const block = this.blockManager.blocks.find((item) => item.id === blockId);
    if (!block?.textarea || !block.element) return;
    this._ensureLayer(block);
    this._syncLayer(block);
  }

  _blockText(block) {
    return block.textarea && block.mode === "edit"
      ? block.textarea.value
      : block.content;
  }

  _appendBlockOccurrences(blockId, content) {
    if (!this.query) return;
    const source = this.caseSensitive ? content : content.toLocaleLowerCase();
    const needle = this.caseSensitive
      ? this.query
      : this.query.toLocaleLowerCase();
    const matches = [];
    let position = 0;
    while (needle && (position = source.indexOf(needle, position)) !== -1) {
      matches.push({
        blockId,
        start: position,
        end: position + needle.length,
      });
      position += needle.length;
    }
    if (matches.length) this.byBlock.set(blockId, matches);
    this.nodes.push(...matches);
  }

  _sortNodes() {
    const order = new Map(
      this.blockManager.blocks.map((block, index) => [block.id, index]),
    );
    this.nodes.sort(
      (a, b) =>
        order.get(a.blockId) - order.get(b.blockId) || a.start - b.start,
    );
  }

  _findClosest(key) {
    if (!key || !this.nodes.length) return null;
    return (
      this.nodes.find(
        (node) => node.blockId === key.blockId && node.start >= key.start,
      ) ||
      this.nodes.find((node) => node.blockId === key.blockId) ||
      this.nodes[0]
    );
  }

  _updateUI() {
    const index = this.current ? this.nodes.indexOf(this.current) : -1;
    this.count.textContent = this.current
      ? `${index + 1} / ${this.nodes.length}`
      : `- / ${this.nodes.length}`;
    this.previousButton.disabled = !this.nodes.length;
    this.nextButton.disabled = !this.nodes.length;
  }

  _ensureLayer(block) {
    const textareaParent = block.textarea?.parentElement;
    if (!textareaParent) return;
    if (block.highlightLayer?.parentNode === textareaParent) return;
    const layer = document.createElement("div");
    layer.className = "search-highlight-layer";
    textareaParent.insertBefore(layer, block.textarea);
    textareaParent.classList.add("has-search-highlights");
    block.highlightLayer = layer;
  }

  _syncLayer(block) {
    const layer = block.highlightLayer;
    if (!layer || !block.textarea) return;
    const text = block.textarea.value;
    const occurrences = this.byBlock.get(block.id) || [];
    let html = "";
    let cursor = 0;
    for (const occurrence of occurrences) {
      html += EditorUtils.escapeHtml(text.slice(cursor, occurrence.start));
      const className = occurrence === this.current ? " current" : "";
      html += `<mark class="search-match${className}">${EditorUtils.escapeHtml(text.slice(occurrence.start, occurrence.end))}</mark>`;
      cursor = occurrence.end;
    }
    layer.innerHTML = html + EditorUtils.escapeHtml(text.slice(cursor));
    layer.scrollTop = block.textarea.scrollTop;
    layer.scrollLeft = block.textarea.scrollLeft;
  }
}

window.SearchManager = SearchManager;
