import { readFile, writeFile, mkdir, unlink, rename } from "fs/promises";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data", "custom-logo");
const LOGO_PATH = join(DATA_DIR, "logo.dat");
const STORE_PATH = join(DATA_DIR, "logos.json");
const DIMS_PATH = join(DATA_DIR, "dimensions.json");

const MAX_IMAGES = 32;
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const MAX_DATA_URL_CHARS = Math.ceil(MAX_IMAGE_BYTES * 1.37);
const MAX_NAME_LENGTH = 120;
const MIN_INTERVAL_SEC = 1;
const MAX_INTERVAL_SEC = 86400;

const DEFAULT_DIMS = {
  homeMaxHeight: 300,
  homeMaxWidth: 500,
  searchMaxHeight: 100,
  searchMaxWidth: 300,
};

const DEFAULT_STORE = {
  images: [],
  rotationMode: "reload",
  intervalSec: 60,
  randomize: true,
  lastIndex: -1,
};

const VALID_ROTATION_MODES = ["reload", "interval"];
const VALID_IMAGE_TYPES = new Set(["png", "jpeg", "jpg", "gif", "webp", "svg+xml"]);
const DATA_URL_RE = /^data:image\/([a-z+]+);base64,([A-Za-z0-9+/=]+)$/;

let hideLogoManagement = false;
let logoIntro = "none";
let settingsLoaded = false;
let storeWriteQueue = Promise.resolve();

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const escapeHtml = (value) =>
  String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const sanitizeName = (name) => {
  const trimmed = String(name || "image")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, MAX_NAME_LENGTH);
  return trimmed || "image";
};

const isValidDataUrl = (dataUrl) => {
  if (typeof dataUrl !== "string" || dataUrl.length > MAX_DATA_URL_CHARS) return false;
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return false;
  return VALID_IMAGE_TYPES.has(match[1]);
};

const clampInterval = (value, fallback = DEFAULT_STORE.intervalSec) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_INTERVAL_SEC, Math.max(MIN_INTERVAL_SEC, Math.floor(n)));
};

const withStoreLock = (fn) => {
  const run = storeWriteQueue.then(fn, fn);
  storeWriteQueue = run.catch(() => {});
  return run;
};

async function loadLegacySingle() {
  try {
    const data = await readFile(LOGO_PATH, "utf-8");
    if (typeof data === "string" && data.startsWith("data:image") && data.length <= MAX_DATA_URL_CHARS) {
      return {
        id: uid(),
        name: "legacy-logo",
        dataUrl: data,
      };
    }
  } catch {
    // legacy file missing
  }
  return null;
}

function normalizeStore(parsed) {
  return {
    ...DEFAULT_STORE,
    ...parsed,
    images: Array.isArray(parsed?.images)
      ? parsed.images
          .filter((img) => typeof img?.id === "string" && isValidDataUrl(img?.dataUrl))
          .slice(0, MAX_IMAGES)
          .map((img) => ({
            id: img.id,
            name: sanitizeName(img.name),
            dataUrl: img.dataUrl,
          }))
      : [],
    rotationMode: VALID_ROTATION_MODES.includes(parsed?.rotationMode)
      ? parsed.rotationMode
      : DEFAULT_STORE.rotationMode,
    intervalSec: clampInterval(parsed?.intervalSec),
    randomize: parsed?.randomize !== false,
    lastIndex: Number.isInteger(parsed?.lastIndex) ? parsed.lastIndex : -1,
  };
}

async function loadStore() {
  try {
    const raw = await readFile(STORE_PATH, "utf-8");
    return normalizeStore(JSON.parse(raw));
  } catch {
    const legacy = await loadLegacySingle();
    if (legacy) {
      const store = { ...DEFAULT_STORE, images: [legacy] };
      await saveStore(store);
      return store;
    }
    return { ...DEFAULT_STORE };
  }
}

async function saveStore(store) {
  const normalized = normalizeStore(store);
  await mkdir(DATA_DIR, { recursive: true });
  const tmpPath = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(tmpPath, JSON.stringify(normalized), "utf-8");
  await rename(tmpPath, STORE_PATH);
  try {
    await unlink(LOGO_PATH);
  } catch {
    // legacy file already removed
  }
  return normalized;
}

async function loadDimensions() {
  try {
    const raw = await readFile(DIMS_PATH, "utf-8");
    return { ...DEFAULT_DIMS, ...JSON.parse(raw) };
  } catch {
    return { ...DEFAULT_DIMS };
  }
}

async function saveDimensions(dims) {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(DIMS_PATH, JSON.stringify(dims), "utf-8");
}

