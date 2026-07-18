// tocManager.js - Dynamic Table of Contents
// Tracks ATX headings per block and renders a navigable document outline.
// Updates only on committed block changes, never per keypress.

class TocManager {
  /**
   * @param {BlockManager} blockManager - The block manager to observe
   */
  constructor(blockManager) {
    this.blockManager = blockManager;
    this.panel = document.getElementById("toc-panel");
    this.list = document.getElementById("toc-list");
    this.toggleButton = document.getElementById("toc-btn");
    this.byBlock = new Map(); // blockId -> [{ level, content }]
    this.knownIds = new Set(); // Every block currently represented in the TOC

    this.toggleButton.addEventListener("click", () => this._togglePopup());
    // Clicking anywhere outside the popup or its button closes the popup.
    document.addEventListener("click", (event) => {
      if (!this.panel.classList.contains("open")) return;
      if (this.panel.contains(event.target)) return;
      if (this.toggleButton.contains(event.target)) return;
      this.panel.classList.remove("open");
    });
    document.addEventListener("editor-document-replaced", () => this.rebuild());
    this.blockManager.onChange((change) => this._handleChange(change));
  }

  _togglePopup() {
    const willOpen = !this.panel.classList.contains("open");
    this.panel.classList.toggle("open", willOpen);
    if (willOpen) this._positionPopup();
  }

  /**
   * Anchors the popup below the top bar button, right-aligned with it.
   */
  _positionPopup() {
    const rect = this.toggleButton.getBoundingClientRect();
    const panelWidth = this.panel.offsetWidth || 240;
    this.panel.style.top = `${rect.bottom + 6}px`;
    this.panel.style.left = `${Math.max(8, rect.right - panelWidth)}px`;
  }

  /**
   * Fully reparses every block. Used after file loads and undo/redo, where
   * block identity and content can change unpredictably.
   */
  rebuild() {
    this.byBlock.clear();
    this.knownIds.clear();
    for (const block of this.blockManager.blocks) {
      this._scanBlock(block);
    }
    this._render();
  }

  _handleChange(change) {
    if (change.type !== "commit") return;
    this._reconcile(change.blockId);
  }

  /**
   * Brings the TOC in sync after a committed change: drops entries for
   * deleted blocks, rescans the committed block by id, and scans any blocks
   * the TOC has never seen (created directly or by splits during render).
   */
  _reconcile(changedBlockId) {
    const currentIds = new Set(this.blockManager.blocks.map((b) => b.id));
    for (const id of this.knownIds) {
      if (!currentIds.has(id)) {
        this.knownIds.delete(id);
        this.byBlock.delete(id);
      }
    }
    if (changedBlockId && currentIds.has(changedBlockId)) {
      this._scanBlock(
        this.blockManager.blocks.find((block) => block.id === changedBlockId),
      );
    }
    for (const block of this.blockManager.blocks) {
      if (!this.knownIds.has(block.id)) this._scanBlock(block);
    }
    this._render();
  }

  _scanBlock(block) {
    this.knownIds.add(block.id);
    const titles = this._extractTitles(block.content);
    if (titles.length) {
      this.byBlock.set(block.id, titles);
    } else {
      this.byBlock.delete(block.id);
    }
  }

  /**
   * Extracts ATX headings (# ... ######) from raw block markdown, ignoring
   * headings inside fenced code blocks and <pre> sections.
   */
  _extractTitles(content) {
    const titles = [];
    let insideFencedCode = false;
    let insidePre = false;

    for (const line of content.split("\n")) {
      if (/^\s*```/.test(line)) {
        insideFencedCode = !insideFencedCode;
        continue;
      }
      if (insideFencedCode) continue;

      if (/<pre[\s>]/i.test(line)) {
        insidePre = true;
        continue;
      }
      if (/<\/pre>/i.test(line)) {
        insidePre = false;
        continue;
      }
      if (insidePre) continue;

      const match = line.match(/^(#{1,6})\s+(.+)$/);
      if (match) {
        const title = this._cleanTitle(match[2]);
        if (title) titles.push({ level: match[1].length, content: title });
      }
    }
    return titles;
  }

  /**
   * Converts inline markdown to plain text for TOC display.
   */
  _cleanTitle(text) {
    return text
      .replace(/\s+#+$/, "") // Closing sequence: "# Title #"
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) -> text
      .replace(/[*_`~]/g, "")
      .trim();
  }

  /**
   * Rebuilds the TOC list in document order and toggles visibility.
   */
  _render() {
    this.list.textContent = "";
    let itemCount = 0;

    for (const block of this.blockManager.blocks) {
      const titles = this.byBlock.get(block.id) || [];
      for (const title of titles) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = `toc-item toc-level-${title.level}`;
        item.textContent = title.content;
        item.title = title.content;
        item.addEventListener("click", () => this._scrollToBlock(block.id));
        this.list.appendChild(item);
        itemCount++;
      }
    }

    const empty = itemCount === 0;
    this.panel.hidden = empty;
    this.toggleButton.hidden = empty;
    if (empty) this.panel.classList.remove("open");
  }

  /**
   * Scrolls the target block into view in render mode, without focusing it.
   * Stale ids (deleted blocks) are ignored.
   */
  _scrollToBlock(blockId) {
    const block = this.blockManager.blocks.find((item) => item.id === blockId);
    if (!block?.element) return;
    block.element.scrollIntoView({ behavior: "smooth", block: "center" });
    this.panel.classList.remove("open");
  }
}

window.TocManager = TocManager;
