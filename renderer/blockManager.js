// blockManager.js - Block Lifecycle Management
// Handles creating, editing, rendering, and organizing markdown blocks.
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
    this.selectionStartedInsideBlock = false;
    this.draggedBlockId = null;
    this.suppressNextRenderClick = false;
    this.mutationQueue = Promise.resolve();
    this.documentGeneration = 0;

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
    this._notifyChange("commit", "create-block");

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
    this._notifyChange("commit", "delete-block", previousContent);

    if (createdReplacement) {
      await this._editBlock(this.blocks[0].id);
    }
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
      this._notifyChange("commit", "render");
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
      // Markdown and the saved block uses the same normalized content.
      await this.toolbar.formatMarkdown(block.textarea);
      block.content = block.textarea.value;
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
   * Each block is wrapped in <section data-block-id="..."> tags.
   * @returns {string}
   */
  serialize() {
    return this.blocks
      .map((block) => {
        const content =
          block === this.activeEditBlock && block.textarea
            ? block.textarea.value
            : block.content;
        return `<section data-block-id="${block.id}">\n\n${content}\n\n</section>`;
      })
      .join("\n\n");
  }

  /**
   * Loads blocks from a markdown string.
   * Parses <section data-block-id="..."> tags if present,
   * otherwise splits on blank lines.
   * @param {string} markdown
   */
  deserialize(markdown) {
    return this._enqueueMutation(() => this._deserialize(markdown));
  }

  async _deserialize(markdown) {
    const generation = ++this.documentGeneration;
    this.blocks = [];
    this.activeEditBlock = null;

    // Normalize line endings first (Windows \r\n -> \n)
    const normalized = markdown.replace(/\r\n/g, "\n");

    // Check if the markdown contains our custom section tags
    const sectionRegex =
      /<section\s+data-block-id="([^"]+)"\s*>([\s\S]*?)<\/section>/g;
    const matches = [...normalized.matchAll(sectionRegex)];

    if (matches.length > 0) {
      // Parse native format with section tags
      matches.forEach((match) => {
        const id = match[1];
        const content = match[2].trim();
        this.blocks.push({
          id: id,
          content: content,
          mode: "render",
          element: null,
          textarea: null,
          renderedDiv: null,
        });
      });
    } else {
      // Plain Markdown: blank lines split blocks unless they are inside a
      // fenced code block. Keep fenced code together even when it contains
      // multiple blank lines.
      const rawBlocks = this._splitPlainMarkdownIntoBlocks(normalized);
      rawBlocks.forEach((content) => {
        if (content) {
          this.blocks.push({
            id: this._generateId(),
            content,
            mode: "render",
            element: null,
            textarea: null,
            renderedDiv: null,
          });
        }
      });
    }

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

  whenIdle() {
    return this.mutationQueue;
  }

  /**
   * Registers a callback for edit and committed document changes.
   */
  onChange(callback) {
    this._changeCallback = callback;
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
    // Textarea for editing markdown
    const textarea = document.createElement("textarea");
    textarea.className = "block-textarea";
    textarea.value = block.content;
    textarea.placeholder = "Start typing markdown...";
    textarea.spellcheck = false;

    // Auto-resize as user types
    textarea.addEventListener("input", () => {
      this._autoResizeTextarea(textarea);
      this._notifyChange("edit");
    });

    // Keyboard handling inside the editor:
    //   Enter       -> normal newline (default textarea behavior, no handler needed)
    //   Shift+Enter -> render the block (Jupyter-style "run cell")
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && e.shiftKey) {
        e.preventDefault();
        this.renderBlock(block.id);
      }
    });

    blockEl.appendChild(textarea);
    block.textarea = textarea;

    // Toolbar for formatting
    const toolbarEl = this.toolbar.createToolbar(textarea, () =>
      this.removeBlock(block.id),
    );
    blockEl.appendChild(toolbarEl);

    // Tick button to confirm/render
    const tickBtn = document.createElement("button");
    tickBtn.className = "block-tick";
    tickBtn.type = "button";
    tickBtn.title = "Render (Shift+Enter)";
    tickBtn.setAttribute("aria-label", "Render (Shift+Enter)");
    const tickIcon = document.createElement("img");
    tickIcon.src = "icons/check.svg";
    tickIcon.alt = "";
    tickBtn.appendChild(tickIcon);
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
      // Convert markdown to HTML using our modular converter
      try {
        const html = await window.markdownConverter.convert(block.content);
        // console.log(html);
        renderedDiv.innerHTML = html;
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
    const deleteIcon = document.createElement("img");
    deleteIcon.src = "icons/trash.svg";
    deleteIcon.alt = "";
    deleteBtn.appendChild(deleteIcon);
    deleteBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.removeBlock(block.id);
    });
    blockEl.appendChild(deleteBtn);
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
    plusTop.innerHTML = "+";
    plusTop.title = "Insert block above";
    plusTop.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.addBlockRelative(blockId, 0, "", true);
    });
    blockEl.appendChild(plusTop);

    // Plus button below
    const plusBottom = document.createElement("button");
    plusBottom.className = "block-plus block-plus-bottom";
    plusBottom.innerHTML = "+";
    plusBottom.title = "Insert block below";
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
    textarea.style.height = "auto";
    textarea.style.height = textarea.scrollHeight + "px";
  }

  /**
   * Handles clicks outside any block to switch back to render mode.
   */
  _handleDocumentClick(event) {
    if (!this.activeEditBlock) return;

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
  _notifyChange(type = "edit", reason = type, previousContent = null) {
    if (this._changeCallback) {
      this._changeCallback({
        type,
        reason,
        content: type === "commit" ? this.serialize() : null,
        previousContent,
      });
    }
  }
}

// Export for use in other modules
window.BlockManager = BlockManager;