const pickNextImage = (store) => {
  const imgs = store.images || [];
  if (!imgs.length) return { dataUrl: null, nextStore: store };
  if (imgs.length === 1) {
    return { dataUrl: imgs[0].dataUrl, nextStore: { ...store, lastIndex: 0 } };
  }

  let index = 0;
  if (store.randomize) {
    const candidates = imgs.map((_, i) => i).filter((i) => i !== store.lastIndex);
    index = candidates[Math.floor(Math.random() * candidates.length)];
  } else {
    index = (store.lastIndex + 1 + imgs.length) % imgs.length;
  }

  return {
    dataUrl: imgs[index].dataUrl,
    nextStore: { ...store, lastIndex: index },
  };
};

const loadSettings = async () => {
  if (settingsLoaded) return;
  settingsLoaded = true;
  try {
    const settingsPath = join(process.cwd(), "data", "plugin-settings.json");
    const raw = await readFile(settingsPath, "utf-8");
    const allSettings = JSON.parse(raw);
    const pluginSettings = allSettings?.["plugin-custom-logo"];
    if (pluginSettings) {
      const val = pluginSettings.hideLogoManagement;
      hideLogoManagement = val === true || val === "true";
      const validIntros = ["none", "fade", "matrix"];
      logoIntro = validIntros.includes(pluginSettings.logoIntro) ? pluginSettings.logoIntro : "none";
    }
  } catch {
    // settings file missing
  }
};

loadSettings().catch(() => {});

