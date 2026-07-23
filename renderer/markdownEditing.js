// markdownEditing.js - Textarea Markdown Editing Operations
// Text-manipulation helpers used by the toolbar. Each operation edits the
// textarea value, restores a sensible selection, and dispatches an "input"
// event so auto-resize, dirty tracking, and search react to programmatic
// edits exactly as they react to typing.

const MarkdownEditing = (() => {
  /**
   * Returns the boundaries and parts of the line containing the cursor.
   */
  function getLineContext(textarea) {
    const cursor = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = textarea.value.lastIndexOf("\n", cursor - 1) + 1;
    const lineEndIndex = textarea.value.indexOf("\n", lineStart);
    const lineEnd = lineEndIndex === -1 ? textarea.value.length : lineEndIndex;
    const line = textarea.value.substring(lineStart, lineEnd);
    const indentation = line.match(/^\s*/)[0];
    const content = line.substring(indentation.length);
    return {
      cursor,
      selectionEnd,
      lineStart,
      lineEnd,
      line,
      indentation,
      content,
    };
  }

  /**
   * Replaces a range of text in a textarea and updates its value.
   * This preserves undo history better than direct value manipulation.
   */
  function replaceRange(textarea, start, end, replacement) {
    const before = textarea.value.substring(0, start);
    const after = textarea.value.substring(end);
    textarea.value = before + replacement + after;
  }

  /**
   * Focuses the textarea, restores the selection when given, and dispatches
   * an "input" event so listeners (auto-resize, dirty state, search) react
   * to the programmatic edit exactly as they react to typing.
   */
  function commitEdit(textarea, selectionStart, selectionEnd) {
    textarea.focus();
    if (selectionStart !== undefined) {
      textarea.setSelectionRange(
        selectionStart,
        selectionEnd ?? selectionStart,
      );
    }
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  /**
   * Places the cursor at a single position after an edit.
   */
  function setCursor(textarea, position) {
    commitEdit(textarea, position, position);
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
  function wrapSelection(textarea, prefix, suffix) {
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
      replaceRange(textarea, start, end, replacement);

      // Restore cursor to select the wrapped text (without markers)
      const newStart = start + leadingWhitespace.length + prefix.length;
      commitEdit(textarea, newStart, newStart + trimmed.length);
      return;
    }

    // No selection: insert a placeholder and select it so the user can
    // type over it.
    const placeholder = "text";
    const replacement = prefix + placeholder + suffix;
    replaceRange(textarea, start, end, replacement);
    const newStart = start + prefix.length;
    commitEdit(textarea, newStart, newStart + placeholder.length);
  }

  /**
   * Shared toggle behavior for inline Markdown markers (bold, italic,
   * inline code, strikethrough).
   *
   * Supports both common selection states:
   *   - The selection includes the markers: **text**
   *   - The markers sit immediately outside the selection: **text**
   */
  function toggleMarker(textarea, marker) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.substring(start, end);

    if (!selected) {
      wrapSelection(textarea, marker, marker);
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
      const innerText = selectedMatch[2];
      const trailingWhitespace = selectedMatch[3];

      if (innerText.trim()) {
        const replacement = leadingWhitespace + innerText + trailingWhitespace;
        replaceRange(textarea, start, end, replacement);

        const newStart = start + leadingWhitespace.length;
        commitEdit(textarea, newStart, newStart + innerText.length);
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
      replaceRange(textarea, replacementStart, replacementEnd, selected);

      const newStart = replacementStart + leadingWhitespaceLength;
      commitEdit(textarea, newStart, newStart + selected.trim().length);
      return;
    }

    wrapSelection(textarea, marker, marker);
  }

  /**
   * Adds a Markdown prefix to the line containing the current cursor.
   * This intentionally handles only one line, keeping the button behavior
   * simple as requested.
   */
  function prefixCurrentLine(textarea, prefix) {
    const { cursor, selectionEnd, lineStart, line } = getLineContext(textarea);
    const actualPrefix =
      prefix === "- " && line.trimStart().startsWith("- ") ? "  " : prefix;

    replaceRange(textarea, lineStart, lineStart, actualPrefix);

    commitEdit(
      textarea,
      cursor + actualPrefix.length,
      selectionEnd + actualPrefix.length,
    );
  }

  /**
   * Adds an unordered-list marker to the current line. If the line is already
   * a list item, creates the next item beneath it with the same indentation.
   */
  function insertUnorderedList(textarea) {
    const { cursor, lineStart, lineEnd, indentation, content } =
      getLineContext(textarea);
    const orderedMarker = content.match(/^(\d+)\. /);

    // Convert an ordered item to an unordered item instead of creating a
    // second line when the two list buttons are used as a toggle.
    if (orderedMarker) {
      const markerPosition = lineStart + indentation.length;
      const oldMarkerLength = orderedMarker[0].length;
      replaceRange(
        textarea,
        markerPosition,
        markerPosition + oldMarkerLength,
        "- ",
      );
      setCursor(
        textarea,
        cursor >= markerPosition ? cursor + 2 - oldMarkerLength : cursor,
      );
      return;
    }

    if (content.startsWith("- ")) {
      const insertion = `\n${indentation}- `;
      replaceRange(textarea, lineEnd, lineEnd, insertion);
      setCursor(textarea, lineEnd + insertion.length);
      return;
    }

    // A normal line inherits the indentation of the nearest unordered item
    // above it. Replace the whole current line so its text remains intact.
    const previous = findNearestUnorderedList(textarea, lineStart);
    const indentationToUse = previous ? previous.indentation : indentation;
    const replacement = `${indentationToUse}- ${content}`;
    replaceRange(textarea, lineStart, lineEnd, replacement);
    const cursorAdjustment = replacement.length - (lineEnd - lineStart);
    setCursor(
      textarea,
      cursor >= lineStart ? cursor + cursorAdjustment : cursor,
    );
  }

  /**
   * Adds a checkbox-list marker using the same indentation and continuation
   * behavior as an unordered list.
   */
  function insertCheckboxList(textarea) {
    const { cursor, lineStart, lineEnd, indentation, content } =
      getLineContext(textarea);
    const marker = "- [ ] ";
    const placeholderText = "...";
    const orderedMarker = content.match(/^(\d+)\. /);

    if (orderedMarker) {
      const markerPosition = lineStart + indentation.length;
      replaceRange(
        textarea,
        markerPosition,
        markerPosition + orderedMarker[0].length,
        marker,
      );
      setCursor(
        textarea,
        cursor >= markerPosition
          ? cursor + marker.length - orderedMarker[0].length
          : cursor,
      );
      return;
    }

    if (content.startsWith(marker)) {
      const insertion = `\n${indentation}${marker}${placeholderText}`;
      replaceRange(textarea, lineEnd, lineEnd, insertion);
      setCursor(textarea, lineEnd + insertion.length);
      return;
    }

    const previous = findNearestUnorderedList(textarea, lineStart);
    const indentationToUse = previous ? previous.indentation : indentation;
    const replacement = `${indentationToUse}${marker}${content}`;
    replaceRange(textarea, lineStart, lineEnd, replacement);
    const cursorAdjustment = replacement.length - (lineEnd - lineStart);
    setCursor(
      textarea,
      cursor >= lineStart ? cursor + cursorAdjustment : cursor,
    );
  }

  /**
   * Adds an ordered-list marker to the current line. The nearest ordered-list
   * item above the cursor determines the next number and indentation.
   */
  function insertOrderedList(textarea) {
    const { cursor, lineStart, lineEnd, indentation, content } =
      getLineContext(textarea);
    const currentMarker = content.match(/^(\d+)\. /);
    const unorderedMarker = content.match(/^- /);

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

      const markerPosition = lineStart + indentation.length;
      const marker = `${nextNumber}. `;
      replaceRange(
        textarea,
        markerPosition,
        markerPosition + unorderedMarker[0].length,
        marker,
      );
      setCursor(
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
      const insertion = `\n${indentation}${nextNumber}. `;
      replaceRange(textarea, lineEnd, lineEnd, insertion);
      setCursor(textarea, lineEnd + insertion.length);
      return;
    }

    // Search upward for the nearest ordered item. The current line is not
    // included here because it was already checked above.
    const previous = findNearestOrderedList(textarea, lineStart);
    const nextNumber = previous ? previous.number + 1 : 1;
    const discoveredIndentation = previous ? previous.indentation : "";

    // Copy the indentation from the discovered list item onto the current
    // line. For example, a previous "  1. Manzana" makes "Sandía" become
    // "  2. Sandía". Insert at the line start so the marker never lands in
    // the middle of the current text.
    const markerPosition = previous
      ? lineStart
      : lineStart + indentation.length;
    const marker = `${nextNumber}. `;
    const insertion = (previous ? discoveredIndentation : indentation) + marker;
    const replacementEnd = previous
      ? lineStart + indentation.length
      : markerPosition;
    replaceRange(textarea, markerPosition, replacementEnd, insertion);
    const cursorAdjustment =
      insertion.length - (replacementEnd - markerPosition);
    setCursor(
      textarea,
      cursor >= markerPosition ? cursor + cursorAdjustment : cursor,
    );
  }

  /**
   * Finds the nearest ordered-list marker above the current line.
   */
  function findNearestOrderedList(textarea, lineStart) {
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
  function findNearestUnorderedList(textarea, lineStart) {
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
   * Adds or removes spaces at the start of the current line.
   */
  function changeIndent(textarea, amount) {
    const { cursor, lineStart, line } = getLineContext(textarea);
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
      replaceRange(textarea, lineStart, lineStart, " ".repeat(indentWidth));
      setCursor(textarea, cursor + indentWidth);
      return;
    }

    const removableSpaces = Math.min(
      indentWidth,
      (line.match(/^ */) || [""])[0].length,
    );

    if (removableSpaces > 0) {
      replaceRange(textarea, lineStart, lineStart + removableSpaces, "");
      setCursor(textarea, Math.max(lineStart, cursor - removableSpaces));
    } else {
      setCursor(textarea, cursor);
    }
  }

  /**
   * Inserts a Markdown horizontal rule on the line below the current line,
   * followed by a newline so the next line is empty and ready to edit.
   */
  function insertHorizontalRule(textarea) {
    const { lineEnd } = getLineContext(textarea);
    const insertion = "\n\n---\n\n";

    replaceRange(textarea, lineEnd, lineEnd, insertion);
    setCursor(textarea, lineEnd + insertion.length);
  }

  /**
   * Inserts a markdown table with the given dimensions, then formats the
   * whole block so the inserted table matches the rest of the content.
   *
   * @param {HTMLTextAreaElement} textarea
   * @param {number} rows
   * @param {number} cols
   * @param {function(HTMLTextAreaElement): Promise} formatMarkdown - The
   *   toolbar's Prettier-based formatter
   */
  async function insertTable(textarea, rows, cols, formatMarkdown) {
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

    // Insert at cursor, then notify listeners (focus + input event)
    replaceRange(textarea, start, start, tableMarkdown);
    commitEdit(textarea);

    // Keep inserted tables consistent with the rest of the block content.
    await formatMarkdown(textarea);
  }

  return {
    wrapSelection,
    toggleMarker,
    prefixCurrentLine,
    insertUnorderedList,
    insertCheckboxList,
    insertOrderedList,
    changeIndent,
    insertHorizontalRule,
    insertTable,
    replaceRange,
    setCursor,
  };
})();

// Export for use in other modules
window.MarkdownEditing = MarkdownEditing;
