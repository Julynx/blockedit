// toolbar.js - Toolbar for Markdown Formatting
// Builds the per-block toolbar DOM and owns its popups (header menu,
// options menu, URL/image popovers, table grid). Text manipulation lives in
// markdownEditing.js, icon loading in icons.js, and the popup lifecycle in
// popup.js.

class Toolbar {
  constructor() {
    // Popups anchored to toolbar buttons. One Popup instance per kind, so
    // opening one replaces (and cancels) any previously open one of its kind.
    this.headerMenu = new Popup();
    this.optionsMenu = new Popup();
    this.urlPopover = new Popup();
    this.imagePopover = new Popup();
    this.tableGrid = new Popup();
  }

  /**
   * Creates a toolbar element and wires up all buttons.
   * @param {HTMLTextAreaElement} textarea - The textarea this toolbar controls
   * @param {function} onDelete - Called when the user deletes the block
   * @param {Object} options - Optional callbacks for the extra options menu:
   *   onToggleLineWrap(enabled)
   * @returns {HTMLElement} The toolbar DOM element
   */
  createToolbar(textarea, onDelete, options = {}) {
    const toolbar = document.createElement("div");
    toolbar.className = "block-toolbar";

    // --- Inline formatting ---
    const boldBtn = this._createIconButton("bold", "Bold", () =>
      MarkdownEditing.toggleMarker(textarea, "**"),
    );
    const italicBtn = this._createIconButton("italic", "Italic", () =>
      MarkdownEditing.toggleMarker(textarea, "_"),
    );
    const codeBtn = this._createIconButton("code", "Inline Code", () =>
      MarkdownEditing.toggleMarker(textarea, "`"),
    );
    const strikethroughBtn = this._createIconButton(
      "strikethrough",
      "Strikethrough",
      () => MarkdownEditing.toggleMarker(textarea, "~~"),
    );

    // --- Links and images ---
    const linkBtn = this._createIconButton("link", "Link", (e) =>
      this._insertLink(textarea, e),
    );
    const imageBtn = this._createIconButton("image", "Image", (e) =>
      this._insertImage(textarea, e),
    );

    // --- Block formatting ---
    const headerBtn = this._createIconButton("header", "Header", (e) =>
      this._showHeaderMenu(e, textarea),
    );
    const listBtn = this._createIconButton(
      "list-marker",
      "Unordered List",
      () => MarkdownEditing.insertUnorderedList(textarea),
    );
    const checkboxListBtn = this._createIconButton(
      "checkbox-list",
      "Checkboxes",
      () => MarkdownEditing.insertCheckboxList(textarea),
    );
    const orderedListBtn = this._createIconButton(
      "ordered-list",
      "Ordered List",
      () => MarkdownEditing.insertOrderedList(textarea),
    );
    const indentBtn = this._createIconButton("indent", "Indent", () =>
      MarkdownEditing.changeIndent(textarea, 2),
    );
    const dedentBtn = this._createIconButton("dedent", "Dedent", () =>
      MarkdownEditing.changeIndent(textarea, -2),
    );
    const quoteBtn = this._createIconButton("quote", "Quote", () =>
      MarkdownEditing.prefixCurrentLine(textarea, "> "),
    );
    const fencedCodeBtn = this._createIconButton(
      "fenced-code",
      "Code Block",
      () => MarkdownEditing.wrapSelection(textarea, "```language\n", "\n```"),
    );
    const ruleBtn = this._createIconButton("horizontal-rule", "Separator", () =>
      MarkdownEditing.insertHorizontalRule(textarea),
    );

    // --- Structured content ---
    const tableBtn = this._createIconButton("table", "Table", (e) =>
      this._showTableGrid(e, textarea),
    );

    // --- Extra options (editor preferences) ---
    const optionsBtn = this._createIconButton("dots-vertical", "Options", (e) =>
      this._showOptionsMenu(e, options),
    );

    // Delete belongs at the far right of the bottom toolbar.
    const deleteBtn = this._createDeleteButton(onDelete);

    toolbar.append(
      boldBtn,
      italicBtn,
      strikethroughBtn,
      this._createSeparator(),
      listBtn,
      orderedListBtn,
      checkboxListBtn,
      this._createSeparator(),
      indentBtn,
      dedentBtn,
      this._createSeparator(),
      headerBtn,
      ruleBtn,
      this._createSeparator(),
      quoteBtn,
      codeBtn,
      fencedCodeBtn,
      this._createSeparator(),
      linkBtn,
      imageBtn,
      tableBtn,
      this._createSeparator(),
      optionsBtn,
      deleteBtn,
    );
    return toolbar;
  }