const cardHtml = async () => {
  const [store, dims] = await Promise.all([loadStore(), loadDimensions()]);
  const current = store.images?.[0]?.dataUrl ?? null;
  const { homeMaxHeight, homeMaxWidth, searchMaxHeight, searchMaxWidth } = dims;
  const previewHtml = current
    ? `<img id="custom-logo-preview" src="${current}" alt="Current logo" style="max-height:80px;max-width:220px;object-fit:contain;display:block;border-radius:6px;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;background:rgba(0,0,0,0.2);" />`
    : `<p id="custom-logo-nologo" style="font-size:0.82rem;color:var(--text-secondary);font-style:italic;margin:0;">No custom logo set.</p>`;
  const homePreviewImg = current
    ? `<img id="custom-logo-home-preview-img" src="${current}" alt="Home logo preview" style="max-height:${homeMaxHeight}px;max-width:${homeMaxWidth}px;object-fit:contain;display:block;" />`
    : `<img id="custom-logo-home-preview-img" src="" alt="Home logo preview" style="max-height:${homeMaxHeight}px;max-width:${homeMaxWidth}px;object-fit:contain;display:none;" />`;
  const gallery = (store.images || []).length
    ? store.images
        .map(
          (img) => `
      <div class="custom-logo-gallery-item" data-logo-id="${escapeHtml(img.id)}">
        <img src="${img.dataUrl}" alt="${escapeHtml(img.name)}" class="custom-logo-gallery-thumb" />
        <div class="custom-logo-gallery-meta">
          <span class="custom-logo-gallery-name">${escapeHtml(img.name)}</span>
          <button type="button" class="custom-logo-btn custom-logo-btn--remove custom-logo-remove-item" data-logo-id="${escapeHtml(img.id)}">Remove</button>
        </div>
      </div>`
        )
        .join("")
    : `<p class="custom-logo-none" id="custom-logo-gallery-empty">No images added yet.</p>`;

  const checkedReload = store.rotationMode === "reload" ? "checked" : "";
  const checkedInterval = store.rotationMode === "interval" ? "checked" : "";
  const checkedRandom = store.randomize ? "checked" : "";
  const checkedSequential = !store.randomize ? "checked" : "";

  const sliderRow = (id, label, min, max, value) => `
    <div style="display:flex;align-items:center;gap:8px;">
      <span style="font-size:0.78rem;color:var(--text-secondary);min-width:110px;">${label}</span>
      <input id="${id}" type="range" min="${min}" max="${max}" value="${value}" style="flex:1;accent-color:var(--accent,#cba6f7);" />
      <span id="${id}-val" style="font-size:0.78rem;min-width:44px;text-align:right;">${value}px</span>
    </div>`;

  return {
    title: "Custom Logo",
    html: `
      <div id="custom-logo-card" style="padding:14px 16px;display:flex;flex-direction:column;gap:12px;">
        <div style="background:rgba(0,0,0,0.15);border-radius:8px;padding:20px 16px 24px;display:flex;flex-direction:column;align-items:center;gap:18px;">
          <span style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);align-self:flex-start;">Home page preview</span>
          ${homePreviewImg}
          <div style="width:100%;max-width:584px;display:flex;flex-direction:column;align-items:stretch;gap:18px;">
            <div style="display:flex;align-items:center;width:100%;border-radius:24px;border:1px solid rgba(255,255,255,0.15);background:var(--bg-secondary,#1e1e2e);padding:10px 16px;gap:12px;">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.4;flex-shrink:0;"><circle cx="11" cy="11" r="8"></circle><path d="M21 21l-4.35-4.35"></path></svg>
              <span style="flex:1;font-size:0.95rem;color:var(--text-secondary);user-select:none;"></span>
            </div>
            <div style="display:flex;gap:11px;justify-content:center;">
              <span style="padding:10px 20px;border-radius:4px;font-size:0.875rem;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid rgba(255,255,255,0.1);user-select:none;font-weight:500;">degoog Search</span>
              <span style="padding:10px 20px;border-radius:4px;font-size:0.875rem;background:rgba(255,255,255,0.05);color:var(--text-primary);border:1px solid rgba(255,255,255,0.1);user-select:none;font-weight:500;">I'm Feeling Lucky</span>
            </div>
          </div>
        </div>

        <div style="display:flex;align-items:flex-start;gap:10px;">${previewHtml}</div>

        <div class="custom-logo-upload-ui">
          <div class="custom-logo-actions">
            <label class="custom-logo-btn">Add image(s)
              <input id="custom-logo-file" type="file" accept="image/*" multiple style="display:none;" />
            </label>
            <button id="custom-logo-remove-all" type="button" class="custom-logo-btn custom-logo-btn--remove">Remove all</button>
          </div>
          <div id="custom-logo-gallery" class="custom-logo-gallery">${gallery}</div>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Rotation</span>
          <label><input type="radio" name="cl-rotation-mode" value="reload" ${checkedReload}> Change on page reload</label>
          <label><input type="radio" name="cl-rotation-mode" value="interval" ${checkedInterval}> Change every interval</label>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:0.78rem;color:var(--text-secondary);min-width:110px;">Interval (sec)</span>
            <input id="cl-interval-sec" type="number" min="${MIN_INTERVAL_SEC}" max="${MAX_INTERVAL_SEC}" step="1" value="${store.intervalSec}" style="width:100px;background:var(--search-bar-bg);color:var(--text-primary,#cdd6f4);border:1px solid var(--border-light, rgba(255,255,255,0.15));border-radius:6px;padding:6px 8px;" />
          </div>
          <label><input type="radio" name="cl-random-mode" value="random" ${checkedRandom}> Random</label>
          <label><input type="radio" name="cl-random-mode" value="sequential" ${checkedSequential}> Sequential</label>
          <button id="custom-logo-save-rotation" type="button" class="custom-logo-btn" style="align-self:flex-start;">Save rotation</button>
        </div>

        <div style="display:flex;flex-direction:column;gap:8px;padding-top:8px;border-top:1px solid rgba(255,255,255,0.08);">
          <span style="font-size:0.7rem;font-weight:600;text-transform:uppercase;letter-spacing:0.05em;color:var(--text-secondary);">Dimensions</span>
          ${sliderRow("cl-home-h", "Home height", 20, 600, homeMaxHeight)}
          ${sliderRow("cl-home-w", "Home width", 50, 1200, homeMaxWidth)}
          ${sliderRow("cl-search-h", "Search height", 20, 300, searchMaxHeight)}
          ${sliderRow("cl-search-w", "Search width", 50, 600, searchMaxWidth)}
          <button id="custom-logo-save-dims" style="align-self:flex-start;margin-top:2px;padding:5px 14px;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:var(--bg-secondary,#1e1e2e);color:var(--text-primary,#cdd6f4);">Save dimensions</button>
        </div>

        <p id="custom-logo-status" style="font-size:0.78rem;color:var(--text-secondary);margin:0;"></p>
      </div>`,
  };
};

