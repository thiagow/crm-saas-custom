/**
 * Instagram handle finder.
 * Strategy (in order, stops at first success):
 *  1. Parse the company's website HTML for instagram.com links.
 *     Checks homepage + /contato + /sobre.
 *     Extracts from: href attributes, JSON-LD sameAs, meta content tags.
 *  2. Bing Web Search API: "<name>" "<city>" site:instagram.com
 *     Requires BING_SEARCH_API_KEY env var (Azure Bing Search v7, F0 free tier).
 *
 * Returns null if nothing found — handle is optional, not blocking.
 *
 * Note: Google Custom Search API no longer supports full-web search for accounts
 * created after 2026-01-20. Replaced by Bing Web Search API.
 */

const IG_HANDLE_REGEX = /instagram\.com\/(@?[a-zA-Z0-9_.]{2,30})\/?/;

// Known generic paths that aren't real handles
const GENERIC_PATHS = new Set([
  "p",
  "reels",
  "explore",
  "stories",
  "accounts",
  "direct",
  "tv",
  "reel",
  "share",
]);

export interface InstagramResult {
  handle: string | undefined;
  source: "site_parse" | "bing_search" | undefined;
}

export async function findInstagramHandle(place: {
  name: string;
  city: string | undefined;
  website: string | undefined;
}): Promise<InstagramResult> {
  // Strategy 1: parse the website (homepage + contact/about pages)
  if (place.website) {
    const handle = await parseWebsiteForInstagram(place.website);
    if (handle) return { handle, source: "site_parse" };
  }

  // Strategy 2: Bing Web Search API (if configured)
  if (process.env.BING_SEARCH_API_KEY) {
    const handle = await bingSearchForInstagram(place.name, place.city);
    if (handle) return { handle, source: "bing_search" };
  }

  return { handle: undefined, source: undefined };
}

// ─── Strategy 1: Website parsing ────────────────────────────────────────────

async function parseWebsiteForInstagram(website: string): Promise<string | undefined> {
  const base = website.startsWith("http") ? website : `https://${website}`;

  // Try homepage first, then common contact/about paths
  const urlsToTry = [base, `${base}/contato`, `${base}/sobre`, `${base}/contact`, `${base}/about`];

  for (const url of urlsToTry) {
    const handle = await tryExtractFromUrl(url);
    if (handle) return handle;
  }

  return undefined;
}

async function tryExtractFromUrl(url: string): Promise<string | undefined> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": "Mozilla/5.0 (compatible; CRMBot/1.0)" },
    });

    if (!response.ok) return undefined;

    const html = await response.text();

    // Method 1: href attributes containing instagram.com
    const hrefHandle = extractFromHref(html);
    if (hrefHandle) return hrefHandle;

    // Method 2: JSON-LD schema.org sameAs array
    const jsonLdHandle = extractFromJsonLd(html);
    if (jsonLdHandle) return jsonLdHandle;

    // Method 3: meta content tags
    const metaHandle = extractFromMeta(html);
    if (metaHandle) return metaHandle;

    return undefined;
  } catch {
    return undefined;
  }
}

function extractFromHref(html: string): string | undefined {
  // Match href="https://instagram.com/handle" or href='https://www.instagram.com/handle'
  const hrefRegex = /href=["']https?:\/\/(?:www\.)?instagram\.com\/([a-zA-Z0-9_.]{2,30})\/?["']/g;
  let match = hrefRegex.exec(html);
  while (match) {
    const handle = match[1] ? cleanHandle(match[1]) : undefined;
    if (handle) return handle;
    match = hrefRegex.exec(html);
  }
  return undefined;
}

function extractFromJsonLd(html: string): string | undefined {
  // Find all <script type="application/ld+json"> blocks
  const scriptRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch = scriptRegex.exec(html);
  while (scriptMatch) {
    try {
      const jsonText = scriptMatch[1];
      if (!jsonText) {
        scriptMatch = scriptRegex.exec(html);
        continue;
      }
      const data = JSON.parse(jsonText) as Record<string, unknown>;
      const sameAs = data.sameAs;
      const urls: string[] = Array.isArray(sameAs)
        ? (sameAs as unknown[]).filter((s): s is string => typeof s === "string")
        : typeof sameAs === "string"
          ? [sameAs]
          : [];

      for (const url of urls) {
        const match = IG_HANDLE_REGEX.exec(url);
        const handle = match?.[1] ? cleanHandle(match[1]) : undefined;
        if (handle) return handle;
      }
    } catch {
      // Malformed JSON — skip
    }
    scriptMatch = scriptRegex.exec(html);
  }
  return undefined;
}

function extractFromMeta(html: string): string | undefined {
  // Match <meta ... content="https://instagram.com/handle" ...>
  const metaRegex = /<meta[^>]+content=["']([^"']*instagram\.com\/[^"']+)["'][^>]*>/gi;
  let match = metaRegex.exec(html);
  while (match) {
    const igMatch = IG_HANDLE_REGEX.exec(match[1] ?? "");
    const handle = igMatch?.[1] ? cleanHandle(igMatch[1]) : undefined;
    if (handle) return handle;
    match = metaRegex.exec(html);
  }
  return undefined;
}

function cleanHandle(raw: string): string | undefined {
  const handle = raw.replace(/^@/, "").toLowerCase().split("?")[0]?.split("/")[0] ?? "";
  if (handle.length < 2) return undefined;
  if (GENERIC_PATHS.has(handle)) return undefined;
  return handle;
}

// ─── Strategy 2: Bing Web Search API ────────────────────────────────────────

async function bingSearchForInstagram(name: string, city?: string): Promise<string | undefined> {
  const apiKey = process.env.BING_SEARCH_API_KEY;
  if (!apiKey) return undefined;

  try {
    const q = encodeURIComponent(`"${name}" ${city ? `"${city}"` : ""} site:instagram.com`);
    const url = `https://api.bing.microsoft.com/v7.0/search?q=${q}&count=3&mkt=pt-BR`;

    const response = await fetch(url, {
      headers: { "Ocp-Apim-Subscription-Key": apiKey },
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return undefined;

    const data = (await response.json()) as {
      webPages?: { value?: Array<{ url?: string }> };
    };

    for (const item of data.webPages?.value ?? []) {
      if (!item.url) continue;
      const match = IG_HANDLE_REGEX.exec(item.url);
      const handle = match?.[1] ? cleanHandle(match[1]) : undefined;
      if (handle) return handle;
    }

    return undefined;
  } catch {
    return undefined;
  }
}
