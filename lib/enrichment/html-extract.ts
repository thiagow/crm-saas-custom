/**
 * Pure HTML scraping primitives — no network, no state.
 *
 * Extracted from lib/instagram-finder/finder.ts so the Apify pipeline's site crawl
 * (lib/enrichment/site-enrich.ts) and the legacy Google Places finder share one
 * implementation instead of maintaining two copies of the same regexes.
 */
import { classifyBusinessLink } from "./link-classifier";

/** Paths that appear after instagram.com/ but are never a profile. */
const GENERIC_IG_PATHS = new Set([
  "p",
  "reels",
  "reel",
  "explore",
  "stories",
  "accounts",
  "direct",
  "tv",
  "share",
  "s",
]);

const IG_URL_REGEX = /https?:\/\/(?:www\.)?instagram\.com\/(@?[a-zA-Z0-9_.]{2,30})/gi;

/** Addresses that are almost never a real business contact. */
const EMAIL_NOISE = [
  /^[^@]*@(?:example|sentry|wixpress|godaddy|squarespace)\./i,
  /@(?:sentry\.io|wix\.com|schema\.org)$/i,
  /\.(?:png|jpe?g|gif|svg|webp|css|js)$/i,
];

function cleanHandle(raw: string): string | null {
  const handle = raw.replace(/^@/, "").toLowerCase().split("?")[0]?.split("/")[0] ?? "";
  if (handle.length < 2) return null;
  if (GENERIC_IG_PATHS.has(handle)) return null;
  // A trailing-dot or all-numeric segment is far more often a file path than a handle.
  if (/^\d+$/.test(handle)) return null;
  return handle;
}

/**
 * All Instagram handles referenced anywhere in the page — href attributes, JSON-LD
 * `sameAs`, and meta tags all end up as an instagram.com URL in the raw HTML, so one
 * pass over the whole document catches every case the three separate parsers did.
 * Returned in document order, de-duplicated.
 */
export function extractInstagramHandles(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(IG_URL_REGEX)) {
    const handle = match[1] ? cleanHandle(match[1]) : null;
    if (handle) found.add(handle);
  }
  return [...found];
}

/**
 * Picks the handle most likely to belong to the business rather than to its web agency
 * or photographer — the same "does it look like the name" heuristic used for Apify's
 * contact output (lib/apify/mappers.ts), kept consistent on purpose.
 */
export function pickHandleForBusiness(handles: string[], businessName: string): string | null {
  if (handles.length === 0) return null;

  const normalizedName = businessName
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[^a-z0-9]/g, "");

  const nameMatch = handles.find((h) => {
    const normalized = h.replace(/[^a-z0-9]/g, "");
    return (
      (normalizedName.length >= 6 && normalized.includes(normalizedName.slice(0, 6))) ||
      (normalized.length >= 4 && normalizedName.includes(normalized))
    );
  });

  return nameMatch ?? handles[0] ?? null;
}

/** Business e-mails found in mailto: links and page text, noise filtered out. */
export function extractEmails(html: string): string[] {
  const found = new Set<string>();

  for (const match of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const email = match[1]?.toLowerCase();
    if (email) found.add(decodeURIComponent(email));
  }
  for (const match of html.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/g)) {
    const email = match[0]?.toLowerCase();
    if (email) found.add(email);
  }

  return [...found].filter(
    (email) => email.includes("@") && !EMAIL_NOISE.some((pattern) => pattern.test(email)),
  );
}

/** WhatsApp numbers published as wa.me / api.whatsapp.com links. */
export function extractWhatsappNumbers(html: string): string[] {
  const found = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/(?:wa\.me|api\.whatsapp\.com)\/[^"'\s<>]*/gi)) {
    const link = classifyBusinessLink(match[0]);
    if (link?.phoneE164) found.add(link.phoneE164);
  }
  return [...found];
}
