// toolbar.js - Toolbar for Markdown Formatting
// Provides buttons to insert or wrap markdown syntax around selections.
// Includes a Google Docs-style grid popup for table insertion.

// Parsed SVG elements cached by path. The cached original never enters the
// DOM; callers always receive a synchronous clone.
const svgIconCache = new Map();

class Toolbar {
  constructor() {
    this.activePopup = null; // Tracks the currently open table grid popup
  }

  /**
   * Creates a toolbar element and wires up all buttons.
   * @param {HTMLTextAreaElement} textarea - The textarea this toolbar controls
   * @param {function} onDelete - Called when the user deletes the block
   * @returns {HTMLElement} The toolbar DOM element
   */
  createToolbar(textarea, onDelete) {
    const toolbar = document.createElement("div");
    toolbar.className = "block-toolbar";

    // --- Inline formatting ---
    const boldBtn = this._createIconButton("bold", "Bold", () =>
      this._toggleBold(textarea),
    );
    const italicBtn = this._createIconButton("italic", "Italic", () =>
      this._toggleItalic(textarea),
    );
    const codeBtn = this._createIconButton("code", "Inline Code", () =>
      this._toggleInlineCode(textarea),
    );
    const strikethroughBtn = this._createIconButton(
      "strikethrough",
      "Strikethrough",
      () => this._toggleStrikethrough(textarea),
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
      () => this._insertUnorderedList(textarea),
    );
    const checkboxListBtn = this._createIconButton(
      "checkbox-list",
      "Checkboxes",
      () => this._insertCheckboxList(textarea),
    );
    const orderedListBtn = this._createIconButton(
      "ordered-list",
      "Ordered List",
      () => this._insertOrderedList(textarea),
    );
    const indentBtn = this._createIconButton("indent", "Indent", () =>
      this._changeIndent(textarea, 2),
    );
    const dedentBtn = this._createIconButton("dedent", "Dedent", () =>
      this._changeIndent(textarea, -2),
    );
    const quoteBtn = this._createIconButton("quote", "Quote", () =>
      this._prefixCurrentLine(textarea, "> "),
    );
    const fencedCodeBtn = this._createIconButton(
      "fenced-code",
      "Code Block",
      () => this._wrapSelection(textarea, "```language\n", "\n```"),
    );
    const ruleBtn = this._createIconButton("horizontal-rule", "Separator", () =>
      this._insertHorizontalRule(textarea),
    );

    // --- Structured content ---
    const tableBtn = this._createIconButton("table", "Table", (e) =>
      this._showTableGrid(e, textarea),
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

    const iconPath = iconReference.includes("/")
      ? iconReference
      : `icons/${iconReference}.svg`;

    this.loadSvgIcon(iconPath, button);

    button.addEventListener("click", onClick);
    return button;
  }

  /**
   * Loads a local SVG and appends it inline to a container.
   * XHR works with local file:// assets in Electron where fetch() may not.
   */
  loadSvgIcon(iconPath, container) {
    const cached = svgIconCache.get(iconPath);
    if (cached) {
      container.appendChild(cached.cloneNode(true));
      return;
    }

    const request = new XMLHttpRequest();
    request.open("GET", iconPath, true);
    request.onload = () => {
      if (
        request.status !== 0 &&
        (request.status < 200 || request.status >= 300)
      ) {
        console.warn(`Toolbar icon could not be loaded: ${iconPath}`);
        return;
      }

      try {
        const svg = new DOMParser().parseFromString(
          request.responseText,
          "image/svg+xml",
        ).documentElement;

        if (svg.nodeName.toLowerCase() !== "svg") {
          throw new Error("Icon does not contain an SVG root element");
        }

        svg.setAttribute("aria-hidden", "true");
        svg.setAttribute("focusable", "false");
        svgIconCache.set(iconPath, svg);
        container.appendChild(svg.cloneNode(true));
      } catch {
        console.warn(`Toolbar icon could not be loaded: ${iconPath}`);
      }
    };
    request.onerror = () => {
      console.warn(`Toolbar icon could not be loaded: ${iconPath}`);
    };
    request.send();
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
   * Wraps the current selection in markdown markers.
   * If no text is selected, inserts placeholder text and selects it.
   *
   * Example: wrapSelection(textarea, '**', '**') turns "hello" into "**hello**"
   *
   * @param {HTMLTextAreaElement} textarea
   * @param {string} prefix - Markdown to insert before selection
   * @param {string} suffix - Markdown to insert after selection
   */
  _wrapSelection(textarea, prefix, suffix) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    if (selected) {
      // Double-click selection can include a space after the word. Keep all
      // leading/trailing whitespace outside the Markdown markers, otherwise
      // "sentence " would become "**sentence **".
      const trimmed = selected.trim();

      // A whitespace-only selection has no text to format.
      if (!trimmed) {
        textarea.focus();
        return;
      }

      const leadingWhitespaceLength = selected.indexOf(trimmed);
      const trailingWhitespaceLength =
        selected.length - leadingWhitespaceLength - trimmed.length;
      const leadingWhitespace = selected.substring(0, leadingWhitespaceLength);
      const trailingWhitespace = trailingWhitespaceLength
        ? selected.substring(selected.length - trailingWhitespaceLength)
        : "";

      const replacement =
        leadingWhitespace + prefix + trimmed + suffix + trailingWhitespace;
      this._replaceRange(textarea, start, end, replacement);

      // Restore cursor to select the wrapped text (without markers)
      const newStart = start + leadingWhitespace.length + prefix.length;
      const newEnd = newStart + trimmed.length;
      textarea.setSelectionRange(newStart, newEnd);
    } else {
      // No selection: insert placeholder and select it
      const placeholder = "text";
      const replacement = prefix + placeholder + suffix;
      this._replaceRange(textarea, start, end, replacement);

      // Select the placeholder so user can type over it
      const newStart = start + prefix.length;
      const newEnd = newStart + placeholder.length;
      textarea.setSelectionRange(newStart, newEnd);
    }

    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Toggles bold around the current selection.
   *
   * It supports both common selection states:
   *   - The selection includes the markers: **text**
   *   - The markers sit immediately outside the selection: **text**
   */
  _toggleBold(textarea) {
    this._toggleMarker(textarea, "**");
  }

  /**
   * Toggles italic using single underscore Markdown markers.
   */
  _toggleItalic(textarea) {
    this._toggleMarker(textarea, "_");
  }

  /**
   * Toggles inline code using backtick markers.
   */
  _toggleInlineCode(textarea) {
    this._toggleMarker(textarea, "`");
  }

  /**
   * Toggles strikethrough using double-tilde markers.
   */
  _toggleStrikethrough(textarea) {
    this._toggleMarker(textarea, "~~");
  }

  /**
   * Shared toggle behavior for inline Markdown markers.
   */
  _toggleMarker(textarea, marker) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    if (!selected) {
      this._wrapSelection(textarea, marker, marker);
      return;
    }

    // Case 1: the selected text includes the marker at both ends. Preserve any
    // whitespace outside the markers while removing only the markers.
    const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const selectedMatch = selected.match(
      new RegExp(`^(\\s*)${escapedMarker}(.*?)${escapedMarker}(\\s*)$`, "s"),
    );
    if (selectedMatch) {
      const leadingWhitespace = selectedMatch[1];
      const boldText = selectedMatch[2];
      const trailingWhitespace = selectedMatch[3];

      if (boldText.trim()) {
        const replacement = leadingWhitespace + boldText + trailingWhitespace;
        this._replaceRange(textarea, start, end, replacement);

        const newStart = start + leadingWhitespace.length;
        textarea.focus();
        textarea.setSelectionRange(newStart, newStart + boldText.length);
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
        return;
      }
    }

    // Case 2: the selection is inside markers. Account for an accidentally
    // selected trailing space, so a selected "word " is recognized correctly.
    const leadingWhitespaceLength =
      selected.length - selected.trimStart().length;
    const trailingWhitespaceLength =
      selected.length - selected.trimEnd().length;
    const coreStart = start + leadingWhitespaceLength;
    const coreEnd = end - trailingWhitespaceLength;
    const hasOutsideMarkers =
      textarea.value.substring(coreStart - marker.length, coreStart) ===
        marker &&
      textarea.value.substring(coreEnd, coreEnd + marker.length) === marker;

    if (hasOutsideMarkers) {
      const replacementStart = coreStart - marker.length;
      const replacementEnd = coreEnd + marker.length;
      const replacement = selected;
      this._replaceRange(
        textarea,
        replacementStart,
        replacementEnd,
        replacement,
      );

      const newStart = replacementStart + leadingWhitespaceLength;
      textarea.focus();
      textarea.setSelectionRange(newStart, newStart + selected.trim().length);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    this._wrapSelection(textarea, marker, marker);
  }

  /**
   * Adds a Markdown prefix to the line containing the current cursor.
   * This intentionally handles only one line, keeping the button behavior
   * simple as requested.
   */
  _prefixCurrentLine(textarea, prefix) {
    const cursor = textarea.selectionStart;
    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const originalStart = textarea.selectionStart;
    const originalEnd = textarea.selectionEnd;
    const currentLineEnd = textarea.value.indexOf("\n", lineStart);
    const lineEnd =
      currentLineEnd === -1 ? textarea.value.length : currentLineEnd;
    const currentLine = textarea.value.substring(lineStart, lineEnd);
    const actualPrefix =
      prefix === "- " && currentLine.trimStart().startsWith("- ")
        ? "  "
        : prefix;

    this._replaceRange(textarea, lineStart, lineStart, actualPrefix);

    const selectionStart = originalStart + actualPrefix.length;
    const selectionEnd = originalEnd + actualPrefix.length;
    textarea.focus();
    textarea.setSelectionRange(selectionStart, selectionEnd);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Adds an unordered-list marker to the current line. If the line is already
   * a list item, creates the next item beneath it with the same indentation.
   */
  _insertUnorderedList(textarea) {
    const cursor = textarea.selectionStart;
    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEndIndex = textarea.value.indexOf("\n", lineStart);
    const lineEnd = lineEndIndex === -1 ? textarea.value.length : lineEndIndex;
    const line = textarea.value.substring(lineStart, lineEnd);
    const indentation = line.match(/^\s*/)[0];
    const content = line.substring(indentation.length);
    const orderedMarker = content.match(/^(\d+)\. /);

    // Convert an ordered item to an unordered item instead of creating a
    // second line when the two list buttons are used as a toggle.
    if (orderedMarker) {
      const markerPosition = lineStart + indentation.length;
      const oldMarkerLength = orderedMarker[0].length;
      this._replaceRange(
        textarea,
        markerPosition,
        markerPosition + oldMarkerLength,
        "- ",
      );
      this._setCursor(
        textarea,
        cursor >= markerPosition ? cursor + 2 - oldMarkerLength : cursor,
      );
      return;
    }

    if (content.startsWith("- ")) {
      const insertion = `\n${indentation}- `;
      this._replaceRange(textarea, lineEnd, lineEnd, insertion);
      this._setCursor(textarea, lineEnd + insertion.length);
      return;
    }

    // A normal line inherits the indentation of the nearest unordered item
    // above it. Replace the whole current line so its text remains intact.
    const previous = this._findNearestUnorderedList(textarea, lineStart);
    const indentationToUse = previous ? previous.indentation : indentation;
    const replacement = `${indentationToUse}- ${content}`;
    this._replaceRange(textarea, lineStart, lineEnd, replacement);
    const cursorAdjustment = replacement.length - (lineEnd - lineStart);
    this._setCursor(
      textarea,
      cursor >= lineStart ? cursor + cursorAdjustment : cursor,
    );
  }

  /**
   * Adds a checkbox-list marker using the same indentation and continuation
   * behavior as an unordered list.
   */
  _insertCheckboxList(textarea) {
    const cursor = textarea.selectionStart;
    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEndIndex = textarea.value.indexOf("\n", lineStart);
    const lineEnd = lineEndIndex === -1 ? textarea.value.length : lineEndIndex;
    const line = textarea.value.substring(lineStart, lineEnd);
    const indentation = line.match(/^\s*/)[0];
    const content = line.substring(indentation.length);
    const marker = "- [ ] ";
    const placeholderText = "...";
    const orderedMarker = content.match(/^(\d+)\. /);

    if (orderedMarker) {
      const markerPosition = lineStart + indentation.length;
      this._replaceRange(
        textarea,
        markerPosition,
        markerPosition + orderedMarker[0].length,
        marker,
      );
      this._setCursor(
        textarea,
        cursor >= markerPosition
          ? cursor + marker.length - orderedMarker[0].length
          : cursor,
      );
      return;
    }

    if (content.startsWith(marker)) {
      const insertion = `\n${indentation}${marker}${placeholderText}`;
      this._replaceRange(textarea, lineEnd, lineEnd, insertion);
      this._setCursor(textarea, lineEnd + insertion.length);
      return;
    }

    const previous = this._findNearestUnorderedList(textarea, lineStart);
    const indentationToUse = previous ? previous.indentation : indentation;
    const replacement = `${indentationToUse}${marker}${content}`;
    this._replaceRange(textarea, lineStart, lineEnd, replacement);
    const cursorAdjustment = replacement.length - (lineEnd - lineStart);
    this._setCursor(
      textarea,
      cursor >= lineStart ? cursor + cursorAdjustment : cursor,
    );
  }

  /**
   * Adds an ordered-list marker to the current line. The nearest ordered-list
   * item above the cursor determines the next number and indentation.
   */
  _insertOrderedList(textarea) {
    const cursor = textarea.selectionStart;
    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEndIndex = textarea.value.indexOf("\n", lineStart);
    const lineEnd = lineEndIndex === -1 ? textarea.value.length : lineEndIndex;
    const line = textarea.value.substring(lineStart, lineEnd);
    const currentIndentation = line.match(/^\s*/)[0];
    const currentContent = line.substring(currentIndentation.length);
    const currentMarker = currentContent.match(/^(\d+)\. /);
    const unorderedMarker = currentContent.match(/^- /);

    // Convert an unordered item to an ordered item. Use the nearest ordered
    // item above to choose the next number, or start at 1 when none exists.
    if (unorderedMarker) {
      const linesAbove = textarea.value.substring(0, lineStart).split("\n");
      let nextNumber = 1;

      for (let index = linesAbove.length - 1; index >= 0; index -= 1) {
        const match = linesAbove[index].match(/^(\s*)(\d+)\. /);
        if (match) {
          nextNumber = Number(match[2]) + 1;
          break;
        }
      }

      const markerPosition = lineStart + currentIndentation.length;
      const marker = `${nextNumber}. `;
      this._replaceRange(
        textarea,
        markerPosition,
        markerPosition + unorderedMarker[0].length,
        marker,
      );
      this._setCursor(
        textarea,
        cursor >= markerPosition
          ? cursor + marker.length - unorderedMarker[0].length
          : cursor,
      );
      return;
    }

    // Pressing the button on an existing item creates the next item beneath it.
    if (currentMarker) {
      const nextNumber = Number(currentMarker[1]) + 1;
      const insertion = `\n${currentIndentation}${nextNumber}. `;
      this._replaceRange(textarea, lineEnd, lineEnd, insertion);
      this._setCursor(textarea, lineEnd + insertion.length);
      return;
    }

    // Search upward for the nearest ordered item. The current line is not
    // included here because it was already checked above.
    const previous = this._findNearestOrderedList(textarea, lineStart);
    const nextNumber = previous ? previous.number + 1 : 1;
    const discoveredIndentation = previous ? previous.indentation : "";

    // Copy the indentation from the discovered list item onto the current
    // line. For example, a previous "  1. Manzana" makes "Sandía" become
    // "  2. Sandía". Insert at the line start so the marker never lands in
    // the middle of the current text.
    const indentation = previous ? discoveredIndentation : currentIndentation;
    const markerPosition = previous
      ? lineStart
      : lineStart + currentIndentation.length;
    const marker = `${nextNumber}. `;
    const insertion = indentation + marker;
    const replacementEnd = previous
      ? lineStart + currentIndentation.length
      : markerPosition;
    this._replaceRange(textarea, markerPosition, replacementEnd, insertion);
    const cursorAdjustment =
      insertion.length - (replacementEnd - markerPosition);
    this._setCursor(
      textarea,
      cursor >= markerPosition ? cursor + cursorAdjustment : cursor,
    );
  }

  /**
   * Finds the nearest ordered-list marker above the current line.
   */
  _findNearestOrderedList(textarea, lineStart) {
    const linesAbove = textarea.value.substring(0, lineStart).split("\n");

    for (let index = linesAbove.length - 1; index >= 0; index -= 1) {
      const match = linesAbove[index].match(/^(\s*)(\d+)\. /);
      if (match) {
        return {
          number: Number(match[2]),
          indentation: match[1],
        };
      }
    }

    return null;
  }

  /**
   * Finds the nearest unordered-list marker above the current line.
   */
  _findNearestUnorderedList(textarea, lineStart) {
    const linesAbove = textarea.value.substring(0, lineStart).split("\n");

    for (let index = linesAbove.length - 1; index >= 0; index -= 1) {
      const match = linesAbove[index].match(/^(\s*)- /);
      if (match) {
        return { indentation: match[1] };
      }
    }

    return null;
  }

  /**
   * Adds or removes two spaces at the start of the current line.
   */
  _changeIndent(textarea, amount) {
    const cursor = textarea.selectionStart;
    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEndIndex = textarea.value.indexOf("\n", lineStart);
    const lineEnd = lineEndIndex === -1 ? textarea.value.length : lineEndIndex;
    const line = textarea.value.substring(lineStart, lineEnd);
    const previousLineEnd = lineStart - 1;
    const previousLineStart =
      previousLineEnd >= 0
        ? textarea.value.lastIndexOf("\n", previousLineEnd - 1) + 1
        : 0;
    const previousLine =
      previousLineEnd >= 0
        ? textarea.value.substring(previousLineStart, previousLineEnd)
        : "";

    // An item directly below an ordered list item uses three spaces so nested
    // unordered items align with the ordered-list structure.
    const indentWidth = /^\s*\d+\. /.test(previousLine) ? 3 : 2;

    if (amount > 0) {
      this._replaceRange(
        textarea,
        lineStart,
        lineStart,
        " ".repeat(indentWidth),
      );
      this._setCursor(textarea, cursor + indentWidth);
      return;
    }

    const removableSpaces = Math.min(
      indentWidth,
      (line.match(/^ */) || [""])[0].length,
    );

    if (removableSpaces > 0) {
      this._replaceRange(textarea, lineStart, lineStart + removableSpaces, "");
      this._setCursor(textarea, Math.max(lineStart, cursor - removableSpaces));
    } else {
      this._setCursor(textarea, cursor);
    }
  }

  /**
   * Inserts a Markdown horizontal rule on the line below the current line,
   * followed by a newline so the next line is empty and ready to edit.
   */
  _insertHorizontalRule(textarea) {
    const cursor = textarea.selectionStart;
    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEndIndex = textarea.value.indexOf("\n", lineStart);
    const lineEnd = lineEndIndex === -1 ? textarea.value.length : lineEndIndex;
    const insertion = "\n\n---\n\n";

    this._replaceRange(textarea, lineEnd, lineEnd, insertion);
    this._setCursor(textarea, lineEnd + insertion.length);
  }

  _setCursor(textarea, position) {
    textarea.focus();
    textarea.setSelectionRange(position, position);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Inserts plain text at the current selection or cursor.
   */
  _insertText(textarea, text) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    this._replaceRange(textarea, start, end, text);

    const cursor = start + text.length;
    textarea.focus();
    textarea.setSelectionRange(cursor, cursor);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Formats the current block's Markdown with Prettier.
   * This method is shared by the manual Format button, table insertion,
   * and the edit-to-render transition.
   */
  async _formatText(event, textarea) {
    event.preventDefault();

    // Capture currentTarget before awaiting. Event.currentTarget can become
    // null after the event handler has yielded.
    const button = event.currentTarget;
    await this.formatMarkdown(textarea, button);
  }

  /**
   * Formats a textarea's Markdown through the secure main-process API.
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
      document.dispatchEvent(
        new CustomEvent("editor-status", {
          detail: { message: "Formatting failed", isError: true },
        }),
      );
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
      this._replaceRange(textarea, start, end, linkMarkdown);

      // Place cursor after the inserted link
      const cursorPos = start + linkMarkdown.length;
      textarea.setSelectionRange(cursorPos, cursorPos);
      textarea.focus();
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
      this._replaceRange(textarea, start, end, imageMarkdown);

      const cursor = start + imageMarkdown.length;
      textarea.focus();
      textarea.setSelectionRange(cursor, cursor);
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
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
    this._closeHeaderMenu();

    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();
    const menu = document.createElement("div");
    menu.className = "header-menu";
    menu.style.left = `${rect.left}px`;
    menu.style.top = `${rect.bottom + 8}px`;

    for (let level = 1; level <= 6; level += 1) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "header-menu-item";
      item.textContent = `H${level}`;
      item.setAttribute("aria-label", `Insert heading level ${level}`);
      item.addEventListener("click", () => {
        this._closeHeaderMenu();
        this._prefixCurrentLine(textarea, `${"#".repeat(level)} `);
      });
      menu.appendChild(item);
    }

    menu.addEventListener("click", (menuEvent) => menuEvent.stopPropagation());
    document.body.appendChild(menu);
    this.activeHeaderMenu = menu;

    setTimeout(() => {
      this._closeHeaderMenuBound = () => this._closeHeaderMenu();
      document.addEventListener("click", this._closeHeaderMenuBound, {
        once: true,
      });
    }, 0);
  }

  _closeHeaderMenu() {
    if (this.activeHeaderMenu) {
      this.activeHeaderMenu.remove();
      this.activeHeaderMenu = null;
    }
    if (this._closeHeaderMenuBound) {
      document.removeEventListener("click", this._closeHeaderMenuBound);
      this._closeHeaderMenuBound = null;
    }
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
    this._closeUrlPopover();
    this._closeTableGrid();

    const rect = anchorEl.getBoundingClientRect();

    const popover = document.createElement("div");
    popover.className = "url-popover";
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 8}px`;

    const input = document.createElement("input");
    input.type = "url";
    input.className = "url-popover-input";
    input.placeholder = "https://example.com";
    input.value = "https://";

    const confirmBtn = document.createElement("button");
    confirmBtn.className = "url-popover-confirm";
    confirmBtn.textContent = "OK";
    confirmBtn.type = "button";

    let submitted = false;
    const submit = () => {
      submitted = true;
      const url = input.value.trim();
      this._closeUrlPopover();
      onSubmit(url || null);
    };

    confirmBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") submit();
      if (e.key === "Escape") this._closeUrlPopover();
    });
    // Prevent clicks inside the popover from closing it via the document handler
    popover.addEventListener("click", (e) => e.stopPropagation());

    popover.append(input, confirmBtn);
    document.body.appendChild(popover);
    this.activeUrlPopover = {
      element: popover,
      onSubmit,
      getSubmitted: () => submitted,
    };

    // Clicking anywhere else dismisses the popover (treated as cancel)
    setTimeout(() => {
      this._closeUrlPopoverBound = () => this._closeUrlPopover();
      document.addEventListener("click", this._closeUrlPopoverBound, {
        once: true,
      });
    }, 0);

    input.focus();
  }

  /**
   * Closes the URL popover if open. If it was never submitted,
   * notifies the callback with null (cancelled).
   */
  _closeUrlPopover() {
    const popover = this.activeUrlPopover;
    if (popover) {
      popover.element.remove();
      if (!popover.getSubmitted() && popover.onSubmit) {
        popover.onSubmit(null);
      }
      this.activeUrlPopover = null;
    }
    if (this._closeUrlPopoverBound) {
      document.removeEventListener("click", this._closeUrlPopoverBound);
      this._closeUrlPopoverBound = null;
    }
  }

  /**
   * Shows a small image popover with a URL/path field and a native file
   * browser button.
   */
  _showImagePopover(anchorEl, onSubmit) {
    this._closeImagePopover();
    this._closeUrlPopover();
    this._closeTableGrid();

    const rect = anchorEl.getBoundingClientRect();
    const popover = document.createElement("div");
    popover.className = "image-popover";
    popover.style.left = `${rect.left}px`;
    popover.style.top = `${rect.bottom + 8}px`;

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

    let submitted = false;
    const submit = () => {
      submitted = true;
      const imagePath = input.value.trim();
      this._closeImagePopover();
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
      if (event.key === "Enter") {
        submit();
      }
      if (event.key === "Escape") this._closeImagePopover();
    });
    popover.addEventListener("click", (event) => event.stopPropagation());

    popover.append(input, browseButton, confirmButton);
    document.body.appendChild(popover);
    this.activeImagePopover = {
      element: popover,
      onSubmit,
      getSubmitted: () => submitted,
    };

    setTimeout(() => {
      this._closeImagePopoverBound = () => this._closeImagePopover();
      document.addEventListener("click", this._closeImagePopoverBound, {
        once: true,
      });
    }, 0);

    input.focus();
  }

  /**
   * Closes the image popover and treats an outside click as cancellation.
   */
  _closeImagePopover() {
    const popover = this.activeImagePopover;
    if (popover) {
      popover.element.remove();
      if (!popover.getSubmitted() && popover.onSubmit) {
        popover.onSubmit(null);
      }
      this.activeImagePopover = null;
    }
    if (this._closeImagePopoverBound) {
      document.removeEventListener("click", this._closeImagePopoverBound);
      this._closeImagePopoverBound = null;
    }
  }

  /**
   * Shows a Google Docs-style grid popup for selecting table dimensions.
   * Clicking a cell inserts a markdown table of that size.
   */
  _showTableGrid(event, textarea) {
    event.stopPropagation();

    // Close any existing popup
    this._closeTableGrid();

    const button = event.currentTarget;
    const rect = button.getBoundingClientRect();

    // Create popup container
    const popup = document.createElement("div");
    popup.className = "table-grid-popup";
    popup.style.display = "block";
    popup.style.left = `${rect.left}px`;
    popup.style.top = `${rect.bottom + 8}px`;

    // Keep clicks inside the grid from looking like clicks outside the block.
    // The cell handler closes the popup after inserting the table.
    popup.addEventListener("click", (e) => e.stopPropagation());

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
          this._closeTableGrid();
          await this._insertTable(textarea, row + 1, col + 1);
        });

        cells.push(cell);
        grid.appendChild(cell);
      }
    }

