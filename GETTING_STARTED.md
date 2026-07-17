# Getting Started with Markdown Blocks

A block-based markdown editor built with Electron, inspired by Jupyter notebooks.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Running the App](#running-the-app)
4. [Building an Installer (EXE)](#building-an-installer-exe)
5. [Project Structure & Module Guide](#project-structure--module-guide)
6. [How to Transition to a REST API for Markdown Conversion](#how-to-transition-to-a-rest-api-for-markdown-conversion)

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
   cd markdown-blocks
   ```

2. **Install dependencies:**

   ```bash
   npm install
   ```

   This installs:
   - `electron` — the desktop app framework
   - `electron-builder` — tool for creating installers
   - `marked` — markdown-to-HTML converter
   - `dompurify` — sanitizes rendered HTML to prevent script injection

---

## Running the App

### Development Mode

To start the app in development mode (with hot-reload-like behavior for renderer files):

```bash
npm start
```

This launches the Electron window. You can edit files in the `renderer/` folder and refresh the app (`Ctrl+R` or `Cmd+R`) to see changes.

### Tips for Development

- **Open DevTools:** Press `F12` or `Ctrl+Shift+I` (uncomment the `openDevTools()` line in `main.js` for auto-open).
- **Debugging:** Check the terminal where you ran `npm start` for main-process logs. Use DevTools Console for renderer logs.
- **Keyboard shortcuts:** `Ctrl+S` save · `Shift+Enter` inside a block renders it (plain `Enter` is a normal newline).

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
markdown-blocks/
├── main.js                  # Electron Main Process
├── preload.js               # Secure IPC Bridge
├── package.json             # Dependencies & Build Config
├── GETTING_STARTED.md       # This file
└── renderer/                # All UI code runs here
    ├── index.html           # Main window layout
    ├── styles.css           # All styles (plain CSS, no frameworks)
    ├── app.js               # Entry point: wires everything together
    ├── blockManager.js      # Block creation, editing, rendering
    ├── markdownConverter.js # Markdown → HTML (swappable for API)
    ├── fileManager.js       # File open/save/new, autosave
    └── toolbar.js           # Markdown formatting and insertion buttons
```

### Module Descriptions

| Module | What It Does |
|--------|-------------|
| **`main.js`** | Runs in Node.js. Creates the app window, handles file dialogs, reads/writes files on disk. Exposes IPC handlers that the renderer can call. |
| **`preload.js`** | Runs before the page loads. Creates a secure bridge (`window.api`) so the renderer can ask the main process to do file operations or open web links without direct access to Node.js. |
| **`app.js`** | Runs when the page loads. Creates instances of `BlockManager` and `FileManager`, wires them together. |
| **`blockManager.js`** | Core logic for blocks. Handles:<br>• Creating/removing blocks<br>• Switching between edit mode (textarea) and render mode (HTML)<br>• Hover UI (shadow, plus buttons)<br>• Serializing blocks to markdown and parsing them back |
| **`markdownConverter.js`** | Single responsibility: converts markdown string → **sanitized** HTML string.<br>Uses `marked` for conversion and `DOMPurify` for sanitization (required — `marked` does not sanitize, and raw HTML could otherwise execute scripts inside Electron).<br>Designed to be replaced with a `fetch()` call to an API. |
| **`fileManager.js`** | Handles file operations:<br>• New / Open / Save buttons<br>• Autosave (1 second after you stop typing)<br>• "Unsaved changes" prompts<br>• Tracks the current file path and dirty state |
| **`toolbar.js`** | Creates the formatting toolbar under each block in edit mode.<br>Includes SVG-backed formatting buttons and the Google Docs-style grid popup for inserting tables. |
| **`styles.css`** | All visual styling. Uses CSS variables for easy theming. No frameworks — everything is hand-written and readable. |

Rendered HTTP and HTTPS links are opened through Electron's `shell.openExternal()` in `main.js`, so they use the operating system's default browser instead of navigating the editor window.

Markdown formatting is centralized in `Toolbar.formatMarkdown()`. Table insertion and switching an edit block to render mode use that method, which calls Prettier through the secure `preload.js`/`main.js` IPC bridge.

The toolbar insertion buttons provide intentionally simple Markdown actions:

- Unordered list: copies indentation from the nearest `- ` item above when adding a marker to a normal line, creates the next equally indented list item when pressed on an existing unordered item, or converts an ordered item to unordered
- Ordered list: searches upward for the nearest `N. ` item and inserts `N + 1`; starts at `1. ` when no ordered item is found, or converts an unordered item to ordered
- Indent / dedent: adds or removes two spaces at the current line's start
- Block quote: adds `> ` to the current line
- Fenced code: wraps the current selection in triple backticks
- Strikethrough: wraps the current selection in `~~`
- Image: inserts `![alt text](...)` from a typed URL or browsed image path; local paths are stored as lightweight `file:///...` URLs rather than base64 data
- Horizontal rule: inserts `---` on the line below the current line and leaves a new empty line after it

### Adding Toolbar Icons

Toolbar SVG assets live in `renderer/icons/`. The toolbar accepts either a short icon name or a relative path:

```javascript
this._createIconButton('bold', 'Bold', onClick);
// Loads renderer/icons/bold.svg

this._createIconButton('icons/my-custom-icon.svg', 'Custom action', onClick);
// Loads the specified relative path
```

To add an icon, place an SVG file in `renderer/icons/` and pass its filename without the `.svg` extension. The build includes everything under `renderer/`, so no package installation is needed for custom icons.

### Data Flow Example

When you type in a block:

1. `blockManager.js` captures the input event
2. It calls `_notifyChange()` which triggers `fileManager.js`'s autosave timer
3. After 1 second of no typing, `fileManager.autosave()` runs
4. It calls `blockManager.serialize()` to get markdown text
5. It calls `window.api.saveFile()` (from `preload.js`)
6. `preload.js` sends an IPC message to `main.js`
7. `main.js` writes the file to disk using Node.js `fs`

---

## How to Transition to a REST API for Markdown Conversion

The app is designed so you can swap local markdown conversion for a remote API with minimal changes.

### Current Setup

In `renderer/markdownConverter.js`:

```javascript
async function convertMarkdownToHtml(markdown) {
  const html = marked.parse(markdown);
  return html;
}
```

### Future API Setup

Replace the function body with a `fetch()` call:

```javascript
async function convertMarkdownToHtml(markdown) {
  const response = await fetch('http://localhost:3000/api/convert', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown })
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

   const html = await response.text(); // or .json() if your API returns JSON
   return sanitizeHtml(html); // keep sanitizing even when the HTML comes from your own API
}
```

### What You Need to Do

1. **Set up your API endpoint** (e.g., `POST /api/convert`) that accepts `{ markdown: string }` and returns HTML.
2. **Update the URL** in `markdownConverter.js` to point to your endpoint.
3. **Keep the `sanitizeHtml()` call** — treat API output as untrusted, especially if others can use your endpoint.
4. **Optional:** Remove `marked` from `package.json` if you no longer need local conversion.

### Why This Works

- The rest of the app (`blockManager.js`, etc.) only calls `window.markdownConverter.convert()`.
- That function returns a `Promise<string>`, which is the same whether it comes from `marked` or `fetch()`.
- No other files need to change.

---

## Next Steps

- **Add your own API:** Replace the converter as shown above.
- **Customize styles:** Edit `styles.css` — all colors are in CSS variables at the top.
- **Add features:** The modular structure makes it easy to add new toolbar buttons, block types, or keyboard shortcuts.

Happy editing!
