/**
 * Extracts text content from XML tag
 * @param {string} xml
 * @param {string} tag
 * @returns {string}
 */
function extractTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\/${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

/**
 * Extracts attribute from XML tag
 * @param {string} xml
 * @param {string} tag
 * @param {string} attr
 * @returns {string}
 */
function extractAttr(xml, tag, attr) {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, "i"));
  return match ? match[1] : "";
}

/**
 * Decodes HTML entities
 * @param {string} str
 * @returns {string}
 */
function decodeHtml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

/**
 * Strips HTML tags from a string
 * @param {string} html
 * @returns {string}
 */
function stripHtml(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

export const outgoingHosts = ["backend.deviantart.com"];

export const type = "images";

export default class DeviantArtEngine {
  name = "DeviantArt";

  /**
   * Search DeviantArt via RSS feed
   * @param {string} query
   * @param {number} page
   * @param {string} timeFilter
   * @param {object} context
   * @returns {Promise<Array<{title: string, url: string, snippet: string, source: string, thumbnail?: string}>>}
   */
  async executeSearch(query, page = 1, timeFilter, context) {
    if (!query || query.trim().length === 0) {
      return [];
    }

    const encodedQuery = encodeURIComponent(query.trim());
    const rssUrl = `https://backend.deviantart.com/rss.xml?q=${encodedQuery}`;
    const doFetch = context?.fetch ?? fetch;

    try {
      const response = await doFetch(rssUrl, {
        headers: {
          "User-Agent": "degoog/1.0",
        },
      });

      if (!response.ok) {
        console.error(`[DeviantArt] HTTP ${response.status}`);
        return [];
      }

      const xml = await response.text();
      const itemMatches = xml.match(/<item>([\s\S]*?)<\/item>/gi) || [];
      const results = [];

      for (const itemXml of itemMatches.slice(0, 20)) {
        const title = decodeHtml(extractTag(itemXml, "title") || "Untitled");
        const url = extractTag(itemXml, "link") || "";
        const author = decodeHtml(
          extractTag(itemXml, "media:credit") || extractTag(itemXml, "author") || "Unknown"
        );
        const description = decodeHtml(extractTag(itemXml, "description") || "");
        const thumbnail =
          extractAttr(itemXml, "media:content", "url") ||
          extractAttr(itemXml, "media:thumbnail", "url") ||
          "";
        const cleanDesc = stripHtml(description).trim();
        const snippet = cleanDesc.substring(0, 150) || `by ${author}`;

        if (url) {
          results.push({
            title: `${title} by ${author}`,
            url,
            snippet,
            source: "DeviantArt",
            thumbnail,
          });
        }
      }

      return results;
    } catch (error) {
      console.error("[DeviantArt] Search error:", error);
      return [];
    }
  }
}
