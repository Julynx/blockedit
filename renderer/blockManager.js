// blockManager.js - Block Lifecycle Management
// Handles creating, editing, rendering, and organizing BlockEdit blocks.
// Each block is a self-contained unit with edit and render modes.

class BlockManager {
  /**
   * @param {HTMLElement} container - The DOM element that will hold all blocks
   */
  constructor(container) {
    this.container = container;
    this.blocks = []; // Array of block data objects
    this.toolbar = new Toolbar();
    this.activeEditBlock = null; // Reference to the block currently in edit mode
    this.selectedBlockIds = new Set(); // Blocks selected via margin drag
    this.selectionStartedInsideBlock = false;
    this.draggedBlockId = null;
    this.suppressNextRenderClick = false;
    this.mutationQueue = Promise.resolve();
    this.documentGeneration = 0;
    this._changeCallbacks = [];
    // Folder of the opened document, set by FileManager. Relative image
    // sources are resolved against it at render time; null for unsaved docs.
    this.documentDirectory = null;

    // Listen for clicks outside any block to switch back to render mode
    document.addEventListener("mousedown", (event) => {
      const activeElement = this.activeEditBlock?.element;
      this.selectionStartedInsideBlock = Boolean(
        activeElement && activeElement.contains(event.target),
      );
    });
    document.addEventListener("click", (e) => this._handleDocumentClick(e));
  }

  /**
   * Adds a new block at the specified index.
   * @param {number} index - Position to insert at (defaults to end)
   * @param {string} content - Initial markdown content
   * @param {boolean} autoEdit - Whether to immediately enter edit mode
   * @returns {Promise<Object>} The created block data after the mutation queue
   * completes
   */
  addBlock(index = this.blocks.length, content = "", autoEdit = true) {
    return this._enqueueMutation(() =>
      this._addBlock(index, content, autoEdit),
    );
  }

  addBlockRelative(blockId, offset, content = "", autoEdit = true) {
    return this._enqueueMutation(() => {
      const index = this.blocks.findIndex((block) => block.id === blockId);
      if (index === -1) return null;
      return this._addBlock(index + offset, content, autoEdit);
    });
  }

  async _addBlock(index, content, autoEdit) {
    // Commit the active editor before inserting the new block. Its text is
    // still held by the textarea until rendering copies it into block.content.
    if (this.activeEditBlock) {
      await this._renderBlockAndNotify(this.activeEditBlock.id);
    }

    const blockData = {
      id: this._generateId(),
      content: content,
      mode: "render", // 'edit' or 'render'
      element: null, // Will hold the DOM element
      textarea: null, // Reference to textarea in edit mode
      renderedDiv: null, // Reference to rendered div
    };

    this.blocks.splice(
      Math.max(0, Math.min(index, this.blocks.length)),
      0,
      blockData,
    );
    await this._renderBlock(blockData);
    this._notifyChange("commit", "create-block", null, {
      blockId: blockData.id,
    });

    if (autoEdit) {
      await this._editBlock(blockData.id);
    }

    return blockData;
  }

  /**
   * Removes a block by ID.
   * @param {string} id
   */
  removeBlock(id) {
    return this._enqueueMutation(() => this._removeBlock(id));
  }

  async _removeBlock(id) {
    const index = this.blocks.findIndex((b) => b.id === id);
    if (index === -1) return;

    let previousContent = null;
    const removedBlock = this.blocks[index];
    if (this.activeEditBlock && this.activeEditBlock.id === id) {
      // Preserve uncommitted text so Undo can restore exactly what was deleted.
      removedBlock.content =
        removedBlock.textarea?.value ?? removedBlock.content;
      previousContent = this.serialize();
    }

    // If we're removing the block being edited, clear that reference
    if (this.activeEditBlock && this.activeEditBlock.id === id) {
      this.activeEditBlock = null;
    }

    this.blocks.splice(index, 1);
    this.selectedBlockIds.delete(id);

    // A document always contains at least one block. If the last block was
    // deleted, replace it with a new empty block and put that block in edit
    // mode so the user can immediately continue writing.
    const createdReplacement = this.blocks.length === 0;
    if (createdReplacement) {
      this.blocks.push({
        id: this._generateId(),
        content: "",
        mode: "render",
        element: null,
        textarea: null,
        renderedDiv: null,
      });
    }

    await this._renderAllBlocks();
    this._notifyChange("commit", "delete-block", previousContent, {
      blockId: id,
      deletedBlockId: id,
    });

    if (createdReplacement) {
      await this._editBlock(this.blocks[0].id);
    }
  }