  /**
   * Creates the red trash button used to delete the whole block.
   * The icon is loaded from renderer/icons/trash.svg.
   */
  _createDeleteButton(onDelete) {
    const button = this._createIconButton("trash", "Delete Block", (event) => {
      // Prevent the document click-outside handler from immediately acting
      // on the replacement block when the last block is deleted.
      event.preventDefault();
      event.stopPropagation();
      onDelete();
    });
    button.classList.add("delete-block-btn");

    return button;
  }

  /**
   * Creates a toolbar button backed by an SVG file.
   *
   * A short name such as "bold" loads renderer/icons/bold.svg.
   * A path containing a slash, such as "icons/custom.svg", is used as-is.
   */
  _createIconButton(iconReference, title, onClick) {
    const button = document.createElement("button");
    button.className = "toolbar-btn icon-toolbar-btn";
    button.type = "button";
    button.title = title;
    button.setAttribute("aria-label", title);

    IconLoader.load(iconReference, button);

    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * Helper to create a visual separator between toolbar groups.
   */
  _createSeparator() {
    const sep = document.createElement("div");
    sep.className = "toolbar-separator";
    return sep;
  }

  /**
   * Formats a textarea's Markdown through the secure main-process API.
   * This method is shared by table insertion and the edit-to-render
   * transition.
   *
   * @param {HTMLTextAreaElement} textarea - The active block textarea
   * @param {HTMLButtonElement|null} button - Optional button to disable
   * @param {Object} options - Set focus/dispatchInput to false when the
   * textarea is about to be replaced by a render pass.
   * @returns {Promise<boolean>} Whether formatting succeeded
   */
  async formatMarkdown(
    textarea,
    button = null,
    { focus = true, dispatchInput = true } = {},
  ) {
    if (!textarea) return false;

    if (button) {
      button.disabled = true;
    }

    try {
      const result = await window.api.formatMarkdown(textarea.value);

      if (!result.success) {
        throw new Error(result.error);
      }

      textarea.value = result.content;

      if (dispatchInput) {
        // This keeps auto-resizing and dirty-state tracking working.
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      }

      if (focus) {
        textarea.focus({ preventScroll: true });
        textarea.setSelectionRange(
          textarea.value.length,
          textarea.value.length,
        );
      }
      return true;
    } catch (error) {
      console.error("Could not format Markdown:", error);
      EditorUtils.dispatchEditorStatus("Formatting failed", true);
      return false;
    } finally {
      if (button) {
        button.disabled = false;
      }
    }
  }

  /**
   * Inserts a markdown link. If text is selected, it becomes the link text.
   *
   * NOTE: window.prompt() is NOT supported in Electron (it throws), so we
   * show a small inline popover with a text input for the URL instead.
   */
  _insertLink(textarea, event) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end) || "link text";

