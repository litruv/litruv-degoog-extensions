(function () {
const API = "/api/plugin/custom-logo/logo";
const LOGOS_API = "/api/plugin/custom-logo/logos";
const ROTATION_API = "/api/plugin/custom-logo/rotation-settings";

const _hideStyle = document.createElement("style");
_hideStyle.textContent = "#home-logo .logo, .results-logo { visibility: hidden !important; }";
document.head.appendChild(_hideStyle);

const _searchHideStyle = document.createElement("style");
_searchHideStyle.textContent = "#search-bar-home, .button-row { clip-path: inset(0 100% 0 0); }";
document.head.appendChild(_searchHideStyle);

let _resultsRevealStyle = null;
function lockResultsLogoReveal() {
  if (_resultsRevealStyle) return;
  _resultsRevealStyle = document.createElement("style");
  _resultsRevealStyle.textContent = ".results-logo, .results-logo .custom-logo-img, .results-logo .custom-logo-img--search { opacity: 0 !important; }";
  document.head.appendChild(_resultsRevealStyle);
}

function unlockResultsLogoReveal() {
  if (!_resultsRevealStyle) return;
  _resultsRevealStyle.remove();
  _resultsRevealStyle = null;
}

let _cachedDataUrl = undefined;
let hideLogoManagement = false;
let _logoIntro = "none";
let _introPlayed = false;
let _searchMaxHeight = 100;
let _searchMaxWidth = 300;
let _homeMaxHeight = 300;
let _homeMaxWidth = 500;
let _dimensionsLoaded = false;
let _settingsPromise = null;
let _rotationTimer = null;
let _rotationMode = "reload";
let _intervalSec = 60;
let _randomize = true;
let _initialized = false;
let _hasShownInitialIntro = false;
let _bootstrapLockUntil = 0;
let _isApplyingLogo = false;
let _logoFetchInFlight = null;
let _initDebounceTimer = null;

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_IMAGES = 32;

function loadSettings() {
  if (_settingsPromise) return _settingsPromise;
  _settingsPromise = fetch("/api/plugin/custom-logo/settings")
    .then((r) => r.json())
    .then((d) => {
      const val = d?.hideLogoManagement;
      hideLogoManagement = val === true || val === "true";
      const validIntros = ["none", "fade", "matrix"];
      _logoIntro = validIntros.includes(d?.logoIntro) ? d.logoIntro : "none";
    })
    .catch(() => {});
  return _settingsPromise;
}

async function loadDimensions() {
  if (_dimensionsLoaded) return;
  try {
    const res = await fetch("/api/plugin/custom-logo/dimensions");
    if (!res.ok) return;
    const d = await res.json();
    const _p = (v, fb) => { const n = parseInt(v, 10); return !isNaN(n) && n > 0 ? n : fb; };
    _homeMaxHeight = _p(d.homeMaxHeight, 300);
    _homeMaxWidth = _p(d.homeMaxWidth, 500);
    _searchMaxHeight = _p(d.searchMaxHeight, 100);
    _searchMaxWidth = _p(d.searchMaxWidth, 300);
    _dimensionsLoaded = true;
  } catch {}
}

async function fetchLogo(force = false) {
  if (!force && _cachedDataUrl !== undefined && _rotationMode !== "interval") {
    return { dataUrl: _cachedDataUrl, rotationMode: _rotationMode, intervalSec: _intervalSec, randomize: _randomize };
  }
  if (_logoFetchInFlight) return _logoFetchInFlight;

  _logoFetchInFlight = (async () => {
    try {
      const res = await fetch(API);
      if (!res.ok) {
        _cachedDataUrl = null;
        return { dataUrl: null, rotationMode: _rotationMode, intervalSec: _intervalSec, randomize: _randomize };
      }
      const data = await res.json();
      _cachedDataUrl = data.dataUrl ?? null;
      _rotationMode = data.rotationMode || "reload";
      _intervalSec = Math.max(1, parseInt(data.intervalSec || 60, 10));
      _randomize = data.randomize !== false;
      return { dataUrl: _cachedDataUrl, rotationMode: _rotationMode, intervalSec: _intervalSec, randomize: _randomize };
    } catch {
      _cachedDataUrl = null;
      return { dataUrl: null, rotationMode: _rotationMode, intervalSec: _intervalSec, randomize: _randomize };
    } finally {
      _logoFetchInFlight = null;
    }
  })();

  return _logoFetchInFlight;
}

function restoreNativeLogo() {
  clearRotationTimer();
  _cachedDataUrl = null;
  _initialized = false;
  _introPlayed = false;
  _hasShownInitialIntro = false;
  if (document.querySelector(".custom-logo-img")) {
    location.reload();
  }
}

function applyLogo(dataUrl, intro, options = {}) {
  if (!dataUrl) {
    restoreNativeLogo();
    return;
  }
  if (_isApplyingLogo) return;
  _isApplyingLogo = true;
  const animateRotation = options.animateRotation === true;
  const revealWhenReady = options.revealWhenReady === true;
  document.querySelectorAll(".custom-logo-img").forEach((el) => {
    const img = el;
    if (animateRotation) crossfadeExistingImage(img, dataUrl);
    else img.src = dataUrl;
  });

  const targets = [
    { el: document.querySelector("#home-logo .logo"), search: false },
    { el: document.querySelector(".results-logo"), search: true },
  ];

  const newImgs = [];
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
      if (revealWhenReady) img.style.opacity = "0";
    } else {
      img.style.maxHeight = `${_homeMaxHeight}px`;
      img.style.maxWidth = `${_homeMaxWidth}px`;
    }
    if (el.tagName === "A") el.replaceChildren(img);
    else el.replaceWith(img);
    newImgs.push(img);
  }

  if (!_introPlayed && intro && intro !== "none" && newImgs.length > 0) {
    _introPlayed = true;
    _hasShownInitialIntro = true;
    newImgs.forEach((img) => _runIntro(img, intro));
  }

  if (revealWhenReady) {
    const resultsImg = newImgs.find((img) => img.classList.contains("custom-logo-img--search")) || document.querySelector(".custom-logo-img--search");
    if (resultsImg) {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resultsImg.style.transition = "opacity 120ms ease";
          unlockResultsLogoReveal();
          resultsImg.style.opacity = "1";
        });
      });
    } else {
      unlockResultsLogoReveal();
    }
  }

  queueMicrotask(() => { _isApplyingLogo = false; });
}

