(function () {
  const API = "/api/plugin/custom-logo/logo";

  /** @type {string|null|undefined} */
  let _cachedDataUrl = undefined;

  /** @type {number} */
  let _searchMaxHeight = 100;
  /** @type {number} */
  let _searchMaxWidth = 300;
  /** @type {number} */
  let _homeMaxHeight = 300;
  /** @type {number} */
  let _homeMaxWidth = 500;

  fetch("/api/extensions")
    .then((r) => r.json())
    .then((data) => {
      const plugin = (data.plugins ?? []).find((p) => p.id === "plugin-custom-logo");
      const s = plugin?.settings ?? {};
      const _p = (v, fb) => { const n = parseInt(v, 10); return !isNaN(n) && n > 0 ? n : fb; };
      _homeMaxHeight = _p(s.homeLogoMaxHeight, 300);
      _homeMaxWidth = _p(s.homeLogoMaxWidth, 500);
      _searchMaxHeight = _p(s.searchLogoMaxHeight, 100);
      _searchMaxWidth = _p(s.searchLogoMaxWidth, 300);
    })
    .catch(() => {});

  /**
   * @returns {Promise<string|null>}
   */
  async function fetchLogo() {
    if (_cachedDataUrl !== undefined) return _cachedDataUrl;
    try {
      const res = await fetch(API);
      if (!res.ok) { _cachedDataUrl = null; return null; }
      const data = await res.json();
      _cachedDataUrl = data.dataUrl ?? null;
      return _cachedDataUrl;
    } catch {
      _cachedDataUrl = null;
      return null;
    }
  }

  /**
   * Replaces logo elements on the page with the custom image.
   * @param {string} dataUrl
   */
  function applyLogo(dataUrl) {
    /** @type {Array<{ el: Element|null, search: boolean }>} */
    const targets = [
      { el: document.querySelector("#home-logo .logo"), search: false },
      { el: document.querySelector(".results-logo"), search: true },
    ];
    for (const { el, search } of targets) {
      if (!el || el.dataset.customLogoApplied) continue;
      el.dataset.customLogoApplied = "1";
      const img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "Logo";
      img.className = search ? "custom-logo-img custom-logo-img--search" : "custom-logo-img";
      if (search) {
        img.style.maxHeight = `${_searchMaxHeight}px`;
        img.style.maxWidth = `${_searchMaxWidth}px`;
      } else {
        img.style.maxHeight = `${_homeMaxHeight}px`;
        img.style.maxWidth = `${_homeMaxWidth}px`;
      }
      el.replaceWith(img);
    }
  }

  async function init() {
    const dataUrl = await fetchLogo();
    if (dataUrl) applyLogo(dataUrl);
  }

  /**
   * Updates the logo preview inside the result card after upload or removal.
   * @param {HTMLElement} root
   * @param {string|null} dataUrl
   */
  function _updateCardPreview(root, dataUrl) {
    const PREVIEW_STYLE = "max-height:80px;max-width:280px;object-fit:contain;display:block;border-radius:6px;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;background:rgba(0,0,0,0.2);margin-bottom:10px;";
    const existing = /** @type {HTMLImageElement|null} */ (root.querySelector("#custom-logo-preview"));
    const noLogo = root.querySelector("#custom-logo-nologo");

    if (dataUrl) {
      if (existing) {
        existing.src = dataUrl;
      } else {
        const img = document.createElement("img");
        img.id = "custom-logo-preview";
        img.src = dataUrl;
        img.alt = "Current logo";
        img.style.cssText = PREVIEW_STYLE;
        if (noLogo) noLogo.replaceWith(img);
      }
    } else {
      if (existing) {
        const p = document.createElement("p");
        p.id = "custom-logo-nologo";
        p.style.cssText = "font-size:0.82rem;color:var(--text-secondary);font-style:italic;margin:0 0 10px;";
        p.textContent = "No custom logo set.";
        existing.replaceWith(p);
      }
    }
  }

  /**
   * Wires up the upload/remove buttons rendered by execute() in the result card.
   * @param {HTMLElement} root
   */
  function wireResultUi(root) {
    const fileInput = /** @type {HTMLInputElement|null} */ (root.querySelector("#custom-logo-file"));
    const removeBtn = root.querySelector("#custom-logo-remove");
    const status = root.querySelector("#custom-logo-status");

    if (!fileInput || fileInput.dataset.wired) return;
    fileInput.dataset.wired = "1";

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        if (status) status.textContent = "Image too large (max 2 MB).";
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = /** @type {string} */ (reader.result);
        try {
          const res = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl }),
          });
          const json = await res.json();
          if (!res.ok) {
            if (status) status.textContent = json.error ?? "Upload failed.";
            return;
          }
          _cachedDataUrl = dataUrl;
          if (status) status.textContent = "Logo saved!";
          applyLogo(dataUrl);
          _updateCardPreview(root, dataUrl);
        } catch {
          if (status) status.textContent = "Upload failed.";
        }
      };
      reader.readAsDataURL(file);
    });

    if (removeBtn) {
      removeBtn.addEventListener("click", async () => {
        try {
          const res = await fetch(API, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ dataUrl: null }),
          });
          if (!res.ok) { if (status) status.textContent = "Remove failed."; return; }
          _cachedDataUrl = null;
          if (status) status.textContent = "Logo removed.";
          _updateCardPreview(root, null);
        } catch {
          if (status) status.textContent = "Remove failed.";
        }
      });
    }
  }

  const obs = new MutationObserver(() => {
    init();
    document.querySelectorAll("#custom-logo-file:not([data-wired])").forEach((el) => {
      const root = /** @type {HTMLElement} */ (el.closest(".bang-result, .result-item, [class*='result'], div") ?? el.parentElement);
      if (root) wireResultUi(root);
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });

  init();
})();
