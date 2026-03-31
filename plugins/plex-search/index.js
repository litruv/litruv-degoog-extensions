const PLEX_PLUGIN_ID = "plugin-plex";

let plexUrl = "";
let apiKey = "";
let machineId = "";
let template = "";

const PLEX_LOGO =
  "https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@refs/heads/main/svg/plex.svg";

/**
 * @param {string} s
 * @returns {string}
 */
function escHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {string} term
 * @returns {string[]}
 */
function searchVariants(term) {
  const variants = [term];
  if (term.includes("-")) variants.push(term.replace(/-/g, " "));
  else if (/\w\s+\w/.test(term)) variants.push(term.replace(/\s+/g, "-"));
  if (term.includes(".")) variants.push(term.replace(/\./g, " "));
  if (term.includes("'")) variants.push(term.replace(/'/g, ""));
  return [...new Set(variants)];
}

const EPISODE_PATTERNS = [
  /^(.+?)\s+s(\d+)\s*e(\d+)$/i,
  /^(.+?)\s+season\s+(\d+)\s+episode\s+(\d+)$/i,
  /^(.+?)\s+season\s+(\d+)\s+ep\.?\s+(\d+)$/i,
  /^(.+?)\s+(\d+)x(\d+)$/i,
];

const SEASON_PATTERNS = [
  /^(.+?)\s+season\s+(\d+)$/i,
  /^(.+?)\s+s(\d+)$/i,
];

/**
 * @param {string} term
 * @returns {{ series: string, season: number, episode: number|null }|null}
 */
function parseEpisodeQuery(term) {
  for (const re of EPISODE_PATTERNS) {
    const m = term.match(re);
    if (m) return { series: m[1].trim(), season: parseInt(m[2], 10), episode: parseInt(m[3], 10) };
  }
  for (const re of SEASON_PATTERNS) {
    const m = term.match(re);
    if (m) return { series: m[1].trim(), season: parseInt(m[2], 10), episode: null };
  }
  return null;
}

/**
 * @param {string} ratingKey
 * @returns {string}
 */
function buildItemUrl(ratingKey) {
  if (machineId) {
    return `${plexUrl}/web/index.html#!/server/${machineId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
  }
  return plexUrl;
}

/**
 * @param {object} item
 * @returns {string}
 */
function renderItem(item) {
  const type = String(item.type || "");
  const year = item.year ? ` (${item.year})` : "";

  let subtitle = "";
  if (type === "episode") {
    const series = item.grandparentTitle || "";
    const sNum = item.parentIndex;
    const eNum = item.index;
    const parts = [];
    if (series) parts.push(series);
    if (sNum != null && eNum != null)
      parts.push(`S${String(sNum).padStart(2, "0")}E${String(eNum).padStart(2, "0")}`);
    else if (eNum != null)
      parts.push(`Episode ${eNum}`);
    if (parts.length)
      subtitle = `<div class="result-episode-context">${escHtml(parts.join(" \u2014 "))}</div>`;
  } else if (type === "season") {
    const series = item.parentTitle || item.grandparentTitle || "";
    if (series)
      subtitle = `<div class="result-episode-context">${escHtml(series)}</div>`;
  }

  const badges = `<span class="result-engine-tag">${escHtml(type)}</span><span class="result-engine-tag">Plex</span>`;

  const thumbPath = item.thumb || item.art || "";
  const thumbSrc = thumbPath
    ? `/api/proxy/image?auth_id=${PLEX_PLUGIN_ID}&url=${encodeURIComponent(`${plexUrl}${thumbPath}?X-Plex-Token=${apiKey}`)}`
    : "";
  const thumbBlock = thumbSrc
    ? `<div class="result-thumbnail-wrap"><img class="result-thumbnail-img" src="${escHtml(thumbSrc)}" alt=""></div>`
    : "";

  const data = {
    faviconSrc: PLEX_LOGO,
    cite: escHtml(plexUrl),
    itemUrl: escHtml(buildItemUrl(item.ratingKey)),
    title: escHtml(String(item.title || "")) + year,
    subtitle,
    overview: escHtml(String(item.summary || "")),
    badges,
    thumbBlock,
  };
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] ?? "");
}

/**
 * @param {Record<string, string>} headers
 */
async function fetchMachineId(headers) {
  try {
    const res = await fetch(`${plexUrl}/identity`, { headers });
    const data = await res.json();
    machineId = data?.MediaContainer?.machineIdentifier ?? "";
  } catch {
    machineId = "";
  }
}

/**
 * @param {{ series: string, season: number, episode: number|null }} epQuery
 * @param {Record<string, string>} headers
 * @param {number} limit
 * @param {number} startIndex
 * @returns {Promise<object[]>}
 */
async function findEpisode(epQuery, headers, limit, startIndex) {
  const seriesVariants = searchVariants(epQuery.series);
  const seriesFetches = seriesVariants.map((v) =>
    fetch(`${plexUrl}/search?query=${encodeURIComponent(v)}&type=2&limit=5`, { headers })
      .then((r) => r.json()),
  );
  const seriesResults = await Promise.all(seriesFetches);

  const seen = new Set();
  const allShows = [];
  for (const data of seriesResults) {
    for (const item of data?.MediaContainer?.Metadata || []) {
      if (!seen.has(item.ratingKey)) {
        seen.add(item.ratingKey);
        allShows.push(item);
      }
    }
  }
  if (allShows.length === 0) return [];

  const episodeFetches = allShows.map((show) =>
    fetch(
      `${plexUrl}/library/metadata/${show.ratingKey}/allLeaves?limit=${limit}&offset=${startIndex}`,
      { headers },
    ).then((r) => r.json()),
  );
  const episodeResults = await Promise.all(episodeFetches);

  const items = [];
  for (const data of episodeResults) {
    for (const ep of data?.MediaContainer?.Metadata || []) {
      if (epQuery.season != null && ep.parentIndex !== epQuery.season) continue;
      if (epQuery.episode != null && ep.index !== epQuery.episode) continue;
      items.push(ep);
    }
  }
  return items;
}

export default {
  name: "Plex",
  description: "Search your Plex media library",
  trigger: "plex",
  aliases: ["px"],
  settingsSchema: [
    {
      key: "url",
      label: "Plex URL",
      type: "url",
      required: true,
      placeholder: "http://192.168.1.x:32400",
      description: "Base URL of your Plex Media Server",
    },
    {
      key: "apiKey",
      label: "API Token",
      type: "password",
      secret: true,
      required: true,
      placeholder: "Enter your Plex token",
      description: "Settings → Troubleshooting → 'Show' under X-Plex-Token",
    },
  ],

  /** @param {{ template: string }} ctx */
  init(ctx) {
    template = ctx.template;
  },

  /** @param {{ url: string, apiKey: string }} settings */
  configure(settings) {
    plexUrl = (settings.url || "").replace(/\/$/, "");
    apiKey = settings.apiKey || "";
    machineId = "";
  },

  async isConfigured() {
    return !!(plexUrl && apiKey);
  },

  async execute(args, context) {
    if (!plexUrl || !apiKey) {
      return {
        title: "Plex Search",
        html: `<div class="command-result"><p>Plex is not configured. Go to <a href="/settings">Settings \u2192 Plugins</a> to set up your Plex URL and token.</p></div>`,
      };
    }

    if (!args.trim()) {
      return {
        title: "Plex Search",
        html: `<div class="command-result"><p>Usage: <code>!plex &lt;search term&gt;</code></p></div>`,
      };
    }

    try {
      const term = args.trim();
      const page = context?.page ?? 1;
      const perPage = 25;
      const startIndex = (page - 1) * perPage;

      const headers = {
        "X-Plex-Token": apiKey,
        "Accept": "application/json",
      };

      if (!machineId) await fetchMachineId(headers);

      const epQuery = parseEpisodeQuery(term);
      if (epQuery) {
        const epResults = await findEpisode(epQuery, headers, perPage, startIndex);
        if (epResults.length > 0) {
          const results = epResults.map((item) => renderItem(item)).join("");
          return {
            title: `Plex: ${term} \u2014 ${epResults.length} results`,
            html: `<div class="command-result">${results}</div>`,
          };
        }
      }

      const variants = searchVariants(term);
      const fetches = variants.map((v) =>
        fetch(
          `${plexUrl}/hubs/search?query=${encodeURIComponent(v)}&limit=${perPage}`,
          { headers },
        ).then((r) => r.json()),
      );
      const responses = await Promise.all(fetches);

      const seen = new Set();
      const allItems = [];

      for (const data of responses) {
        for (const hub of data?.MediaContainer?.Hub || []) {
          for (const item of hub.Metadata || []) {
            if (!seen.has(item.ratingKey)) {
              seen.add(item.ratingKey);
              allItems.push(item);
            }
          }
        }
      }

      if (allItems.length === 0) {
        return {
          title: "Plex Search",
          html: `<div class="command-result"><p>No results found for "${escHtml(term)}"</p></div>`,
        };
      }

      const results = allItems.map((item) => renderItem(item)).join("");
      const totalCount = allItems.length;
      const totalPages = Math.ceil(totalCount / perPage);
      const pageInfo = totalPages > 1 ? ` \u2014 Page ${page} of ${totalPages}` : "";
      return {
        title: `Plex: ${term} \u2014 ${totalCount} results${pageInfo}`,
        html: `<div class="command-result">${results}</div>`,
        totalPages,
      };
    } catch {
      return {
        title: "Plex Search",
        html: `<div class="command-result"><p>Failed to connect to Plex. Check your configuration.</p></div>`,
      };
    }
  },
};
