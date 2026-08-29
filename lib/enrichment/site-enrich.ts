/**
 * Crawls a business website once and extracts everything cheap from it: Instagram handle,
 * e-mails and published WhatsApp numbers.
 *
 * This is the replacement for the Apify `scrapeContacts` add-on, which sends correctly but
 * produced nothing on this account (see lib/apify/mappers.ts). Costs nothing but our own
 * HTTP requests, and covers the ~100 results in this database that have a real website.
 *
 * Budget discipline matches lib/enrichment/site-cnpj.ts: the worker that calls this runs
 * inside an 8s window (lib/jobs/dispatch.ts), so the crawl must stop on a clock rather
 * than on a page count. The legacy finder it replaces had no total budget — five pages at
 * a 5s timeout each could block for 25s and kill the whole worker invocation.
 */
import {
  extractEmails,
  extractInstagramHandles,
  extractWhatsappNumbers,
  pickHandleForBusiness,
} from "./html-extract";

/** Pages most likely to carry contact details, cheapest first. */
const CANDIDATE_PATHS = ["/", "/contato", "/sobre", "/contact", "/about"];
const PAGE_TIMEOUT_MS = 4_000;
const TOTAL_BUDGET_MS = 6_000;
const MAX_BYTES = 512 * 1024;
const USER_AGENT = "CRMBot/1.0 (+lead enrichment)";

export interface SiteEnrichment {
  instagramHandle: string | null;
  emails: string[];
  whatsappNumbers: string[];
  /** Pages actually fetched — useful to tell "no data" from "site unreachable". */
  pagesFetched: number;
}

const EMPTY: SiteEnrichment = {
  instagramHandle: null,
  emails: [],
  whatsappNumbers: [],
  pagesFetched: 0,
};

async function fetchPage(url: string, timeoutMs: number): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "follow",
    });
    if (!response.ok) return null;

    // Some "websites" are a PDF or an image; parsing those as HTML is pure waste.
    const contentType = response.headers.get("content-type") ?? "";
    if (!contentType.includes("html")) return null;

    const text = await response.text();
    return text.slice(0, MAX_BYTES);
  } catch {
    // DNS failure, TLS error, timeout, redirect loop — all equally "no data here".
    return null;
  }
}

/**
 * Best-effort enrichment. Never throws: a dead website is an ordinary outcome for a lead
 * list, not an error worth failing a job over.
 */
export async function enrichFromSite(params: {
  website: string;
  businessName: string;
}): Promise<SiteEnrichment> {
  let base: URL;
  try {
    base = new URL(
      params.website.startsWith("http") ? params.website : `https://${params.website}`,
    );
  } catch {
    return EMPTY;
  }

  const deadline = Date.now() + TOTAL_BUDGET_MS;
  const handles: string[] = [];
  const emails = new Set<string>();
  const whatsapps = new Set<string>();
  let pagesFetched = 0;

  for (const path of CANDIDATE_PATHS) {
    const remaining = deadline - Date.now();
    if (remaining <= 500) break;

    const url = (() => {
      try {
        return new URL(path, base).toString();
      } catch {
        return null;
      }
    })();
    if (!url) continue;

    const html = await fetchPage(url, Math.min(PAGE_TIMEOUT_MS, remaining));
    if (!html) continue;
    pagesFetched++;

    handles.push(...extractInstagramHandles(html));
    for (const email of extractEmails(html)) emails.add(email);
    for (const number of extractWhatsappNumbers(html)) whatsapps.add(number);

    // The homepage usually carries the social links; stop as soon as we have both
    // signals rather than spending budget on pages that would only confirm them.
    if (handles.length > 0 && emails.size > 0) break;
  }

  return {
    instagramHandle: pickHandleForBusiness(handles, params.businessName),
    emails: [...emails],
    whatsappNumbers: [...whatsapps],
    pagesFetched,
  };
}
