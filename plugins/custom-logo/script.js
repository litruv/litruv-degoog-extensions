(function () {
  const API = "/api/plugin/custom-logo/logo";

  /** @type {string|null|undefined} */
  let _cachedDataUrl = undefined;

  /** @type {boolean} */
  let hideLogoManagement = false;

  /** @type {number} */
  let _searchMaxHeight = 100;
  /** @type {number} */
  let _searchMaxWidth = 300;
  /** @type {number} */
  let _homeMaxHeight = 300;
  /** @type {number} */
  let _homeMaxWidth = 500;

  fetch("/api/plugin/custom-logo/settings")
    .then((r) => r.json())
    .then((d) => {
      // Handle both boolean and string values
      const val = d?.hideLogoManagement;
      hideLogoManagement = val === true || val === "true";
    })
    .catch(() => {});

  fetch("/api/plugin/custom-logo/dimensions")
    .then((r) => r.json())
    .then((d) => {
      const _p = (v, fb) => { const n = parseInt(v, 10); return !isNaN(n) && n > 0 ? n : fb; };
      _homeMaxHeight = _p(d.homeMaxHeight, 300);
      _homeMaxWidth = _p(d.homeMaxWidth, 500);
      _searchMaxHeight = _p(d.searchMaxHeight, 100);
      _searchMaxWidth = _p(d.searchMaxWidth, 300);
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
    // Update any already-replaced custom logo images immediately.
    document.querySelectorAll(".custom-logo-img").forEach((el) => {
      const img = /** @type {HTMLImageElement} */ (el);
      img.src = dataUrl;
    });

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
      // If it's an anchor (search page logo), replace children to preserve the link
      if (el.tagName === "A") {
        el.replaceChildren(img);
      } else {
        el.replaceWith(img);
      }
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
    const PREVIEW_STYLE = "max-height:80px;max-width:220px;object-fit:contain;display:block;border-radius:6px;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;background:rgba(0,0,0,0.2);";
    const existing = /** @type {HTMLImageElement|null} */ (root.querySelector("#custom-logo-preview"));
    const noLogo = root.querySelector("#custom-logo-nologo");
    const homePreviewImg = /** @type {HTMLImageElement|null} */ (root.querySelector("#custom-logo-home-preview-img"));

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
      if (homePreviewImg) {
        homePreviewImg.src = dataUrl;
        homePreviewImg.style.display = "";
      }
    } else {
      if (existing) {
        const p = document.createElement("p");
        p.id = "custom-logo-nologo";
        p.style.cssText = "font-size:0.82rem;color:var(--text-secondary);font-style:italic;margin:0;";
        p.textContent = "No custom logo set.";
        existing.replaceWith(p);
      }
      if (homePreviewImg) homePreviewImg.style.display = "none";
    }
  }

  /**
   * Wires up the upload/remove buttons rendered by execute() in the result card.
   * @param {HTMLElement} root
   */
  function wireResultUi(root) {
    const fileInput = /** @type {HTMLInputElement|null} */ (root.querySelector("#custom-logo-file"));
    
    // If hideLogoManagement is enabled, the management UI won't exist in the card
    if (!fileInput) return;

    const removeBtn = root.querySelector("#custom-logo-remove");
    const status = root.querySelector("#custom-logo-status");

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

    // Dimension sliders
    const homeHSlider = /** @type {HTMLInputElement|null} */ (root.querySelector("#cl-home-h"));
    const homeWSlider = /** @type {HTMLInputElement|null} */ (root.querySelector("#cl-home-w"));
    const searchHSlider = /** @type {HTMLInputElement|null} */ (root.querySelector("#cl-search-h"));
    const searchWSlider = /** @type {HTMLInputElement|null} */ (root.querySelector("#cl-search-w"));
    const saveDimsBtn = root.querySelector("#custom-logo-save-dims");
    const homePreviewImg = /** @type {HTMLImageElement|null} */ (root.querySelector("#custom-logo-home-preview-img"));

    /**
     * Wires a range slider to update its paired value label.
     * @param {HTMLInputElement|null} slider
     * @param {string} valId
     */
    const _wireSliderLabel = (slider, valId) => {
      if (!slider) return;
      const label = root.querySelector(`#${valId}`);
      slider.addEventListener("input", () => {
        if (label) label.textContent = slider.value + "px";
      });
    };
    _wireSliderLabel(homeHSlider, "cl-home-h-val");
    _wireSliderLabel(homeWSlider, "cl-home-w-val");
    _wireSliderLabel(searchHSlider, "cl-search-h-val");
    _wireSliderLabel(searchWSlider, "cl-search-w-val");

    if (homeHSlider && homePreviewImg) {
      homeHSlider.addEventListener("input", () => { homePreviewImg.style.maxHeight = homeHSlider.value + "px"; });
    }
    if (homeWSlider && homePreviewImg) {
      homeWSlider.addEventListener("input", () => { homePreviewImg.style.maxWidth = homeWSlider.value + "px"; });
    }
    if (searchHSlider) {
      searchHSlider.addEventListener("input", () => {
        document.querySelectorAll(".custom-logo-img--search").forEach((el) => {
          /** @type {HTMLImageElement} */ (el).style.maxHeight = searchHSlider.value + "px";
        });
      });
    }
    if (searchWSlider) {
      searchWSlider.addEventListener("input", () => {
        document.querySelectorAll(".custom-logo-img--search").forEach((el) => {
          /** @type {HTMLImageElement} */ (el).style.maxWidth = searchWSlider.value + "px";
        });
      });
    }

    if (saveDimsBtn) {
      saveDimsBtn.addEventListener("click", async () => {
        const dims = {
          homeMaxHeight: parseInt(homeHSlider?.value ?? "300", 10),
          homeMaxWidth: parseInt(homeWSlider?.value ?? "500", 10),
          searchMaxHeight: parseInt(searchHSlider?.value ?? "100", 10),
          searchMaxWidth: parseInt(searchWSlider?.value ?? "300", 10),
        };
        try {
          const res = await fetch("/api/plugin/custom-logo/dimensions", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dims),
          });
          if (!res.ok) { if (status) status.textContent = "Save failed."; return; }
          _homeMaxHeight = dims.homeMaxHeight;
          _homeMaxWidth = dims.homeMaxWidth;
          _searchMaxHeight = dims.searchMaxHeight;
          _searchMaxWidth = dims.searchMaxWidth;
          document.querySelectorAll(".custom-logo-img--search").forEach((el) => {
            /** @type {HTMLImageElement} */ (el).style.maxHeight = `${_searchMaxHeight}px`;
            /** @type {HTMLImageElement} */ (el).style.maxWidth = `${_searchMaxWidth}px`;
          });
          document.querySelectorAll(".custom-logo-img:not(.custom-logo-img--search)").forEach((el) => {
            /** @type {HTMLImageElement} */ (el).style.maxHeight = `${_homeMaxHeight}px`;
            /** @type {HTMLImageElement} */ (el).style.maxWidth = `${_homeMaxWidth}px`;
          });
          if (status) status.textContent = "Dimensions saved!";
        } catch {
          if (status) status.textContent = "Save failed.";
        }
      });
    }
  }

  const obs = new MutationObserver(() => {
    init();
    document.querySelectorAll("#custom-logo-card:not([data-wired])").forEach((el) => {
      const root = /** @type {HTMLElement} */ (el);
      root.dataset.wired = "1";
      wireResultUi(root);
    });
  });
  obs.observe(document.body, { childList: true, subtree: true });

  init();
})();
