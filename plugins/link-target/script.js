(function () {
  let linkTarget = "_top";

  fetch("/api/extensions")
    .then((r) => r.json())
    .then((data) => {
      const plugin = (data.plugins ?? []).find((p) => p.id === "plugin-link-target");
      const t = plugin?.settings?.linkTarget;
      if (t && ["_top", "_blank", "_parent", "_self"].includes(t)) linkTarget = t;
      patchAll(document);
    })
    .catch(() => {});

  /**
   * Patches an anchor element to open in the configured target.
   * @param {HTMLAnchorElement} el
   */
  function patchAnchor(el) {
    if (el.tagName !== "A") return;
    const href = el.getAttribute("href");
    if (!href || href.startsWith("#") || href.startsWith("javascript:")) return;
    if (el.target === linkTarget) return;
    el.target = linkTarget;
  }

  /**
   * Patches all existing anchors in a root element.
   * @param {Element|Document} root
   */
  function patchAll(root) {
    root.querySelectorAll("a[href]").forEach(patchAnchor);
  }

  patchAll(document);

  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === "A") {
          patchAnchor(/** @type {HTMLAnchorElement} */ (node));
        } else {
          patchAll(/** @type {Element} */ (node));
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
})();
