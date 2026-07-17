// markdownConverter.js - Modular Markdown to HTML Conversion
// This module wraps the local 'marked' library and sanitizes its HTML output.

// Configure marked with safe, standard options.
// (Note: headerIds/mangle were removed in modern marked versions, so we
// only pass options that actually exist.)
if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true, // Convert single line breaks to <br>
    gfm: true, // GitHub Flavored Markdown (tables, strikethrough, etc.)
  });
}

const codeRenderer =
  typeof marked !== "undefined" ? new marked.Renderer() : null;

if (codeRenderer) {
  codeRenderer.code = (code, infostring, escaped) => {
    const language = (infostring || "").trim().split(/\s+/, 1)[0];
    const source = code.replace(/\n$/, "") + "\n";
    let highlighted = escaped ? source : escapeHtml(source);

    if (
      language &&
      language !== "language" &&
      typeof hljs !== "undefined" &&
      hljs.getLanguage(language)
    ) {
      try {
        highlighted = hljs.highlight(source, {
          language,
          ignoreIllegals: true,
        }).value;
      } catch (error) {
        console.warn(`Could not highlight ${language} code:`, error);
      }
    }

    const languageClass = language
      ? ` class="hljs language-${escapeHtml(language)}"`
      : ' class="hljs"';
    return `<pre><code${languageClass}>${highlighted}</code></pre>\n`;
  };
}

/**
 * Converts a markdown string to sanitized HTML.
 *
 * SECURITY: `marked` does NOT sanitize its output. A markdown file can
 * contain raw HTML (including <script> tags and on* event handlers).
 * Because this runs inside Electron — where the page has access to
 * window.api and therefore the file system — we MUST sanitize the HTML
 * with DOMPurify before it is injected into the DOM. Local images are stored
 * as file URLs so Chromium can resolve them without copying image bytes into
 * the Markdown document.
 *
 * The rest of the app calls this function and expects a Promise that resolves
 * to a sanitized HTML string.
 *
 * @param {string} markdown - The markdown source text
 * @returns {Promise<string>} A promise resolving to sanitized HTML
 */
async function convertMarkdownToHtml(markdown) {
  // Safety check: if marked failed to load, return an escaped fallback
  if (typeof marked === "undefined") {
    console.error("marked library not loaded");
    return `<pre>${escapeHtml(markdown)}</pre>`;
  }

  try {
    // marked.parse() is synchronous, but this function remains async because
    // rendering is part of an asynchronous block lifecycle.
    const rawHtml = marked.parse(markdown, {
      renderer: codeRenderer,
    });
    return sanitizeHtml(rawHtml);
  } catch (error) {
    console.error("Markdown conversion error:", error);
    return `<pre>${escapeHtml(markdown)}</pre>`;
  }
}

/**
 * Sanitizes an HTML string, stripping scripts, event handlers, and any
 * other potentially dangerous markup while keeping normal formatting
 * (headings, tables, links, images, etc.).
 *
 * @param {string} html - Raw HTML from marked
 * @returns {string} Sanitized HTML safe for innerHTML injection
 */
function sanitizeHtml(html) {
  if (typeof DOMPurify === "undefined") {
    console.error("DOMPurify not loaded — refusing to render raw HTML");
    return `<pre>${escapeHtml(html)}</pre>`;
  }

  // Custom ALLOWED_URI_REGEXP is intentionally disabled.
  // DOMPurify 3.4.12 has a runtime interaction where enabling it causes
  // Marked task-list <input type="checkbox"> elements to lose the attributes
  // needed by the editor's checkbox styling. This was reproduced manually.
  // Keep the default DOMPurify URI policy instead unless this is re-tested.
  //
  // const allowedUriPattern =
  //   /^(?:(?:https?|file):|data:image\/(?:bmp|gif|jpeg|jpg|png|webp);)/i;
  // return DOMPurify.sanitize(html, {
  //   ALLOWED_URI_REGEXP: allowedUriPattern,
  // });
  return DOMPurify.sanitize(html);
}

/**
 * Escapes HTML special characters to prevent injection.
 * Used as a fallback if conversion fails.
 *
 * @param {string} text - Raw text
 * @returns {string} Escaped text safe for HTML insertion
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Export for use in other modules
window.markdownConverter = {
  convert: convertMarkdownToHtml,
};
