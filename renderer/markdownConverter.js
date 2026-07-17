// markdownConverter.js - Modular Markdown to HTML Conversion
// This module wraps the 'marked' library. It's designed to be easily swapped
// for a remote API call later without changing any other code in the app.

// Configure marked with safe, standard options.
// (Note: headerIds/mangle were removed in modern marked versions, so we
// only pass options that actually exist.)
if (typeof marked !== "undefined") {
  marked.setOptions({
    breaks: true, // Convert single line breaks to <br>
    gfm: true, // GitHub Flavored Markdown (tables, strikethrough, etc.)
  });
}

/**
 * Converts a markdown string to sanitized HTML.
 *
 * SECURITY: `marked` does NOT sanitize its output. A markdown file can
 * contain raw HTML (including <script> tags and on* event handlers).
 * Because this runs inside Electron — where the page has access to
 * window.api and therefore the file system — we MUST sanitize the HTML
 * with DOMPurify before it is injected into the DOM. Local images are stored
 * as data URLs so Chromium can resolve them from the file-backed app page.
 *
 * CURRENT IMPLEMENTATION: Uses the local `marked` library.
 * FUTURE IMPLEMENTATION: Replace the marked.parse() call with a fetch()
 * call to your own API endpoint, e.g.:
 *
 *   const response = await fetch('https://your-api.com/convert', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ markdown })
 *   });
 *   const html = await response.text();
 *   return sanitizeHtml(html); // keep sanitizing even with your own API
 *
 * The rest of the app (BlockManager, etc.) calls this function and
 * expects a Promise that resolves to an HTML string.
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
    // marked.parse() is synchronous, but we wrap it in a Promise
    // so the interface is async-ready for future API replacement.
    const rawHtml = marked.parse(markdown);
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
 * @param {string} html - Raw HTML (e.g. from marked or a remote API)
 * @returns {string} Sanitized HTML safe for innerHTML injection
 */
function sanitizeHtml(html) {
  if (typeof DOMPurify === "undefined") {
    console.error("DOMPurify not loaded — refusing to render raw HTML");
    return `<pre>${escapeHtml(html)}</pre>`;
  }

  const allowedUriPattern =
    /^(?:(?:https?|file):|data:image\/(?:bmp|gif|jpeg|jpg|png|webp);)/i;
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: allowedUriPattern,
  });
}

DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
  if (data.attrName === "type") {
    data.forceKeepAttr = true;
  }
});

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