function crossfadeExistingImage(img, nextSrc) {
  if (!img || img.dataset.crossfading === "1" || img.src === nextSrc) {
    if (img && img.src !== nextSrc && img.dataset.crossfading !== "1") img.src = nextSrc;
    return;
  }

  img.dataset.crossfading = "1";
  const overlay = document.createElement("img");
  overlay.src = nextSrc;
  overlay.alt = img.alt || "Logo";
  overlay.className = img.className;
  overlay.style.cssText = img.style.cssText + ";position:absolute;inset:0;opacity:0;transition:opacity 1000ms ease;pointer-events:none;";

  const parent = img.parentElement;
  if (!parent) {
    img.src = nextSrc;
    delete img.dataset.crossfading;
    return;
  }

  const wrapper = document.createElement("span");
  wrapper.style.cssText = "position:relative;display:inline-block;line-height:0;";
  parent.insertBefore(wrapper, img);
  wrapper.appendChild(img);
  wrapper.appendChild(overlay);

  requestAnimationFrame(() => {
    overlay.style.opacity = "1";
    img.style.transition = "opacity 1000ms ease";
    img.style.opacity = "0";
  });

  setTimeout(() => {
    img.src = nextSrc;
    img.style.opacity = "";
    img.style.transition = "";
    wrapper.parentNode?.insertBefore(img, wrapper);
    wrapper.remove();
    delete img.dataset.crossfading;
  }, 1020);
}

function _runIntro(img, type) {
  if (type === "fade") _fadeIn(img);
  else if (type === "matrix") _matrixIn(img);
}