  /**
   * Removes several blocks in a single mutation (single undo checkpoint).
   * @param {Iterable<string>} ids
   */
  removeBlocks(ids) {
    return this._enqueueMutation(() => this._removeBlocks(ids));
  }

  async _removeBlocks(ids) {
    const idSet = new Set(ids);
    if (idSet.size === 0) return;

    // Preserve uncommitted text so Undo restores exactly what was deleted.
    if (this.activeEditBlock && idSet.has(this.activeEditBlock.id)) {
      this.activeEditBlock.content =
        this.activeEditBlock.textarea?.value ?? this.activeEditBlock.content;
      this.activeEditBlock = null;
    }
    const previousContent = this.serialize();

    this.blocks = this.blocks.filter((block) => !idSet.has(block.id));
    idSet.forEach((id) => this.selectedBlockIds.delete(id));

    // A document always contains at least one block.
    const createdReplacement = this.blocks.length === 0;
    if (createdReplacement) {
      this.blocks.push(this._createBlockData(""));
    }

    await this._renderAllBlocks();
    this._notifyChange("commit", "delete-blocks", previousContent);

    if (createdReplacement) {
      await this._editBlock(this.blocks[0].id);
    }
  }

  /**
   * Selection accessors used by SelectionManager. The selected state lives
   * here because block elements are recreated on every render; the visual
   * class is reapplied from this set in _renderBlock.
   */
  selectBlocks(ids) {
    const next = new Set(ids);
    // Skip DOM churn when the hit test produced the same set (the common
    // case while dragging: most frames change nothing).
    if (
      next.size === this.selectedBlockIds.size &&
      [...next].every((id) => this.selectedBlockIds.has(id))
    ) {
      return;
    }
    this.selectedBlockIds = next;
    this._applySelectionClasses();
  }

  clearSelection() {
    if (this.selectedBlockIds.size === 0) return;
    this.selectedBlockIds.clear();
    this._applySelectionClasses();
  }

  getSelectedIds() {
    // Document order, so Copy concatenates blocks as they appear on the page.
    return this.blocks
      .filter((block) => this.selectedBlockIds.has(block.id))
      .map((block) => block.id);
  }

  _applySelectionClasses() {
    for (const block of this.blocks) {
      block.element?.classList.toggle(
        "selected",
        this.selectedBlockIds.has(block.id),
      );
    }
  }

  /**
   * Serializes the given blocks, joined by blank lines like serialize().
   * @param {Iterable<string>} ids
   * @returns {string}
   */
  serializeBlocks(ids) {
    const idSet = new Set(ids);
    return this.blocks
      .filter((block) => idSet.has(block.id))
      .map((block) =>
        block === this.activeEditBlock && block.textarea
          ? block.textarea.value
          : block.content,
      )
      .join("\n\n");
  }

  /**
   * Switches a block to edit mode.
   * @param {string} id
   */
  editBlock(id) {
    return this._enqueueMutation(() => this._editBlock(id));
  }

