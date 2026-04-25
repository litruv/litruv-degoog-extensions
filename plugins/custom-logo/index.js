import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { join } from "path";

const DATA_DIR = join(process.cwd(), "data", "custom-logo");
const LOGO_PATH = join(DATA_DIR, "logo.dat");

/**
 * @returns {Promise<string|null>} Base64 data URL or null
 */
const _load = async () => {
  try {
    return await readFile(LOGO_PATH, "utf-8");
  } catch {
    return null;
  }
};

/**
 * @param {string} dataUrl
 */
const _save = async (dataUrl) => {
  await mkdir(DATA_DIR, { recursive: true });
  await writeFile(LOGO_PATH, dataUrl, "utf-8");
};

export default {
  name: "Custom Logo",
  description: "Replace the degoog logo with your own image. Use !logo in the search bar to upload.",
  trigger: "logo",

  settingsSchema: [
    {
      key: "homeLogoMaxHeight",
      label: "Home page logo max height (px)",
      type: "number",
      default: "300",
      description: "Maximum height of the custom logo on the home page.",
    },
    {
      key: "homeLogoMaxWidth",
      label: "Home page logo max width (px)",
      type: "number",
      default: "500",
      description: "Maximum width of the custom logo on the home page.",
    },
    {
      key: "searchLogoMaxHeight",
      label: "Search page logo max height (px)",
      type: "number",
      default: "100",
      description: "Maximum height of the custom logo on search results pages.",
    },
    {
      key: "searchLogoMaxWidth",
      label: "Search page logo max width (px)",
      type: "number",
      default: "300",
      description: "Maximum width of the custom logo on search results pages.",
    },
  ],

  async execute() {
    const current = await _load();
    const previewHtml = current
      ? `<img id="custom-logo-preview" src="${current}" alt="Current logo" style="max-height:80px;max-width:280px;object-fit:contain;display:block;border-radius:6px;border:1px solid rgba(255,255,255,0.1);padding:4px 8px;background:rgba(0,0,0,0.2);margin-bottom:10px;" />`
      : `<p id="custom-logo-nologo" style="font-size:0.82rem;color:var(--text-secondary);font-style:italic;margin:0 0 10px;">No custom logo set.</p>`;
    return {
      title: "Custom Logo",
      html: `
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:10px;">
          ${previewHtml}
          <div style="display:flex;gap:8px;align-items:center;">
            <label style="display:inline-flex;align-items:center;padding:6px 14px;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;border:1px solid rgba(255,255,255,0.15);background:var(--bg-secondary,#1e1e2e);color:var(--text-primary,#cdd6f4);">
              Upload image
              <input id="custom-logo-file" type="file" accept="image/*" style="display:none;" />
            </label>
            <button id="custom-logo-remove" style="display:inline-flex;align-items:center;padding:6px 14px;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;border:1px solid rgba(243,139,168,0.25);background:var(--bg-secondary,#1e1e2e);color:var(--danger,#f38ba8);">
              Remove
            </button>
          </div>
          <p id="custom-logo-status" style="font-size:0.78rem;color:var(--text-secondary);margin:0;"></p>
        </div>`,
    };
  },

  routes: [
    {
      method: "get",
      path: "/logo",
      handler: async () => {
        const data = await _load();
        return new Response(JSON.stringify({ dataUrl: data ?? null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
    {
      method: "post",
      path: "/logo",
      handler: async (req) => {
        let body;
        try {
          body = await req.json();
        } catch {
          return new Response(JSON.stringify({ error: "Invalid JSON" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const { dataUrl } = body ?? {};

        if (dataUrl === null || dataUrl === "") {
          try { await unlink(LOGO_PATH); } catch {}
          return new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
          return new Response(JSON.stringify({ error: "Invalid image data" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        const MAX_BYTES = 2 * 1024 * 1024;
        if (dataUrl.length > MAX_BYTES * 1.37) {
          return new Response(JSON.stringify({ error: "Image too large (max 2 MB)" }), {
            status: 413,
            headers: { "Content-Type": "application/json" },
          });
        }

        await _save(dataUrl);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    },
  ],
};