async function _fadeIn(img) {
  const searchBar = document.querySelector("#search-bar-home");
  const buttonRow = document.querySelector(".button-row");
  const isHome = !!searchBar;

  await new Promise((resolve) => {
    const duration = 650;
    const start = performance.now();
    img.style.opacity = "0";
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      img.style.opacity = String(t);
      if (t < 1) requestAnimationFrame(frame);
      else {
        img.style.opacity = "";
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });

  if (isHome) {
    await _fadeReveal(searchBar, 350);
    await _fadeReveal(buttonRow, 280);
    _searchHideStyle.remove();
    if (searchBar) searchBar.style.clipPath = "";
    if (buttonRow) buttonRow.style.clipPath = "";
  }
}

async function _matrixIn(img) {
  try { await img.decode(); } catch { return; }
  const w = img.naturalWidth || 400;
  const h = img.naturalHeight || 200;
  const PAD = 100;

  const searchBar = document.querySelector("#search-bar-home");
  const buttonRow = document.querySelector(".button-row");
  const isHome = !!searchBar;
  if (isHome) {
    [searchBar, buttonRow].forEach((el) => {
      if (!el) return;
      el.style.clipPath = "inset(0 100% 0 0)";
    });
  }

  const makeChannel = (rMul, gMul, bMul) => {
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.drawImage(img, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h);
    for (let i = 0; i < d.data.length; i += 4) {
      d.data[i] = (d.data[i] * rMul) | 0;
      d.data[i + 1] = (d.data[i + 1] * gMul) | 0;
      d.data[i + 2] = (d.data[i + 2] * bMul) | 0;
    }
    x.putImageData(d, 0, 0);
    return c;
  };

  const redCh = makeChannel(1, 0, 0);
  const cyanCh = makeChannel(0, 1, 1);
  const isSearch = img.className.includes("--search");
  const maxW = isSearch ? _searchMaxWidth : _homeMaxWidth;
  const maxH = isSearch ? _searchMaxHeight : _homeMaxHeight;
  const scale = Math.min(1, maxW / w, maxH / h);
  const rendW = Math.round(w * scale);
  const rendH = Math.round(h * scale);
  const scaledPad = Math.round(PAD * scale);

  const CW = w + PAD * 2;
  const CH = h + PAD * 2;
  const canvas = document.createElement("canvas");
  canvas.width = CW;
  canvas.height = CH;
  canvas.className = img.className;
  canvas.style.cssText = img.style.cssText;
  canvas.style.width = `${rendW + scaledPad * 2}px`;
  canvas.style.height = `${rendH + scaledPad * 2}px`;
  canvas.style.maxWidth = "none";
  canvas.style.maxHeight = "none";
  canvas.style.margin = `-${scaledPad}px`;
  canvas.style.display = "block";

  const parent = img.parentNode;
  const next = img.nextSibling;
  if (!parent) return;
  parent.removeChild(img);
  parent.insertBefore(canvas, next);

  const ctx = canvas.getContext("2d");
  const R = (a, b) => Math.random() * (b - a) + a;
  const Ri = (a, b) => Math.floor(R(a, b));
  const CORRUPT_COLORS = ["#00fff0", "#ff003c", "#ff00ff", "#ffffff", "#000000", "#ffff00"];
  const duration = 900;
  const start = performance.now();

  await new Promise((resolve) => {
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const intensity = Math.pow(1 - t, 1.4);
      ctx.clearRect(0, 0, CW, CH);
      ctx.globalAlpha = t < 0.08 ? 0 : Math.min(1, (t - 0.08) / 0.3);
      ctx.drawImage(img, PAD, PAD, w, h);
      ctx.globalAlpha = 1;

      if (intensity > 0.02) {
        const numSlices = Ri(2, Math.ceil(intensity * 7) + 3);
        for (let i = 0; i < numSlices; i++) {
          const bh = R(h * 0.05, h * 0.35);
          const sy = R(0, h - bh);
          const dx = (Math.random() < 0.5 ? 1 : -1) * R(w * 0.04, w * 0.55) * intensity;
          ctx.drawImage(img, 0, sy, w, bh, PAD + dx, PAD + sy, w, bh);
        }

        if (intensity > 0.06) {
          const shift = R(w * 0.025, w * 0.09) * intensity;
          ctx.globalCompositeOperation = "screen";
          ctx.globalAlpha = Math.min(0.95, intensity * 0.9);
          ctx.drawImage(redCh, PAD + shift, PAD, w, h);
          ctx.drawImage(cyanCh, PAD - shift * 0.65, PAD, w, h);
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = "source-over";
        }

        if (intensity > 0.04) {
          const noiseCount = Math.ceil(intensity * 200);
          for (let i = 0; i < noiseCount; i++) {
            const v = Ri(0, 256);
            ctx.fillStyle = `rgb(${v},${v},${v})`;
            ctx.globalAlpha = R(0.25, 0.85);
            ctx.fillRect(Ri(0, CW), Ri(0, CH), Ri(1, Math.ceil(intensity * 12) + 1), Ri(1, Math.ceil(intensity * 6) + 1));
          }
          ctx.globalAlpha = 1;
        }

        const numCorrupt = Ri(0, Math.ceil(intensity * 5) + 1);
        for (let i = 0; i < numCorrupt; i++) {
          ctx.fillStyle = CORRUPT_COLORS[Ri(0, CORRUPT_COLORS.length)];
          ctx.globalAlpha = R(0.5, 1.0) * intensity;
          ctx.fillRect(R(0, w + PAD), R(0, h + PAD), R(w * 0.06, w * 0.55), R(2, h * 0.12));
        }
        ctx.globalAlpha = 1;

        if (intensity > 0.12 && Math.random() > 0.35) {
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          const step = Ri(2, 5);
          for (let y = 0; y < CH; y += step * 2) ctx.fillRect(0, y, CW, step);
        }

        if (intensity > 0.6 && Math.random() > 0.88) {
          ctx.fillStyle = Math.random() > 0.4 ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.95)";
          ctx.fillRect(PAD, PAD, w, h);
        }
      }

      if (t < 1) requestAnimationFrame(frame);
      else {
        if (canvas.parentNode) {
          canvas.parentNode.insertBefore(img, canvas);
          canvas.remove();
        }
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });

  if (isHome) {
    await _cyberReveal(searchBar, 150);
    await _cyberReveal(buttonRow, 120);
    _searchHideStyle.remove();
    if (searchBar) searchBar.style.clipPath = "";
    if (buttonRow) buttonRow.style.clipPath = "";
  }
}

function _fadeReveal(el, duration) {
  if (!el) return Promise.resolve();
  return new Promise((resolve) => {
    el.style.clipPath = "inset(0 0% 0 0)";
    el.style.opacity = "0";
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      el.style.opacity = String(t);
      if (t < 1) requestAnimationFrame(frame);
      else {
        el.style.opacity = "";
        el.style.clipPath = "inset(0 0% 0 0)";
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

function _cyberReveal(el, duration) {
  if (!el) return Promise.resolve();
  return new Promise((resolve) => {
    const rect = el.getBoundingClientRect();
    const scanner = document.createElement("div");
    scanner.style.cssText = [
      "position:fixed",
      `top:${rect.top - 4}px`,
      `left:${rect.left}px`,
      "width:3px",
      `height:${rect.height + 8}px`,
      "background:linear-gradient(to bottom,transparent 0%,#00fff0 35%,#ffffff 50%,#00fff0 65%,transparent 100%)",
      "box-shadow:0 0 14px 6px rgba(0,255,240,0.7)",
      "pointer-events:none",
      "z-index:9999",
    ].join(";");
    document.body.appendChild(scanner);
    const start = performance.now();
    function frame(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 3);
      el.style.clipPath = `inset(0 ${((1 - eased) * 100).toFixed(1)}% 0 0)`;
      scanner.style.left = `${rect.left + eased * rect.width}px`;
      if (t < 1) requestAnimationFrame(frame);
      else {
        el.style.clipPath = "inset(0 0% 0 0)";
        scanner.remove();
        resolve();
      }
    }
    requestAnimationFrame(frame);
  });
}

function _updateCardPreview(root, dataUrl) {
  const PREVIEW_STYLE = "max-height:80px;max-width:220px;object-fit:contain;display:block;border-radius:6px;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;background:rgba(0,0,0,0.2);";
  const existing = root.querySelector("#custom-logo-preview");
  const noLogo = root.querySelector("#custom-logo-nologo");
  const homePreviewImg = root.querySelector("#custom-logo-home-preview-img");
  if (dataUrl) {
    if (existing) existing.src = dataUrl;
    else {
      const img = document.createElement("img");
      img.id = "custom-logo-preview";
      img.src = dataUrl;
      img.alt = "Current logo";
      img.style.cssText = PREVIEW_STYLE;
      if (noLogo) noLogo.replaceWith(img);
    }
    if (homePreviewImg) { homePreviewImg.src = dataUrl; homePreviewImg.style.display = ""; }
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

function renderGallery(root, images) {
  const gallery = root.querySelector("#custom-logo-gallery");
  if (!gallery) return;
  gallery.replaceChildren();
  if (!images.length) {
    const empty = document.createElement("p");
    empty.className = "custom-logo-none";
    empty.id = "custom-logo-gallery-empty";
    empty.textContent = "No images added yet.";
    gallery.appendChild(empty);
    _updateCardPreview(root, null);
    return;
  }
  for (const img of images) {
    const item = document.createElement("div");
    item.className = "custom-logo-gallery-item";
    item.dataset.logoId = img.id;

    const thumb = document.createElement("img");
    thumb.src = img.dataUrl;
    thumb.alt = img.name || "Logo";
    thumb.className = "custom-logo-gallery-thumb";

    const meta = document.createElement("div");
    meta.className = "custom-logo-gallery-meta";

    const name = document.createElement("span");
    name.className = "custom-logo-gallery-name";
    name.textContent = img.name || "image";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "custom-logo-btn custom-logo-btn--remove custom-logo-remove-item";
    removeBtn.dataset.logoId = img.id;
    removeBtn.textContent = "Remove";

    meta.append(name, removeBtn);
    item.append(thumb, meta);
    gallery.appendChild(item);
  }
  _updateCardPreview(root, images[0].dataUrl);
}

function clearRotationTimer() {
  if (_rotationTimer) {
    clearInterval(_rotationTimer);
    _rotationTimer = null;
  }
}

function ensureRotation() {
  clearRotationTimer();
  if (_rotationMode !== "interval") return;
  _rotationTimer = setInterval(async () => {
    const { dataUrl } = await fetchLogo(true);
    if (dataUrl) applyLogo(dataUrl, _hasShownInitialIntro ? "none" : _logoIntro, { animateRotation: _hasShownInitialIntro });
  }, Math.max(1, _intervalSec) * 1000);
}

async function wireResultUi(root) {
  const fileInput = root.querySelector("#custom-logo-file");
  if (!fileInput) return;
  const removeAllBtn = root.querySelector("#custom-logo-remove-all");
  const status = root.querySelector("#custom-logo-status");
  const saveRotationBtn = root.querySelector("#custom-logo-save-rotation");

  async function refreshStore() {
    const res = await fetch(LOGOS_API);
    if (!res.ok) return null;
    return await res.json();
  }

  fileInput.addEventListener("change", async () => {
    const files = Array.from(fileInput.files || []);
    if (!files.length) return;

    const store = await refreshStore();
    const existingCount = store?.images?.length ?? 0;
    if (existingCount >= MAX_IMAGES) {
      if (status) status.textContent = `Maximum ${MAX_IMAGES} images allowed.`;
      fileInput.value = "";
      return;
    }

    const out = [];
    let skipped = 0;
    for (const file of files) {
      if (existingCount + out.length >= MAX_IMAGES) break;
      if (file.size > MAX_FILE_BYTES) {
        skipped++;
        continue;
      }
      const dataUrl = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(file);
      });
      if (typeof dataUrl === "string" && dataUrl.startsWith("data:image/")) {
        out.push({ name: file.name, dataUrl });
      } else {
        skipped++;
      }
    }
    if (!out.length) {
      if (status) status.textContent = skipped ? "No valid images selected (max 2 MB each)." : "No images selected.";
      fileInput.value = "";
      return;
    }
    try {
      const res = await fetch(LOGOS_API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: out }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (status) status.textContent = json.error || "Upload failed.";
        return;
      }
      _cachedDataUrl = undefined;
      renderGallery(root, json.images || []);
      if (status) status.textContent = skipped ? `Saved ${out.length} image(s); ${skipped} skipped.` : "Image(s) saved.";
      const first = (json.images || [])[0]?.dataUrl;
      if (first) { _introPlayed = false; _hasShownInitialIntro = false; applyLogo(first, _logoIntro); }
      ensureRotation();
      fileInput.value = "";
    } catch {
      if (status) status.textContent = "Upload failed.";
    }
  });

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest(".custom-logo-remove-item");
    if (!btn) return;
    const id = btn.dataset.logoId;
    try {
      const res = await fetch(`${LOGOS_API}/remove`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (status) status.textContent = json.error || "Remove failed.";
        return;
      }
      _cachedDataUrl = undefined;
      renderGallery(root, json.images || []);
      if ((json.images || []).length) {
        _introPlayed = false;
        _hasShownInitialIntro = false;
        applyLogo(json.images[0].dataUrl, _logoIntro);
        if (status) status.textContent = "Image removed.";
        ensureRotation();
      } else {
        if (status) status.textContent = "Image removed.";
        restoreNativeLogo();
      }
    } catch {
      if (status) status.textContent = "Remove failed.";
    }
  });

  if (removeAllBtn) {
    removeAllBtn.addEventListener("click", async () => {
      try {
        const res = await fetch(`${LOGOS_API}/clear`, { method: "POST" });
        if (!res.ok) { if (status) status.textContent = "Remove failed."; return; }
        renderGallery(root, []);
        if (status) status.textContent = "All images removed.";
        restoreNativeLogo();
      } catch {
        if (status) status.textContent = "Remove failed.";
      }
    });
  }

  if (saveRotationBtn) {
    saveRotationBtn.addEventListener("click", async () => {
      const rotationMode = root.querySelector('input[name="cl-rotation-mode"]:checked')?.value || "reload";
      const randomMode = root.querySelector('input[name="cl-random-mode"]:checked')?.value || "random";
      const intervalSec = Math.min(86400, Math.max(1, parseInt(root.querySelector("#cl-interval-sec")?.value || "60", 10)));
      try {
        const res = await fetch(ROTATION_API, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ rotationMode, intervalSec, randomize: randomMode === "random" }),
        });
        const json = await res.json();
        if (!res.ok) { if (status) status.textContent = json.error || "Save failed."; return; }
        _rotationMode = json.store.rotationMode;
        _intervalSec = json.store.intervalSec;
        _randomize = json.store.randomize;
        if (status) status.textContent = "Rotation saved.";
        ensureRotation();
      } catch {
        if (status) status.textContent = "Save failed.";
      }
    });
  }

  const homeHSlider = root.querySelector("#cl-home-h");
  const homeWSlider = root.querySelector("#cl-home-w");
  const searchHSlider = root.querySelector("#cl-search-h");
  const searchWSlider = root.querySelector("#cl-search-w");
  const saveDimsBtn = root.querySelector("#custom-logo-save-dims");
  const homePreviewImg = root.querySelector("#custom-logo-home-preview-img");
  const wireLabel = (slider, valId) => {
    if (!slider) return;
    const label = root.querySelector(`#${valId}`);
    slider.addEventListener("input", () => { if (label) label.textContent = slider.value + "px"; });
  };
  wireLabel(homeHSlider, "cl-home-h-val");
  wireLabel(homeWSlider, "cl-home-w-val");
  wireLabel(searchHSlider, "cl-search-h-val");
  wireLabel(searchWSlider, "cl-search-w-val");
  if (homeHSlider && homePreviewImg) homeHSlider.addEventListener("input", () => { homePreviewImg.style.maxHeight = homeHSlider.value + "px"; });
  if (homeWSlider && homePreviewImg) homeWSlider.addEventListener("input", () => { homePreviewImg.style.maxWidth = homeWSlider.value + "px"; });
  if (searchHSlider) searchHSlider.addEventListener("input", () => { document.querySelectorAll(".custom-logo-img--search").forEach((el) => { el.style.maxHeight = searchHSlider.value + "px"; }); });
  if (searchWSlider) searchWSlider.addEventListener("input", () => { document.querySelectorAll(".custom-logo-img--search").forEach((el) => { el.style.maxWidth = searchWSlider.value + "px"; }); });
  if (saveDimsBtn) {
    saveDimsBtn.addEventListener("click", async () => {
      const dims = {
        homeMaxHeight: parseInt(homeHSlider?.value || "300", 10),
        homeMaxWidth: parseInt(homeWSlider?.value || "500", 10),
        searchMaxHeight: parseInt(searchHSlider?.value || "100", 10),
        searchMaxWidth: parseInt(searchWSlider?.value || "300", 10),
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
        _dimensionsLoaded = true;
        document.querySelectorAll(".custom-logo-img--search").forEach((el) => { el.style.maxHeight = `${_searchMaxHeight}px`; el.style.maxWidth = `${_searchMaxWidth}px`; });
        document.querySelectorAll(".custom-logo-img:not(.custom-logo-img--search)").forEach((el) => { el.style.maxHeight = `${_homeMaxHeight}px`; el.style.maxWidth = `${_homeMaxWidth}px`; });
        if (status) status.textContent = "Dimensions saved!";
      } catch {
        if (status) status.textContent = "Save failed.";
      }
    });
  }

  const store = await refreshStore();
  if (store?.images) renderGallery(root, store.images);
}

