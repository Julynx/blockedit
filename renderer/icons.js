// icons.js - SVG Icon Loading
// Loads local SVG files and appends them inline to buttons and containers.
// Parsed icons are cached by path; the cached original never enters the
// DOM and every caller receives a synchronous clone.

const IconLoader = {
  _cache: new Map(),

  /**
   * Resolves an icon reference to a loadable path.
   * A short name such as "bold" maps to renderer/icons/bold.svg.
   * A path containing a slash, such as "icons/custom.svg", is used as-is.
   */
  resolvePath(iconReference) {
    return iconReference.includes("/")
      ? iconReference
      : `icons/${iconReference}.svg`;
  },

  /**
   * Loads a local SVG and appends it inline to a container.
   * XHR works with local file:// assets in Electron where fetch() may not.
   * @param {string} iconReference - Short icon name or path with a slash
   * @param {HTMLElement} container - Element the icon is appended to
   */
  load(iconReference, container) {
    const iconPath = this.resolvePath(iconReference);
    const cached = this._cache.get(iconPath);
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
        this._cache.set(iconPath, svg);
        container.appendChild(svg.cloneNode(true));
      } catch {
        console.warn(`Toolbar icon could not be loaded: ${iconPath}`);
      }
    };
    request.onerror = () => {
      console.warn(`Toolbar icon could not be loaded: ${iconPath}`);
    };
    request.send();
  },
};

// Export for use in other modules
window.IconLoader = IconLoader;
