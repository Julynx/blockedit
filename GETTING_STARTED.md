# Getting Started with Markdown Blocks

A block-based markdown editor built with Electron, inspired by Jupyter notebooks.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Running the App](#running-the-app)
4. [Building an Installer (EXE)](#building-an-installer-exe)
5. [Project Structure & Module Guide](#project-structure--module-guide)

---

## Prerequisites

Before you begin, make sure you have the following installed:

- **Node.js** (version 18 or higher) — [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)

You can verify your installation by opening a terminal and running:

```bash
node --version
npm --version
```

---

## Installation

1. **Navigate to the project folder:**

```bash
cd blockedit
```

1. **Install dependencies:**

```bash
   npm install
   ```

This installs:

- `electron` — the desktop app framework
- `electron-builder` — tool for creating installers
- `marked` — markdown-to-HTML converter
- `dompurify` — sanitizes rendered HTML to prevent script injection
- `highlight.js` — syntax highlighting for fenced code blocks
- `diff` — history checkpoint generation for undo and redo
- `prettier` — Markdown formatting

---

## Running the App

### Development Mode

To start the app in development mode (with hot-reload-like behavior for renderer files):

```bash
npm start
```

This launches the Electron window. You can edit files in the `renderer/` folder and refresh the app (`Ctrl+R` or `Cmd+R`) to see changes.

### Tips for Development

- **Open DevTools:** Press `F12` or `Ctrl+Shift+I`. They open automatically when running the app with `npm start`, but remain closed in packaged builds.
- **Debugging:** Check the terminal where you ran `npm start` for main-process logs. Use DevTools Console for renderer logs.
- **Keyboard shortcuts:** `Ctrl+S`/`Cmd+S` save · `Ctrl+Z`/`Cmd+Z` use native textarea undo while editing and document undo elsewhere · `Ctrl+Shift+Z`/`Cmd+Shift+Z` redo · `Shift+Enter` inside a block renders it.

---

## Building an Installer (EXE)

To create a Windows installer (`.exe`):

```bash
npm run dist
```

This will:

1. Package the app using `electron-builder`
2. Create a `dist/` folder
3. Generate `Markdown Blocks Setup x.x.x.exe` inside it

### What the Build Does

- **App ID:** `com.markdownblocks.app` (used by Windows to identify the app)
- **Target:** NSIS installer (allows users to choose install directory)
- **Files included:** Only `main.js`, `preload.js`, and everything in `renderer/`

### Distributing the App

The generated `.exe` is a self-contained installer. Users can run it and install the app like any other Windows program.

---

## Project Structure & Module Guide

```
blockedit/
├── main.js                  # Electron Main Process
├── preload.js               # Secure IPC Bridge
├── package.json             # Dependencies & Build Config
├── GETTING_STARTED.md       # This file
└── renderer/                # All UI code runs here
    ├── index.html           # Main window layout
    ├── styles.css           # All styles (plain CSS, no frameworks)
    ├── app.js               # Entry point: wires everything together
    ├── blockManager.js      # Block creation, editing, rendering
    ├── markdownConverter.js # Markdown → sanitized HTML
    ├── fileManager.js       # File open/save/new, committed history
    └── toolbar.js           # Markdown formatting and insertion buttons
```

### Module Descriptions

| Module                     | What It Does                                                                                                                                                                                                                                                                               |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **`main.js`**              | Runs in Node.js. Creates the app window, handles file dialogs, reads/writes files on disk. Exposes IPC handlers that the renderer can call.                                                                                                                                                |
| **`preload.js`**           | Runs before the page loads. Creates a secure bridge (`window.api`) so the renderer can ask the main process to do file operations or open web links without direct access to Node.js.                                                                                                      |
| **`app.js`**               | Runs when the page loads. Creates instances of `BlockManager` and `FileManager`, wires them together.                                                                                                                                                                                      |
| **`blockManager.js`**      | Core logic for blocks. Handles:<br>• Creating/removing blocks<br>• Switching between edit mode (textarea) and render mode (HTML)<br>• Hover UI (shadow, plus buttons)<br>• Serializing blocks to markdown and parsing them back                                                            |
| **`markdownConverter.js`** | Single responsibility: converts Markdown to **sanitized** HTML.<br>Uses `marked` for conversion, Highlight.js for fenced-code syntax highlighting, and `DOMPurify` for sanitization (required — `marked` does not sanitize, and raw HTML could otherwise execute scripts inside Electron). |
| **`fileManager.js`**       | Handles file operations:<br>• New / Open / Save buttons<br>• Commit-time persistence<br>• Close and unsaved-changes prompts<br>• Save status and errors<br>• Tracks the current file path and dirty state                                                                                  |
| **`toolbar.js`**           | Creates the formatting toolbar under each block in edit mode.<br>Includes SVG-backed formatting buttons and the Google Docs-style grid popup for inserting tables.                                                                                                                         |
| **`styles.css`**           | All visual styling. Uses CSS variables for easy theming. No frameworks — everything is hand-written and readable.                                                                                                                                                                          |

Rendered HTTP and HTTPS links are opened through Electron's `shell.openExternal()` in `main.js`, so they use the operating system's default browser instead of navigating the editor window.

Markdown formatting is centralized in `Toolbar.formatMarkdown()`. Table insertion and switching an edit block to render mode use that method, which calls Prettier through the secure `preload.js`/`main.js` IPC bridge.

The toolbar insertion buttons provide intentionally simple Markdown actions:

- Unordered list: copies indentation from the nearest `-` item above when adding a marker to a normal line, creates the next equally indented list item when pressed on an existing unordered item, or converts an ordered item to unordered
- Ordered list: searches upward for the nearest `N.` item and inserts `N + 1`; starts at `1.` when no ordered item is found, or converts an unordered item to ordered
- Indent / dedent: adds or removes two spaces at the current line's start
- Block quote: adds `>` to the current line
- Fenced code: wraps the current selection in triple backticks
- Strikethrough: wraps the current selection in `~~`
- Image: inserts `![alt text](...)` from a typed URL or browsed image path; local paths are stored as lightweight `file:///...` URLs rather than base64 data
- Horizontal rule: inserts `---` on the line below the current line and leaves a new empty line after it

### Adding Toolbar Icons

Toolbar SVG assets live in `renderer/icons/`. The toolbar accepts either a short icon name or a relative path:

```javascript
this._createIconButton("bold", "Bold", onClick);
// Loads renderer/icons/bold.svg

this._createIconButton("icons/my-custom-icon.svg", "Custom action", onClick);
// Loads the specified relative path
```

To add an icon, place an SVG file in `renderer/icons/` and pass its filename without the `.svg` extension. The build includes everything under `renderer/`, so no package installation is needed for custom icons.

### Data Flow Example

When you type in a block:

1. `blockManager.js` captures the input event
2. It marks the document dirty while the block remains in edit mode
3. Clicking outside the block formats and commits the block
4. The commit creates a history checkpoint and calls `blockManager.serialize()`
5. It calls `window.api.saveFile()` (from `preload.js`)
6. `preload.js` sends an IPC message to `main.js`
7. `main.js` writes the file atomically using Node.js `fs`

---

## Block File Format

- **Block storage:** Documents are kept as Markdown blocks separated by blank lines. Fenced code blocks remain intact even when they contain blank lines.
- **Committed blocks:** Committing a changed block formats it, splits it on blank lines when necessary, creates a history checkpoint, and persists the document.
- **Markdown and HTML:** The section tags are intentional application metadata; HTML is valid inside Markdown and lets the editor preserve draggable block boundaries.
- **Formatting:** Leaving an edit block formats its Markdown with Prettier before rendering and saving.
- **Safety:** The editor sanitizes rendered HTML and only opens HTTP/HTTPS links externally.
- **Customize styles:** Edit `styles.css` — all colors are in CSS variables at the top.

Happy editing!
