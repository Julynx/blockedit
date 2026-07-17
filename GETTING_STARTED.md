<section data-block-id="block-9a327bdd-5d2c-4762-a510-f99f63253afc">

# Getting Started with Markdown Blocks

</section>

<section data-block-id="block-c448ccea-f91f-4596-8458-d7e7f9122349">

A block-based markdown editor built with Electron, inspired by Jupyter notebooks.

</section>

<section data-block-id="block-d2aea524-4348-47fe-931e-1736e83f3326">

---

</section>

<section data-block-id="block-d514d237-0f7d-4c71-a099-a10ccabb6041">

## Table of Contents

</section>

<section data-block-id="block-4e446440-d6a7-49e5-bc5e-7f95a097fbfd">

1. [Prerequisites](#prerequisites)
2. [Installation](#installation)
3. [Running the App](#running-the-app)
4. [Building an Installer (EXE)](#building-an-installer-exe)
5. [Project Structure & Module Guide](#project-structure--module-guide)

</section>

<section data-block-id="block-c2be1ee7-0e20-41e5-991a-0bb86ab9534a">

---

</section>

<section data-block-id="block-d2f2a2ae-79ee-4312-bcc1-48886fa874b6">

## Prerequisites

</section>

<section data-block-id="block-f56f800d-a499-4f62-acb1-d38d95707c0a">

Before you begin, make sure you have the following installed:

</section>

<section data-block-id="block-b954ace1-f948-4c9b-87da-c87530597273">

- **Node.js** (version 18 or higher) — [Download here](https://nodejs.org/)
- **npm** (comes with Node.js)

</section>

<section data-block-id="block-62d8fad9-5c88-4a68-845d-c9a97a9a9ef2">

You can verify your installation by opening a terminal and running:

</section>

<section data-block-id="block-3733fb75-785c-4ddc-b3d5-aa34826e40a7">

```bash
node --version
npm --version
```

</section>

<section data-block-id="block-55ba065f-f8c0-4286-9c08-73c927ccf244">

---

</section>

<section data-block-id="block-6f6b9376-35e6-4a3c-8cb0-a6aa4935f7f0">

## Installation

</section>

<section data-block-id="block-9d7b0178-2966-44c2-9dd9-aa8cd00081c4">

1. **Navigate to the project folder:**

</section>

<section data-block-id="block-cbb7e987-0acf-4dd7-9fab-d3632f67e523">

```bash
cd blockedit
```


</section>

<section data-block-id="block-d36c8e4b-9924-47a6-a6cc-4282fd073119">

2. **Install dependencies:**

</section>

<section data-block-id="block-e58244c3-cff3-4339-aea1-f06af4e92f33">

```bash
   npm install
   ```

</section>

<section data-block-id="block-16967080-0a8f-4193-b9d4-afa53e571e85">

This installs:
   - `electron` — the desktop app framework
   - `electron-builder` — tool for creating installers
   - `marked` — markdown-to-HTML converter
   - `dompurify` — sanitizes rendered HTML to prevent script injection
   - `highlight.js` — syntax highlighting for fenced code blocks
   - `diff` — history checkpoint generation for undo and redo
   - `prettier` — Markdown formatting

</section>

<section data-block-id="block-e08c2437-f2ed-4c5c-94d6-b64ec337a921">

---

</section>

<section data-block-id="block-44caceac-57cb-42a3-ab72-a29f69862b05">

## Running the App

</section>

<section data-block-id="block-074c0e65-faaa-40df-a902-b7abca377bfc">

### Development Mode

</section>

<section data-block-id="block-1a8c8925-8fce-4cdc-9d63-2166bd36dc6f">

To start the app in development mode (with hot-reload-like behavior for renderer files):

</section>

<section data-block-id="block-6b82a1b0-522b-45e8-a0ee-938fbe625d8b">

```bash
npm start
```

</section>

<section data-block-id="block-581b422f-5268-4643-bc10-27ac0eb7e790">

This launches the Electron window. You can edit files in the `renderer/` folder and refresh the app (`Ctrl+R` or `Cmd+R`) to see changes.

</section>

<section data-block-id="block-4296e19c-b3a6-4b93-8eb4-8576761d2d09">

### Tips for Development

</section>

<section data-block-id="block-29be77b8-c8ef-41dc-b4ef-50d5875f8a19">

- **Open DevTools:** Press `F12` or `Ctrl+Shift+I`. They open automatically when running the app with `npm start`, but remain closed in packaged builds.
- **Debugging:** Check the terminal where you ran `npm start` for main-process logs. Use DevTools Console for renderer logs.
- **Keyboard shortcuts:** `Ctrl+S`/`Cmd+S` save · `Ctrl+Z`/`Cmd+Z` use native textarea undo while editing and document undo elsewhere · `Ctrl+Shift+Z`/`Cmd+Shift+Z` redo · `Shift+Enter` inside a block renders it.

</section>

<section data-block-id="block-9b862487-b242-452d-8d4c-a1532178f9d0">

---

</section>

<section data-block-id="block-dbcba770-9f2d-4075-aa42-d7517de7fabb">

## Building an Installer (EXE)

</section>

<section data-block-id="block-ab1a86e4-d151-46eb-a1a2-83f23ede4895">

To create a Windows installer (`.exe`):

</section>

<section data-block-id="block-57cb8901-2388-492f-9e63-01d2abb522a6">

```bash
npm run dist
```

</section>

<section data-block-id="block-3915f5ef-785a-4c73-8ef9-0a8bb01189ea">

This will:
1. Package the app using `electron-builder`
2. Create a `dist/` folder
3. Generate `Markdown Blocks Setup x.x.x.exe` inside it

</section>

<section data-block-id="block-352f623a-a929-4294-89a9-73c2e7a571cc">

### What the Build Does

</section>

<section data-block-id="block-ced21ea1-6699-4d9d-874b-300508a158cc">

- **App ID:** `com.markdownblocks.app` (used by Windows to identify the app)
- **Target:** NSIS installer (allows users to choose install directory)
- **Files included:** Only `main.js`, `preload.js`, and everything in `renderer/`

</section>

<section data-block-id="block-3f000ca3-3331-4b20-bcca-95a21218e82d">

### Distributing the App

</section>

<section data-block-id="block-2257ffa3-962f-4771-90d7-bdea277cdaa7">

The generated `.exe` is a self-contained installer. Users can run it and install the app like any other Windows program.

</section>

<section data-block-id="block-0e78c591-ef6b-48be-bc90-7aeeeb6b7f20">

---

</section>

<section data-block-id="block-fa31fa15-5d27-4989-be93-201dac2f7c63">

## Project Structure & Module Guide

</section>

<section data-block-id="block-5f232ba2-2b22-42b7-b5e9-4f29ece7cdf6">

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

</section>

<section data-block-id="block-296f6950-b7f5-4c16-a863-621b5f5b10a5">

### Module Descriptions

</section>

<section data-block-id="block-1514156f-5475-4972-8405-d738bb2d1a8f">

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

</section>

<section data-block-id="block-09c3b540-1798-4a9c-a79e-a83ba2273f25">

Rendered HTTP and HTTPS links are opened through Electron's `shell.openExternal()` in `main.js`, so they use the operating system's default browser instead of navigating the editor window.

</section>

<section data-block-id="block-2b81654e-ab3c-4afd-9b22-aac1c8505abf">

Markdown formatting is centralized in `Toolbar.formatMarkdown()`. Table insertion and switching an edit block to render mode use that method, which calls Prettier through the secure `preload.js`/`main.js` IPC bridge.

</section>

<section data-block-id="block-9a56c17c-73f1-4353-b633-063b811ef2b8">

The toolbar insertion buttons provide intentionally simple Markdown actions:

</section>

<section data-block-id="block-3262ad4e-1277-4f61-9a45-61de0a9ada4f">

- Unordered list: copies indentation from the nearest `- ` item above when adding a marker to a normal line, creates the next equally indented list item when pressed on an existing unordered item, or converts an ordered item to unordered
- Ordered list: searches upward for the nearest `N. ` item and inserts `N + 1`; starts at `1. ` when no ordered item is found, or converts an unordered item to ordered
- Indent / dedent: adds or removes two spaces at the current line's start
- Block quote: adds `> ` to the current line
- Fenced code: wraps the current selection in triple backticks
- Strikethrough: wraps the current selection in `~~`
- Image: inserts `![alt text](...)` from a typed URL or browsed image path; local paths are stored as lightweight `file:///...` URLs rather than base64 data
- Horizontal rule: inserts `---` on the line below the current line and leaves a new empty line after it

</section>

<section data-block-id="block-19efb558-cbfc-4df9-b77b-dda22b304cb9">

### Adding Toolbar Icons

</section>

<section data-block-id="block-fcc8eb06-9620-4ea4-8612-d8c8cf0ffcbd">

Toolbar SVG assets live in `renderer/icons/`. The toolbar accepts either a short icon name or a relative path:

</section>

<section data-block-id="block-cf876e79-4967-416b-992d-19fce591d4e6">

```javascript
this._createIconButton("bold", "Bold", onClick);
// Loads renderer/icons/bold.svg

this._createIconButton("icons/my-custom-icon.svg", "Custom action", onClick);
// Loads the specified relative path
```


</section>

<section data-block-id="block-6139337b-11c9-4cfb-8d05-06555993b776">

To add an icon, place an SVG file in `renderer/icons/` and pass its filename without the `.svg` extension. The build includes everything under `renderer/`, so no package installation is needed for custom icons.

</section>

<section data-block-id="block-5becaa11-cdf9-4432-a0f3-6070ed3340fa">

### Data Flow Example

</section>

<section data-block-id="block-c0b51e1f-93a3-4930-9e68-02763e13ce11">

When you type in a block:

</section>

<section data-block-id="block-45e11242-c5aa-4a2d-aef3-1a338cc0bd98">

1. `blockManager.js` captures the input event
2. It marks the document dirty while the block remains in edit mode
3. Clicking outside the block formats and commits the block
4. The commit creates a history checkpoint and calls `blockManager.serialize()`
5. It calls `window.api.saveFile()` (from `preload.js`)
6. `preload.js` sends an IPC message to `main.js`
7. `main.js` writes the file atomically using Node.js `fs`

</section>

<section data-block-id="block-d1b1cd3d-692c-4808-9b2f-f86ba2fe80af">

---

</section>

<section data-block-id="block-b762110e-57c2-47a4-84d8-b1e0c7077fce">

## Block File Format

</section>

<section data-block-id="block-8a9c81b6-5579-41ee-b95f-ee1c5c79492b">

- **Block storage:** Saved documents use `<section data-block-id="...">` tags to preserve block boundaries and stable block identifiers.
- **Markdown and HTML:** The section tags are intentional application metadata; HTML is valid inside Markdown and lets the editor preserve draggable block boundaries.
- **Formatting:** Leaving an edit block formats its Markdown with Prettier before rendering and saving.
- **Safety:** The editor sanitizes rendered HTML and only opens HTTP/HTTPS links externally.
- **Customize styles:** Edit `styles.css` — all colors are in CSS variables at the top.

</section>

<section data-block-id="block-e0cb6f0d-240c-4552-aa92-1928d0527487">

Happy editing!

</section>