    // Remember the selection so we can restore it after the popover closes
    this._showUrlPopover(event.currentTarget, (url) => {
      if (!url) return; // User cancelled or submitted empty input

      const linkMarkdown = `[${selected}](${url})`;
      MarkdownEditing.replaceRange(textarea, start, end, linkMarkdown);

      // Place cursor after the inserted link
      MarkdownEditing.setCursor(textarea, start + linkMarkdown.length);
    });
  }

  /**
   * Opens the image popover and inserts Markdown using the fixed alt text
   * "alt text" plus either a typed URL or a browsed local path.
   */
  _insertImage(textarea, event) {
    event.stopPropagation();

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;

    this._showImagePopover(event.currentTarget, (imagePath) => {
      if (!imagePath) return;

      const imageSource = this._toImageSource(imagePath);

      const imageMarkdown = `![alt text](${imageSource})`;
      MarkdownEditing.replaceRange(textarea, start, end, imageMarkdown);

      MarkdownEditing.setCursor(textarea, start + imageMarkdown.length);
    });
  }

  /**
   * Converts a local filesystem path into a lightweight file URL. Unlike a
   * data URL, this does not copy the image bytes into the Markdown document.
   */
  _toImageSource(imagePath) {
    if (/^https?:\/\//i.test(imagePath) || /^file:\/\//i.test(imagePath)) {
      return encodeURI(imagePath);
    }

    const normalizedPath = imagePath.replace(/\\/g, "/");
    if (/^[A-Za-z]:\//.test(normalizedPath)) {
      return `file:///${encodeURI(normalizedPath)}`;
    }

    // Relative paths remain relative, which is useful for documents whose
    // images are already beside the app's rendered page.
    return encodeURI(normalizedPath);
  }

  /**
   * Shows a small H1-H6 menu and prefixes the current line with the chosen
   * number of Markdown heading markers.
   */
  _showHeaderMenu(event, textarea) {
    event.stopPropagation();

    this.headerMenu.open(event.currentTarget, (menu) => {
      menu.className = "header-menu";

      for (let level = 1; level <= 6; level += 1) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "header-menu-item";
        item.textContent = `H${level}`;
        item.setAttribute("aria-label", `Insert heading level ${level}`);
        item.addEventListener("click", () => {
          this.headerMenu.close();
          MarkdownEditing.prefixCurrentLine(textarea, `${"#".repeat(level)} `);
        });
        menu.appendChild(item);
      }
    });
  }

  /**
   * Shows the extra options dropdown: editor preference toggles whose state
   * is shown with a tick and persisted in localStorage (like the theme).
   * Clicking an option toggles it and closes the menu.
   */
  _showOptionsMenu(event, options) {
    event.stopPropagation();

    this.optionsMenu.open(event.currentTarget, (menu) => {
      menu.className = "options-menu";

      const wrapOn = EditorSettings.get(EditorSettings.LINE_WRAP, true);
      const item = document.createElement("button");
      item.type = "button";
      item.className = "options-menu-item";
      item.classList.toggle("checked", wrapOn);
      item.setAttribute("aria-pressed", String(wrapOn));

      const tick = document.createElement("span");
      tick.className = "options-menu-tick";
      tick.setAttribute("aria-hidden", "true");
      IconLoader.load("icons/check.svg", tick);

      const label = document.createElement("span");
      label.textContent = "Line wrap";

      item.append(tick, label);
      item.addEventListener("click", () => {
        const next = !EditorSettings.get(EditorSettings.LINE_WRAP, true);
        EditorSettings.set(EditorSettings.LINE_WRAP, next);
        this.optionsMenu.close();
        options.onToggleLineWrap?.(next);
      });
      menu.appendChild(item);
    });
  }

  /**
   * Shows a small popover with a URL input field.
   * Calls onSubmit(url) when the user presses Enter or clicks Confirm,
   * and onSubmit(null) if the popover is dismissed without submitting.
   *
   * @param {HTMLElement} anchorEl - Element to position the popover under
   * @param {function(string|null)} onSubmit
   */
  _showUrlPopover(anchorEl, onSubmit) {
    this.tableGrid.close();
    this.urlPopover.open(
      anchorEl,
      (popover) => {
        popover.className = "url-popover";

        const input = document.createElement("input");
        input.type = "url";
        input.className = "url-popover-input";
        input.placeholder = "https://example.com";
        input.value = "https://";

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "url-popover-confirm";
        confirmBtn.textContent = "OK";
        confirmBtn.type = "button";

        const submit = () => {
          const url = input.value.trim();
          this.urlPopover.confirm();
          onSubmit(url || null);
        };

        confirmBtn.addEventListener("click", submit);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") this.urlPopover.close();
        });

        popover.append(input, confirmBtn);
        return input;
      },
      { onCancel: () => onSubmit(null) },
    );
  }

  /**
   * Shows a small image popover with a URL/path field and a native file
   * browser button. Calls onSubmit(imagePath) on confirm and onSubmit(null)
   * when dismissed without submitting.
   */
  _showImagePopover(anchorEl, onSubmit) {
    this.urlPopover.close();
    this.tableGrid.close();
    this.imagePopover.open(
      anchorEl,
      (popover) => {
        popover.className = "image-popover";

        const input = document.createElement("input");
        input.type = "text";
        input.className = "image-popover-input";
        input.placeholder = "Image URL or local path";

        const browseButton = document.createElement("button");
        browseButton.className = "image-popover-browse";
        browseButton.type = "button";
        browseButton.textContent = "Browse";

        const confirmButton = document.createElement("button");
        confirmButton.className = "image-popover-confirm";
        confirmButton.type = "button";
        confirmButton.textContent = "Insert";

        const submit = () => {
          const imagePath = input.value.trim();
          this.imagePopover.confirm();
          onSubmit(imagePath || null);
        };

        browseButton.addEventListener("click", async () => {
          const result = await window.api.chooseImageFile();
          if (result && result.filePath) {
            input.value = result.filePath;
            submit();
            return;
          }
          input.focus();
        });
        confirmButton.addEventListener("click", submit);
        input.addEventListener("keydown", (event) => {
          if (event.key === "Enter") submit();
          if (event.key === "Escape") this.imagePopover.close();
        });

        popover.append(input, browseButton, confirmButton);
        return input;
      },
      { onCancel: () => onSubmit(null) },
    );
  }

  /**
   * Shows a Google Docs-style grid popup for selecting table dimensions.
   * Clicking a cell inserts a markdown table of that size.
   */
  _showTableGrid(event, textarea) {
    event.stopPropagation();

    this.tableGrid.open(event.currentTarget, (popup) => {
      popup.className = "table-grid-popup";
      popup.style.display = "block";

      // Label showing current selection (e.g., "3 × 4")
      const label = document.createElement("div");
      label.className = "table-grid-label";
      label.textContent = "1 × 1";
      popup.appendChild(label);

      // Create 10x10 grid (max table size)
      const grid = document.createElement("div");
      grid.className = "table-grid";
      grid.style.gridTemplateColumns = "repeat(10, 1fr)";

      const cells = [];
      for (let row = 0; row < 10; row++) {
        for (let col = 0; col < 10; col++) {
          const cell = document.createElement("div");
          cell.className = "table-grid-cell";
          cell.dataset.row = row + 1;
          cell.dataset.col = col + 1;

          // Hover: highlight grid and update label
          cell.addEventListener("mouseenter", () => {
            this._highlightGrid(cells, row + 1, col + 1);
            label.textContent = `${row + 1} × ${col + 1}`;
          });

          // Click: insert table
          cell.addEventListener("click", async () => {
            this.tableGrid.close();
            await this._insertTable(textarea, row + 1, col + 1);
          });

          cells.push(cell);
          grid.appendChild(cell);
        }
      }

      popup.appendChild(grid);
      this._highlightGrid(cells, 1, 1);
    });
  }

  /**
   * Highlights grid cells up to the hovered row/col.
   */
  _highlightGrid(cells, maxRow, maxCol) {
    cells.forEach((cell) => {
      const r = parseInt(cell.dataset.row);
      const c = parseInt(cell.dataset.col);
      cell.classList.toggle("highlighted", r <= maxRow && c <= maxCol);
    });
  }

  /**
   * Inserts a markdown table with the given dimensions.
   */
  async _insertTable(textarea, rows, cols) {
    await MarkdownEditing.insertTable(textarea, rows, cols, (target) =>
      this.formatMarkdown(target),
    );
  }
}

// Export for use in other modules
window.Toolbar = Toolbar;
