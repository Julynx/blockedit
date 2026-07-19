# TODO

## Important features

- [x] Search functionality.
- [x] Move the "render block" tick button to the top right corner of the block, so that it sits right above the border line instead of over the text, to avoid covering the text.
- [x] Allow multiple instances of the app
- [x] Dynamic TOC, created on save
- [x] Performance optimizations
- [x] Click and drag to copy multiple blocks or delete them.
- [x] Important: Fix the following bug. When editing very tall blocks that are taller than the window, especially closer to the middle or end of the block, with each keypress, the view scrolls chaotically. It's like the app focuses the top of the block with each keypress, scrolling to it.

## Nice to haves

- [ ] Extra options menu in edit mode, for line wrapping.
  - To the right of the table icon in the toolbar, insert a separator and a vertical three dots button that opens a dropdown.
    - In the dropdown, a single toggle: "Line wrap", with a tick indicating its state. By default, the tick is present (the app keeps wrapping lines as it does now).
      - Remember user setting across the app like the theme.
    - When "Line wrap" is off, a horizontal scrollbar is displayed for blocks in edit mode, and lines are not wrapped. This is useful, for example, to edit markdown pipe tables that are very wide without overflowing.
- [ ] A second toggle for the extra options menu, this toggle is called "Column selection" and is off by default.
  - Same styling as the "Line wrap" option, displaying a tick when it is toggled on and remembered across the app.
  - In column selection mode, dragging the mouse inside the text box in edit mode will select rectangular areas of text across lines, in the same way vscode column selection mode works. This is especially useful to delete a column from a markdown table we no longer need.