export default {
  name: "Custom Logo",
  description: "Replace the degoog logo with your own image(s). Use !logo in the search bar to manage them.",
  trigger: "logo",
  isClientExposed: false,
  settingsSchema: [
    {
      key: "hideLogoManagement",
      label: "Hide logo management",
      type: "toggle",
      default: false,
      description: "Prevent users from uploading or changing the logo (useful for public instances).",
    },
    {
      key: "logoIntro",
      label: "Logo intro animation",
      type: "select",
      options: ["none", "fade", "matrix"],
      default: "none",
      description: "Canvas animation played when the custom logo first appears on the page.",
    },
  ],
  configure(settings) {
    const val = settings?.hideLogoManagement;
    hideLogoManagement = val === true || val === "true";
    const validIntros = ["none", "fade", "matrix"];
    logoIntro = validIntros.includes(settings?.logoIntro) ? settings.logoIntro : "none";
    settingsLoaded = true;
  },
  async execute() {
    await loadSettings();
    if (hideLogoManagement) {
      return {
        title: "Custom Logo",
        html: `<div id="custom-logo-card" style="padding:20px 16px;display:flex;flex-direction:column;align-items:center;gap:12px;"><svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="opacity:0.3;"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg><p style="font-size:0.9rem;color:var(--text-secondary);margin:0;text-align:center;">Logo management is disabled on this instance.</p></div>`,
      };
    }
    return await cardHtml();
  },
  routes: [
    {
      method: "get",
      path: "/settings",
      handler: async () => {
        await loadSettings();
        return json({ hideLogoManagement, logoIntro });
      },
    },
    {
      method: "get",
      path: "/logo",
      handler: async () => {
        return withStoreLock(async () => {
          const store = await loadStore();
          const { dataUrl, nextStore } = pickNextImage(store);
          if (nextStore.lastIndex !== store.lastIndex) await saveStore(nextStore);
          return json({
            dataUrl,
            rotationMode: store.rotationMode,
            intervalSec: store.intervalSec,
            randomize: store.randomize,
          });
        });
      },
    },
    {
      method: "get",
      path: "/logos",
      handler: async () => {
        const store = await loadStore();
        return json({
          images: store.images,
          rotationMode: store.rotationMode,
          intervalSec: store.intervalSec,
          randomize: store.randomize,
        });
      },
    },
    {
      method: "post",
      path: "/logos",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return json({ error: "Logo management is disabled" }, 403);

        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const images = Array.isArray(body?.images) ? body.images : [];
        const valid = [];
        for (const img of images) {
          const dataUrl = img?.dataUrl;
          if (!isValidDataUrl(dataUrl)) continue;
          valid.push({ id: uid(), name: sanitizeName(img?.name), dataUrl });
        }
        if (!valid.length) return json({ error: "No valid images provided" }, 400);

        return withStoreLock(async () => {
          const store = await loadStore();
          if (store.images.length + valid.length > MAX_IMAGES) {
            return json({ error: `Maximum ${MAX_IMAGES} images allowed` }, 400);
          }
          store.images = [...store.images, ...valid];
          const saved = await saveStore(store);
          return json({ ok: true, images: saved.images });
        });
      },
    },
    {
      method: "post",
      path: "/logos/remove",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return json({ error: "Logo management is disabled" }, 403);

        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const id = body?.id;
        if (typeof id !== "string" || !id) return json({ error: "Invalid id" }, 400);

        return withStoreLock(async () => {
          const store = await loadStore();
          const before = store.images.length;
          store.images = store.images.filter((img) => img.id !== id);
          if (store.images.length === before) return json({ error: "Image not found" }, 404);
          if (!store.images.length) store.lastIndex = -1;
          else if (store.lastIndex >= store.images.length) store.lastIndex = 0;
          const saved = await saveStore(store);
          return json({ ok: true, images: saved.images });
        });
      },
    },
    {
      method: "post",
      path: "/logos/clear",
      handler: async () => {
        await loadSettings();
        if (hideLogoManagement) return json({ error: "Logo management is disabled" }, 403);

        return withStoreLock(async () => {
          const saved = await saveStore({ ...DEFAULT_STORE });
          return json({ ok: true, images: saved.images });
        });
      },
    },
    {
      method: "post",
      path: "/rotation-settings",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return json({ error: "Logo management is disabled" }, 403);

        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        return withStoreLock(async () => {
          const store = await loadStore();
          store.rotationMode = VALID_ROTATION_MODES.includes(body?.rotationMode)
            ? body.rotationMode
            : store.rotationMode;
          store.intervalSec = clampInterval(body?.intervalSec, store.intervalSec);
          store.randomize = body?.randomize !== false;
          const saved = await saveStore(store);
          return json({
            ok: true,
            store: {
              rotationMode: saved.rotationMode,
              intervalSec: saved.intervalSec,
              randomize: saved.randomize,
            },
          });
        });
      },
    },
    {
      method: "get",
      path: "/dimensions",
      handler: async () => json(await loadDimensions()),
    },
    {
      method: "post",
      path: "/dimensions",
      handler: async (req) => {
        await loadSettings();
        if (hideLogoManagement) return json({ error: "Dimension management is disabled" }, 403);

        let body;
        try {
          body = await req.json();
        } catch {
          return json({ error: "Invalid JSON" }, 400);
        }

        const n = (v, fb) => {
          const x = parseInt(v, 10);
          return !isNaN(x) && x > 0 ? x : fb;
        };
        const dims = {
          homeMaxHeight: n(body?.homeMaxHeight, 300),
          homeMaxWidth: n(body?.homeMaxWidth, 500),
          searchMaxHeight: n(body?.searchMaxHeight, 100),
          searchMaxWidth: n(body?.searchMaxWidth, 300),
        };
        await saveDimensions(dims);
        return json({ ok: true });
      },
    },
  ],
};
