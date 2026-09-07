/**
 * Resolves a "link-in-bio" page (Linktree, Beacons, bio.link, ...) into the same shape
 * enrichFromSite produces — e-mail, WhatsApp, and (when the page links out to one) a real
 * website or Instagram handle.
 *
 * Why this exists: lib/enrichment/link-classifier.ts already routes a Google Maps place's
 * `website` field into `socialLinks.linktree` when it points at one of these hosts, but
 * nothing ever fetched it — a linktree link was a dead end. For businesses with no real
 * site (the common case for salões/clínicas de estética), this page is often the *only*
 * public listing of contact info, so it's the highest-value single fetch available.
 *
 * A link-in-bio page is one page, not a small site — there's no /contato or /sobre to
 * crawl, so this fetches exactly one URL rather than walking CANDIDATE_PATHS the way
 * lib/enrichment/site-enrich.ts does.
 */
import { classifyBusinessLink } from "./link-classifier";
import { extractEmails, extractOutboundLinks, extractWhatsappNumbers } from "./html-extract";

const PAGE_TIMEOUT_MS = 5_000;
const MAX_BYTES = 512 * 1024;
const USER_AGENT = "CRMBot/1.0 (+lead enrichment)";

export interface LinktreeEnrichment {
  emails: string[];
  whatsappNumbers: string[];
  /** A real website found among the page's outbound links, if any. */
  website: string | null;
  /** An Instagram handle found among the page's outbound links, if any. */
  instagramHandle: string | null;
  fetched: boolean;
}

const EMPTY: LinktreeEnrichment = {
  emails: [],
  whatsappNumbers: [],
  website: null,
  instagramHandle: null,
  fetched: false,
};

export async function enrichFromLinktree(linktreeUrl: string): Promise<LinktreeEnrichment> {
  let url: string;
  try {
    url = new URL(linktreeUrl).toString();
  } catch {
    return EMPTY;
  }

  let html: string;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
      redirect: "follow",
    });
    if (!response.ok) return EMPTY;
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return EMPTY;
    html = (await response.text()).slice(0, MAX_BYTES);
  } catch {
    // DNS failure, TLS error, timeout — an unreachable link-in-bio page is an ordinary
    // outcome (the business may have deleted it), not an error worth surfacing.
    return EMPTY;
  }

  const emails = new Set(extractEmails(html));
  const whatsapps = new Set(extractWhatsappNumbers(html));
  let website: string | null = null;
  let instagramHandle: string | null = null;

  for (const link of extractOutboundLinks(html)) {
    const classified = classifyBusinessLink(link);
    if (!classified) continue;

    if (classified.kind === "whatsapp" && classified.phoneE164) {
      whatsapps.add(classified.phoneE164);
    } else if (classified.kind === "instagram" && classified.handle && !instagramHandle) {
      instagramHandle = classified.handle;
    } else if (classified.kind === "website" && classified.url && !website) {
      // Skip the link-in-bio platform's own asset/tracking hosts, which otherwise show
      // up as a false "website" (e.g. links back to linktr.ee itself, CDN images).
      website = classified.url;
    }
  }

  return {
    emails: [...emails],
    whatsappNumbers: [...whatsapps],
    website,
    instagramHandle,
    fetched: true,
  };
}
