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
   * @returns {Object} The created block data
   */
  addBlock(index = this.blocks.length, content = "", autoEdit = true) {
    const blockData = {
      id: this._generateId(),
      content: content,
      mode: "render", // 'edit' or 'render'
      element: null, // Will hold the DOM element
      textarea: null, // Reference to textarea in edit mode
      renderedDiv: null, // Reference to rendered div
    };

    this.blocks.splice(index, 0, blockData);
    this._renderAllBlocks();

    if (autoEdit) {
      this.editBlock(blockData.id);
    }

    return blockData;
  }

  /**
   * Removes a block by ID.
   * @param {string} id
   */
  removeBlock(id) {
    const index = this.blocks.findIndex((b) => b.id === id);
    if (index === -1) return;

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

    this._renderAllBlocks();
    this._notifyChange();

    if (createdReplacement) {
      this.editBlock(this.blocks[0].id);
    }
  }

  /**
   * Switches a block to edit mode.
   * @param {string} id
   */
  async editBlock(id) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block || block.mode === "edit") return;

    // First, render the currently edited block (if any)
    if (this.activeEditBlock) {
      await this.renderBlock(this.activeEditBlock.id);
    }

    block.mode = "edit";
    this.activeEditBlock = block;
    this._renderBlock(block);

    // Focus the textarea and auto-resize it
    if (block.textarea) {
      block.textarea.focus();
      this._autoResizeTextarea(block.textarea);
    }

    // Keep edit-mode popups below the block visible when editing near the
    // bottom of the viewport.
    this._centerBlockIfBelowViewport(block.element);
  }

  /**
   * Switches a block to render mode (compiles markdown to HTML).
   * @param {string} id
   */
  async renderBlock(id) {
    const block = this.blocks.find((b) => b.id === id);
    if (!block || block.mode === "render") return;

    // Save the current textarea content back to the block data
    if (block.textarea) {
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

    // Notify that content changed (for autosave)
    this._notifyChange();
  }

  /**
   * Serializes all blocks into a single markdown string.
   * Each block is wrapped in <section data-block-id="..."> tags.
   * @returns {string}
   */
  serialize() {
    return this.blocks
      .map((block) => {
        return `<section data-block-id="${block.id}">\n\n${block.content}\n\n</section>`;
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
      // Plain markdown: split on blank lines (allowing trailing whitespace on the blank line)
      const rawBlocks = normalized.split(/\n[ \t]*\n+/);
      rawBlocks.forEach((raw) => {
        const content = raw.trim();
        if (content) {
          this.blocks.push({
            id: this._generateId(),
            content: content,
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

    this._renderAllBlocks();
  }

  /**
   * Gets the total number of blocks.
   */
  getBlockCount() {
    return this.blocks.length;
  }

  /**
   * Registers a callback to be notified when any block content changes.
   * Used by FileManager for autosave.
   */
  onChange(callback) {
    this._changeCallback = callback;
  }

  // ===== Private Methods =====

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
  _renderAllBlocks() {
    this.container.innerHTML = "";
    this.blocks.forEach((block) => this._renderBlock(block));
  }

  /**
   * Renders a single block (creates its DOM element).
   */
  async _renderBlock(block) {
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
      this._buildRenderMode(blockEl, block);
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
      this._notifyChange();
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
    tickBtn.innerHTML = "✓";
    tickBtn.title = "Render (Shift+Enter)";
    tickBtn.addEventListener("click", () => this.renderBlock(block.id));
    blockEl.appendChild(tickBtn);

    // Focus and auto-resize
    setTimeout(() => {
      textarea.focus();
      this._autoResizeTextarea(textarea);
    }, 0);
  }

  /**
   * Builds the render mode UI: compiled HTML.
   * Empty (or whitespace-only) blocks show a grey placeholder instead,
   * so the user can see the block exists and knows to click it.
   */
  async _buildRenderMode(blockEl, block) {
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
        console.log(html);
        renderedDiv.innerHTML = html;
      } catch (error) {
        console.error("Failed to render markdown:", error);
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

        window.api.openExternalLink(link.href).then((result) => {
          if (!result.success) {
            console.warn("Link was not opened:", result.error);
          }
        });
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
    deleteBtn.title = "Delete block";
    deleteBtn.setAttribute("aria-label", "Delete block");
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

  /**
   * Adds plus buttons above and below the block for inserting new blocks.
   */
  _addPlusButtons(blockEl, blockId) {
    const index = this.blocks.findIndex((b) => b.id === blockId);

    // Plus button above
    const plusTop = document.createElement("button");
    plusTop.className = "block-plus block-plus-top";
    plusTop.innerHTML = "+";
    plusTop.title = "Insert block above";
    plusTop.addEventListener("click", (e) => {
      e.stopPropagation();
      this.addBlock(index, "", true);
    });
    blockEl.appendChild(plusTop);

    // Plus button below
    const plusBottom = document.createElement("button");
    plusBottom.className = "block-plus block-plus-bottom";
    plusBottom.innerHTML = "+";
    plusBottom.title = "Insert block below";
    plusBottom.addEventListener("click", (e) => {
      e.stopPropagation();
      this.addBlock(index + 1, "", true);
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
   * Centers a block when it starts below the middle of the viewport.
   * @param {HTMLElement} blockElement
   */
  _centerBlockIfBelowViewport(blockElement) {
    if (
      !blockElement ||
      blockElement.getBoundingClientRect().top <= window.innerHeight / 2
    ) {
      return;
    }

    blockElement.scrollIntoView({ behavior: "smooth", block: "center" });
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
   * Notifies the change callback (used for autosave).
   */
  _notifyChange() {
    if (this._changeCallback) {
      this._changeCallback();
    }
  }
}

// Export for use in other modules
window.BlockManager = BlockManager;
