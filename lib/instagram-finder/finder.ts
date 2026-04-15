/**
 * Instagram handle finder.
 * Strategy (in order, stops at first success):
 *  1. Parse the company's website HTML for instagram.com links.
 *  2. Google Custom Search API: "<name>" "<city>" site:instagram.com
 *
 * Returns null if nothing found — handle is optional, not blocking.
 */

const IG_HANDLE_REGEX = /instagram\.com\/(@?[a-zA-Z0-9_.]{2,30})\/?/;

export interface InstagramResult {
  handle: string | undefined;
  source: "site_parse" | "google_search" | undefined;
}

export async function findInstagramHandle(place: {
  name: string;
  city: string | undefined;
  website: string | undefined;
}): Promise<InstagramResult> {
  // Strategy 1: parse the website
  if (place.website) {
    const handle = await parseWebsiteForInstagram(place.website);
    if (handle) return { handle, source: "site_parse" };
  }

  // Strategy 2: Google Custom Search (if configured)
  if (process.env.GOOGLE_CUSTOM_SEARCH_API_KEY && process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID) {
    const handle = await googleSearchForInstagram(place.name, place.city);
    if (handle) return { handle, source: "google_search" };
  }

  return { handle: undefined, source: undefined };
}

async function parseWebsiteForInstagram(website: string): Promise<string | undefined> {
  try {
    // Normalize URL
    const url = website.startsWith("http") ? website : `https://${website}`;

    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000), // 5s timeout
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; CRMBot/1.0)",
      },
    });

    if (!response.ok) return undefined;

    const html = await response.text();
    const match = IG_HANDLE_REGEX.exec(html);
    if (!match?.[1]) return undefined;

    // Clean up: remove leading @ if present
    const handle = match[1].replace(/^@/, "").toLowerCase();

    // Basic sanity check: not a known generic path
    const genericPaths = ["p", "reels", "explore", "stories", "accounts", "direct"];
    if (genericPaths.includes(handle)) return undefined;

    return handle;
  } catch {
    // Network errors, timeouts, etc. — silently skip
    return undefined;
  }
}

async function googleSearchForInstagram(
  name: string,
  city?: string,
): Promise<string | undefined> {
  try {
    const q = encodeURIComponent(`"${name}" ${city ? `"${city}"` : ""} site:instagram.com`);
    const url = `https://www.googleapis.com/customsearch/v1?key=${process.env.GOOGLE_CUSTOM_SEARCH_API_KEY}&cx=${process.env.GOOGLE_CUSTOM_SEARCH_ENGINE_ID}&q=${q}&num=3`;

    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      items?: Array<{ link?: string }>;
    };

    for (const item of data.items ?? []) {
      if (!item.link) continue;
      const match = IG_HANDLE_REGEX.exec(item.link);
      if (match?.[1]) {
        return match[1].replace(/^@/, "").toLowerCase();
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
}