async function init(forceRefresh = false) {
  const onResultsPage = !!document.querySelector(".results-logo");
  if (!_initialized) _bootstrapLockUntil = Date.now() + 1200;
  if (onResultsPage) lockResultsLogoReveal();
  await Promise.all([loadDimensions(), loadSettings()]);
  const shouldFetch = forceRefresh || !_initialized || document.querySelectorAll(".custom-logo-img").length === 0;
  if (shouldFetch) {
    const logo = await fetchLogo(forceRefresh);
    if (logo.dataUrl) applyLogo(logo.dataUrl, _hasShownInitialIntro ? "none" : _logoIntro, { animateRotation: false, revealWhenReady: onResultsPage });
    setTimeout(() => ensureRotation(), 0);
    if (!logo.dataUrl || !_logoIntro.match(/^(matrix|fade)$/)) _searchHideStyle.remove();
    _hideStyle.remove();
    _initialized = true;
  } else {
    ensureRotation();
  }
}

function scheduleInitCheck() {
  if (_initDebounceTimer) clearTimeout(_initDebounceTimer);
  _initDebounceTimer = setTimeout(() => {
    _initDebounceTimer = null;
    const hasCustomLogo = document.querySelectorAll(".custom-logo-img").length > 0;
    const hasTargets = document.querySelector("#home-logo .logo, .results-logo");
    if (!hasCustomLogo && hasTargets && Date.now() >= _bootstrapLockUntil && !_isApplyingLogo) {
      init(false);
    }
  }, 120);
}

const obs = new MutationObserver(() => {
  document.querySelectorAll("#custom-logo-card:not([data-wired])").forEach((el) => {
    const root = el;
    root.dataset.wired = "1";
    wireResultUi(root);
  });
  scheduleInitCheck();
});
obs.observe(document.body, { childList: true, subtree: true });

init();
})();