    popup.appendChild(grid);
    this._highlightGrid(cells, 1, 1);
    document.body.appendChild(popup);
    this.activePopup = popup;

    // Close popup when clicking outside
    setTimeout(() => {
      document.addEventListener(
        "click",
        (this._closeTableGridBound = () => this._closeTableGrid()),
        { once: true },
      );
    }, 0);
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
    const start = textarea.selectionStart;

    // Build header row
    const headers = Array(cols)
      .fill("Header")
      .map((h, i) => `${h} ${i + 1}`);
    const headerRow = "| " + headers.join(" | ") + " |";

    // Build separator row
    const separatorRow = "|" + Array(cols).fill("---").join("|") + "|";

    // Build data rows
    const dataRows = [];
    for (let r = 0; r < rows - 1; r++) {
      const cells = Array(cols).fill("Cell");
      dataRows.push("| " + cells.join(" | ") + " |");
    }

    const tableMarkdown =
      "\n" +
      headerRow +
      "\n" +
      separatorRow +
      "\n" +
      dataRows.join("\n") +
      "\n";

    // Insert at cursor
    this._replaceRange(textarea, start, start, tableMarkdown);

    // Focus and trigger input event
    textarea.focus();
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    // Keep inserted tables consistent with the rest of the block content.
    await this.formatMarkdown(textarea);
  }

  /**
   * Closes the table grid popup if open.
   */
  _closeTableGrid() {
    if (this.activePopup) {
      this.activePopup.remove();
      this.activePopup = null;
    }
    if (this._closeTableGridBound) {
      document.removeEventListener("click", this._closeTableGridBound);
      this._closeTableGridBound = null;
    }
  }

  /**
   * Replaces a range of text in a textarea and updates its value.
   * This preserves undo history better than direct value manipulation.
   */
  _replaceRange(textarea, start, end, replacement) {
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + replacement + after;
  }
}

// Export for use in other modules
window.Toolbar = Toolbar;