  async _editBlock(id) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block || block.mode === "edit") return;

    // First, render the currently edited block (if any)
    if (this.activeEditBlock) {
      await this._renderBlockAndNotify(this.activeEditBlock.id);
    }

    block.mode = "edit";
    this.activeEditBlock = block;
    await this._renderBlock(block);

    // Focus the textarea and auto-resize it
    if (block.textarea) {
      block.textarea.focus({ preventScroll: true });
      this._autoResizeTextarea(block.textarea);
    }
  }

  /**
   * Switches a block to render mode (compiles markdown to HTML).
   * @param {string} id
   */
  renderBlock(id) {
    return this._enqueueMutation(() => this._renderBlockAndNotify(id));
  }

  flushActiveEdit() {
    if (!this.activeEditBlock) return Promise.resolve();
    return this.renderBlock(this.activeEditBlock.id);
  }

  async _renderBlockAndNotify(id) {
    const generation = this.documentGeneration;
    const rendered = await this._renderBlockContent(id);
    if (rendered && generation === this.documentGeneration) {
      this._notifyChange("commit", "render", null, { blockId: id });
    }
    return rendered;
  }

  async _renderBlockContent(id) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block || block.mode === "render") return;

    // Save the current textarea content back to the block data
    if (block.textarea) {
      if (block.textarea.value === block.content) {
        block.mode = "render";
        if (this.activeEditBlock && this.activeEditBlock.id === id) {
          this.activeEditBlock = null;
        }
        await this._renderBlock(block);
        return false;
      }

      // Format before compiling so the rendered HTML reflects the formatted
      // Markdown and the saved block uses the same normalized content. The
      // textarea is destroyed below, so refocusing it would be wasted work.
      await this.toolbar.formatMarkdown(block.textarea, null, {
        focus: false,
        dispatchInput: false,
      });
      const formattedContent = block.textarea.value;

      const shardBlocks = this._splitPlainMarkdownIntoBlocks(formattedContent);
      const replacementContents = shardBlocks.length > 0 ? shardBlocks : [""];
      const blockIndex = this.blocks.indexOf(block);
      const replacementBlocks = replacementContents.map((content, index) =>
        this._createBlockData(content, index === 0 ? block.id : undefined),
      );
      this.blocks.splice(blockIndex, 1, ...replacementBlocks);
      this.activeEditBlock = null;

      if (replacementBlocks.length === 1) {
        // Common case: the block did not split. Rebuild only this block's DOM
        // instead of the whole document. The old block object is discarded.
        block.element?.remove();
        await this._renderBlock(replacementBlocks[0]);
      } else {
        await this._renderAllBlocks();
      }
      return true;
    }

    block.mode = "render";
    if (this.activeEditBlock && this.activeEditBlock.id === id) {
      this.activeEditBlock = null;
    }

    await this._renderBlock(block);
    return true;
  }

  /**
   * Serializes all blocks into a single markdown string.
   * Blocks are serialized as Markdown separated by blank lines.
   * @returns {string}
   */
  serialize() {
    return this.blocks
      .map((block) => {
        const content =
          block === this.activeEditBlock && block.textarea
            ? block.textarea.value
            : block.content;
        return content;
      })
      .join("\n\n");
  }

  /**
   * Loads blocks from a markdown string.
   * Splits Markdown on blank lines while keeping fenced code together.
   * @param {string} markdown
   */
  deserialize(markdown) {
    return this._enqueueMutation(() => this._deserialize(markdown));
  }

  async _deserialize(markdown) {
    const generation = ++this.documentGeneration;
    this.blocks = [];
    this.activeEditBlock = null;
    this.selectedBlockIds.clear();

    // Normalize line endings first (Windows \r\n -> \n)
    const normalized = markdown.replace(/\r\n/g, "\n");

    // Plain Markdown: blank lines split blocks unless they are inside a
    // fenced code block. Keep fenced code together even when it contains
    // multiple blank lines.
    const rawBlocks = this._splitPlainMarkdownIntoBlocks(normalized);
    rawBlocks.forEach((content) => {
      if (content) {
        this.blocks.push(this._createBlockData(content));
      }
    });
    // If no blocks were parsed, create one empty block
    if (this.blocks.length === 0) {
      this.blocks.push({
        id: this._generateId(),
        content: "",
        mode: "render",
        element: null,
        textarea: null,
        renderedDiv: null,
      });
    }

    await this._renderAllBlocks(generation);
  }

  _splitPlainMarkdownIntoBlocks(markdown) {
    const blocks = [];
    const lines = markdown.split("\n");
    let insideFencedCode = false;
    let currentBlock = [];

    const finishBlock = () => {
      const content = currentBlock.join("\n").trim();
      if (content) blocks.push(content);
      currentBlock = [];
    };

    for (const line of lines) {
      const isFenceMarker = /^\s*```/.test(line);
      const isEmptyLine = /^\s*$/.test(line);

      if (isFenceMarker) {
        currentBlock.push(line);
        insideFencedCode = !insideFencedCode;
        continue;
      }

      if (isEmptyLine && !insideFencedCode) {
        finishBlock();
        continue;
      }

      currentBlock.push(line);
    }

    finishBlock();
    return blocks;
  }

  _createBlockData(content, id = this._generateId()) {
    return {
      id,
      content,
      mode: "render",
      element: null,
      textarea: null,
      renderedDiv: null,
    };
  }

  whenIdle() {
    return this.mutationQueue;
  }

  /**
   * Registers a callback for edit and committed document changes.
   */
  onChange(callback) {
    this._changeCallbacks.push(callback);
  }

  // ===== Private Methods =====

  _enqueueMutation(operation) {
    const nextOperation = this.mutationQueue.then(operation);
    this.mutationQueue = nextOperation.catch((error) => {
      console.error("Block mutation failed:", error);
    });
    return nextOperation;
  }

  /**
   * Generates a unique ID for a block.
   * Prefers the built-in crypto.randomUUID(); falls back to a
   * timestamp+random string for older runtimes.
   */
  _generateId() {
    if (window.crypto && typeof window.crypto.randomUUID === "function") {
      return "block-" + window.crypto.randomUUID();
    }
    return (
      "block-" + Date.now() + "-" + Math.random().toString(36).substring(2, 11)
    );
  }

  /**
   * Re-renders all blocks in the container.
   */
  async _renderAllBlocks(generation = this.documentGeneration) {
    // A full re-render rebuilds every block's DOM, including the block in
    // edit mode. Its textarea is recreated from block.content, so sync the
    // uncommitted text first; otherwise deleting or moving another block
    // discards text the user just typed or pasted.
    if (this.activeEditBlock?.textarea) {
      this.activeEditBlock.content = this.activeEditBlock.textarea.value;
    }
    this.container.innerHTML = "";
    for (const block of this.blocks) {
      if (generation !== this.documentGeneration) return;
      await this._renderBlock(block);
    }
  }

  /**
   * Renders a single block (creates its DOM element).
   */
  async _renderBlock(block) {
    const generation = this.documentGeneration;
    const renderToken = (block.renderToken || 0) + 1;
    block.renderToken = renderToken;

    // Remove old element if it exists
    if (block.element && block.element.parentNode) {
      block.element.remove();
    }

    // Create the block container
    const blockEl = document.createElement("div");
    blockEl.className = "block";
    blockEl.dataset.blockId = block.id;
    blockEl.classList.toggle("selected", this.selectedBlockIds.has(block.id));

    if (block.mode === "edit") {
      blockEl.classList.add("editing");
      this._buildEditMode(blockEl, block);
    } else {
      await this._buildRenderMode(blockEl, block);
    }

    // A newer render may have started while markdown was being converted.
    // Do not let this stale render replace the block's current DOM reference.
    if (
      generation !== this.documentGeneration ||
      block.renderToken !== renderToken
    ) {
      return;
    }

    // Add plus buttons (visible on hover via CSS)
    this._addPlusButtons(blockEl, block.id);

    block.element = blockEl;
    window.searchManager?.refreshBlock(block.id);

    // Insert the element at the block's correct position in the list.
    // (appendChild would dump it at the end, making blocks "jump" to the
    // bottom whenever they switch between edit and render mode.)
    const nextBlock = this.blocks[this.blocks.indexOf(block) + 1];
    if (
      nextBlock &&
      nextBlock.element &&
      nextBlock.element.parentNode === this.container
    ) {
      this.container.insertBefore(blockEl, nextBlock.element);
    } else {
      this.container.appendChild(blockEl);
    }
  }

  /**
   * Builds the edit mode UI: textarea, toolbar, tick button.
   */
  _buildEditMode(blockEl, block) {
    const editorSurface = document.createElement("div");
    editorSurface.className = "block-editor-surface";

    // Textarea for editing markdown
    const textarea = document.createElement("textarea");
    textarea.className = "block-textarea";
    textarea.value = block.content;
    textarea.placeholder = "Start typing markdown...";
    textarea.spellcheck = false;

    // Auto-resize as user types
    textarea.addEventListener("input", () => {
      this._autoResizeTextarea(textarea);
      this._notifyChange("edit", "input", null, {
        blockId: block.id,
        blockContent: textarea.value,
      });
    });
    textarea.addEventListener("scroll", () =>
      window.searchManager?.refreshBlock(block.id),
    );

    // Keyboard handling inside the editor:
    //   Enter       -> normal newline (default textarea behavior, no handler needed)
    //   Shift+Enter -> render the block and insert a new block below it
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        this.renderBlock(block.id).then(() => {
          this.addBlockRelative(block.id, 1, "", true);
        });
      }
    });

    editorSurface.appendChild(textarea);
    blockEl.appendChild(editorSurface);
    block.textarea = textarea;

    // Apply the persisted line-wrap preference.
    this._applyLineWrap(
      block,
      EditorSettings.get(EditorSettings.LINE_WRAP, true),
    );

    // Toolbar for formatting
    const toolbarEl = this.toolbar.createToolbar(
      textarea,
      () => this.removeBlock(block.id),
      {
        onToggleLineWrap: (enabled) => this._applyLineWrap(block, enabled),
      },
    );
    blockEl.appendChild(toolbarEl);

    // Tick button to confirm/render
    const tickBtn = document.createElement("button");
    tickBtn.className = "block-tick";
    tickBtn.type = "button";
    tickBtn.title = "Render (Shift+Enter)";
    tickBtn.setAttribute("aria-label", "Render (Shift+Enter)");
    this.toolbar.loadSvgIcon("icons/check.svg", tickBtn);
    tickBtn.addEventListener("click", () => this.renderBlock(block.id));
    blockEl.appendChild(tickBtn);

    // Focus and auto-resize
    setTimeout(() => {
      // Temporarily disabled while investigating unexpected scroll behavior.
      // textarea.focus();
      this._autoResizeTextarea(textarea);
    }, 0);
  }

  /**
   * Applies the line-wrap preference to a block being edited. When off, the
   * textarea stops soft-wrapping and shows a horizontal scrollbar instead.
   */
  _applyLineWrap(block, wrapOn) {
    if (!block?.textarea) return;
    block.textarea.wrap = wrapOn ? "soft" : "off";
    block.textarea
      .closest(".block-editor-surface")
      ?.classList.toggle("nowrap", !wrapOn);
    // Wrapping changes the content height, so recompute the textarea size
    // and re-align the search highlight layer with the new layout.
    this._autoResizeTextarea(block.textarea);
    window.searchManager?.refreshBlock(block.id);
  }

  /**
   * Re-reads the persisted editor preferences and applies them to the block
   * currently in edit mode. Called when another window changes a setting
   * (localStorage "storage" event), mirroring the theme sync.
   */
  applyEditorPreferences() {
    const block = this.activeEditBlock;
    if (!block?.textarea) return;
    this._applyLineWrap(
      block,
      EditorSettings.get(EditorSettings.LINE_WRAP, true),
    );
  }

  /**
   * Builds the render mode UI: compiled HTML.
   * Empty (or whitespace-only) blocks show a grey placeholder instead,
   * so the user can see the block exists and knows to click it.
   */
  async _buildRenderMode(blockEl, block) {
    blockEl.draggable = true;
    blockEl.addEventListener("dragstart", (event) => {
      this.draggedBlockId = block.id;
      this.suppressNextRenderClick = true;
      blockEl.classList.add("dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", block.id);
    });
    blockEl.addEventListener("dragover", (event) => {
      if (!this.draggedBlockId || this.draggedBlockId === block.id) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const midpoint =
        blockEl.getBoundingClientRect().top + blockEl.offsetHeight / 2;
      blockEl.classList.toggle("drag-over-top", event.clientY < midpoint);
      blockEl.classList.toggle("drag-over-bottom", event.clientY >= midpoint);
    });
    blockEl.addEventListener("dragleave", (event) => {
      if (!blockEl.contains(event.relatedTarget)) {
        blockEl.classList.remove("drag-over-top", "drag-over-bottom");
      }
    });
    blockEl.addEventListener("drop", (event) => {
      event.preventDefault();
      if (!this.draggedBlockId || this.draggedBlockId === block.id) return;
      const midpoint =
        blockEl.getBoundingClientRect().top + blockEl.offsetHeight / 2;
      const targetIndex = this.blocks.findIndex((item) => item.id === block.id);
      this._moveBlock(
        this.draggedBlockId,
        event.clientY < midpoint ? targetIndex : targetIndex + 1,
      );
      this._clearDragState();
    });
    blockEl.addEventListener("dragend", () => {
      this._clearDragState();
      setTimeout(() => {
        this.suppressNextRenderClick = false;
      }, 0);
    });

    const renderedDiv = document.createElement("div");
    renderedDiv.className = "block-rendered";

    if (block.content.trim() === "") {
      // Placeholder for empty blocks
      const placeholder = document.createElement("span");
      placeholder.className = "block-placeholder";
      placeholder.textContent = "Click here and start typing ...";
      renderedDiv.appendChild(placeholder);
    } else {
      // Convert markdown to HTML using our modular converter. The content-
      // keyed cache avoids reconverting unchanged blocks on mode toggles
      // and full-document re-renders.
      try {
        if (block.renderCache?.content === block.content) {
          renderedDiv.innerHTML = block.renderCache.html;
        } else {
          const html = await window.markdownConverter.convert(block.content);
          renderedDiv.innerHTML = html;
          block.renderCache = { content: block.content, html };
        }
      } catch (error) {
        console.error("Failed to render markdown:", error);
        document.dispatchEvent(
          new CustomEvent("editor-status", {
            detail: { message: "Rendering failed", isError: true },
          }),
        );
        renderedDiv.textContent = block.content;
      }
    }

    this._resolveImageUrls(renderedDiv);

    // Links should be opened by the operating system's default browser, not
    // navigated inside this Electron window. Other clicks still edit the block.
    renderedDiv.addEventListener("click", (event) => {
      const clickedElement =
        event.target instanceof Element
          ? event.target
          : event.target.parentElement;
      const link = clickedElement && clickedElement.closest("a");

      if (link && renderedDiv.contains(link)) {
        event.preventDefault();
        event.stopPropagation();

        // The href attribute preserves the Markdown author's raw reference.
        // Relative links are resolved and validated in the main process,
        // against the opened document's folder.
        const rawHref = link.getAttribute("href") || "";
        if (this._isRelativeReference(rawHref)) {
          window.api
            .openLocalLink(rawHref)
            .then((result) => {
              if (!result?.success) {
                console.warn("Local link was not opened:", result?.error);
              }
            })
            .catch((error) => {
              console.warn("Local link was not opened:", error);
            });
          return;
        }

        window.api
          .openExternalLink(link.href)
          .then((result) => {
            if (!result.success) {
              console.warn("Link was not opened:", result.error);
              document.dispatchEvent(
                new CustomEvent("editor-status", {
                  detail: {
                    message: "Link could not be opened",
                    isError: true,
                  },
                }),
              );
            }
          })
          .catch(() => {
            document.dispatchEvent(
              new CustomEvent("editor-status", {
                detail: { message: "Link could not be opened", isError: true },
              }),
            );
          });
        return;
      }

      if (this.suppressNextRenderClick) {
        this.suppressNextRenderClick = false;
        return;
      }
      this.editBlock(block.id);
    });

    blockEl.appendChild(renderedDiv);
    block.renderedDiv = renderedDiv;

    // Render-mode delete action, revealed when the block is hovered.
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "render-delete-btn";
    deleteBtn.type = "button";
    deleteBtn.title = "Delete Block";
    deleteBtn.setAttribute("aria-label", "Delete Block");
    this.toolbar.loadSvgIcon("icons/trash.svg", deleteBtn);
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.removeBlock(block.id);
    });
    blockEl.appendChild(deleteBtn);
  }

  /**
   * Whether an href is a relative reference to a local file (no protocol,
   * no fragment-only anchor). Such links are opened via the main process,
   * which resolves them against the document folder and whitelists images.
   */
  _isRelativeReference(href) {
    return (
      Boolean(href) &&
      !href.startsWith("#") &&
      !/^[a-z][a-z0-9+.-]*:/i.test(href)
    );
  }

  /**
   * Resolves relative image sources against the opened document's folder.
   * The Markdown content is never modified. Sources that would escape the
   * document folder (for example via "../") are left unresolved.
   */
  _resolveImageUrls(renderedDiv) {
    if (!this.documentDirectory || !renderedDiv) return;

    const baseUrl =
      "file:///" + this.documentDirectory.replace(/\\/g, "/") + "/";

    renderedDiv.querySelectorAll("img").forEach((img) => {
      const src = img.getAttribute("src");
      if (!src || src.startsWith("#")) return;

      if (/^[a-z][a-z0-9+.-]*:/i.test(src)) {
        // Windows-absolute paths (C:\...) look like a protocol but are local
        // files; convert them to file URLs the same way the toolbar does.
        if (/^[A-Za-z]:[\\/]/.test(src)) {
          img.src = "file:///" + encodeURI(src.replace(/\\/g, "/"));
        }
        return;
      }

      const resolved = new URL(src, baseUrl).href;
      if (resolved.startsWith(baseUrl)) {
        img.src = resolved;
      }
    });
  }

  /**
   * Re-resolves image sources in every rendered block. Used when a
   * previously unsaved document gains its first file path, so relative
   * images repair themselves right after the first save.
   */
  refreshImageUrls() {
    for (const block of this.blocks) {
      if (block.renderedDiv) this._resolveImageUrls(block.renderedDiv);
    }
  }

  _moveBlock(id, insertIndex) {
    return this._enqueueMutation(() => this._moveBlockNow(id, insertIndex));
  }

  async _moveBlockNow(id, insertIndex) {
    const currentIndex = this.blocks.findIndex((block) => block.id === id);
    if (currentIndex === -1) return;
    const [block] = this.blocks.splice(currentIndex, 1);
    const adjustedIndex =
      insertIndex > currentIndex ? insertIndex - 1 : insertIndex;
    this.blocks.splice(
      Math.max(0, Math.min(adjustedIndex, this.blocks.length)),
      0,
      block,
    );
    await this._renderAllBlocks();
    this._notifyChange("commit", "move-block");
  }

  _clearDragState() {
    this.draggedBlockId = null;
    this.container
      .querySelectorAll(".dragging, .drag-over-top, .drag-over-bottom")
      .forEach((element) =>
        element.classList.remove(
          "dragging",
          "drag-over-top",
          "drag-over-bottom",
        ),
      );
  }

  /**
   * Adds plus buttons above and below the block for inserting new blocks.
   */
  _addPlusButtons(blockEl, blockId) {
    // Plus button above
    const plusTop = document.createElement("button");
    plusTop.className = "block-plus block-plus-top";
    plusTop.title = "Insert block above";
    plusTop.setAttribute("aria-label", "Insert block above");
    this.toolbar.loadSvgIcon("icons/plus.svg", plusTop);
    plusTop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.addBlockRelative(blockId, 0, "", true);
    });
    blockEl.appendChild(plusTop);

    // Plus button below
    const plusBottom = document.createElement("button");
    plusBottom.className = "block-plus block-plus-bottom";
    plusBottom.title = "Insert block below";
    plusBottom.setAttribute("aria-label", "Insert block below");
    this.toolbar.loadSvgIcon("icons/plus.svg", plusBottom);
    plusBottom.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.addBlockRelative(blockId, 1, "", true);
    });
    blockEl.appendChild(plusBottom);
  }

  /**
   * Auto-resizes a textarea to fit its content.
   * No scrollbars, no width changes — just smooth vertical growth.
   */
  _autoResizeTextarea(textarea) {
    // Resetting to "auto" momentarily collapses the textarea. For blocks
    // taller than the window that shrinks the document, so the browser
    // clamps window.scrollY and the view jumps toward the top of the block
    // on every keypress. The collapsed state is never painted (it happens
    // and is undone within one JS task), but the scroll clamp persists.
    // Restore the scroll position after the final height is applied.
    // behavior: "instant" overrides the global `scroll-behavior: smooth`
    // on <html> (styles.css), which would otherwise animate the restore.
    // The browser's caret-reveal runs after input handlers, so the caret
    // still scrolls into view when it genuinely leaves the viewport.
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
    // With line wrap off, a visible horizontal scrollbar eats into the
    // content box; grow the textarea by its thickness so the last line is
    // not clipped (overflow-y stays hidden).
    if (
      textarea.closest(".block-editor-surface")?.classList.contains("nowrap")
    ) {
      const hScrollbar = textarea.offsetHeight - textarea.clientHeight;
      if (hScrollbar > 0) {
        textarea.style.height = textarea.scrollHeight + hScrollbar + "px";
      }
    }
    if (window.scrollX !== scrollX || window.scrollY !== scrollY) {
      window.scrollTo({ left: scrollX, top: scrollY, behavior: "instant" });
    }
  }

  /**
   * Handles clicks outside any block to switch back to render mode.
   */
  _handleDocumentClick(event) {
    if (!this.activeEditBlock) return;

    const target = event.target instanceof Element ? event.target : null;
    if (
      target?.closest("#search-control, #search-btn, #toc-control, #toc-panel")
    ) {
      return;
    }

    // A drag selection can start inside the textarea and finish outside the
    // block. It still produces a click event, but it is not an outside click
    // in the editing sense, so leave the block in edit mode.
    if (this.selectionStartedInsideBlock) {
      this.selectionStartedInsideBlock = false;
      return;
    }

    const clickedBlock = event.target.closest(".block");
    if (
      !clickedBlock ||
      clickedBlock.dataset.blockId !== this.activeEditBlock.id
    ) {
      this.renderBlock(this.activeEditBlock.id);
    }
  }

  /**
   * Notifies the change callback with a captured committed document snapshot.
   */
  _notifyChange(
    type = "edit",
    reason = type,
    previousContent = null,
    metadata = {},
  ) {
    const change = {
      type,
      reason,
      content:
        type === "commit" ? this.serialize() : (metadata.blockContent ?? null),
      previousContent,
      ...metadata,
    };
    this._changeCallbacks.forEach((callback) => callback(change));
  }
}

// Export for use in other modules
window.BlockManager = BlockManager;
