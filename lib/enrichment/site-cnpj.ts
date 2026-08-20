import { extractCnpjCandidates } from "./cnpj";

const CANDIDATE_PATHS = ["/", "/politica-de-privacidade", "/termos", "/contato", "/sobre"];
const PAGE_TIMEOUT_MS = 4_000;
const TOTAL_BUDGET_MS = 10_000;
const USER_AGENT = "CRMBot/1.0 (+lead enrichment)";

/** Crawls a handful of common pages on a business site looking for a CNPJ — Brazilian
 *  sites very commonly print it in the footer or /politica-de-privacidade. Cheap (no
 *  paid API) and high-precision once a match passes scoreCnpjMatch. Best-effort: stops
 *  as soon as the total time budget is spent, returns whatever candidates it found. */
export async function findCnpjCandidatesOnSite(website: string): Promise<string[]> {
  let base: URL;
  try {
    base = new URL(website.startsWith("http") ? website : `https://${website}`);
  } catch {
    return [];
  }

  const found = new Set<string>();
  const deadline = Date.now() + TOTAL_BUDGET_MS;

  for (const path of CANDIDATE_PATHS) {
    if (Date.now() >= deadline) break;
    try {
      const url = new URL(path, base).toString();
      const response = await fetch(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: AbortSignal.timeout(
          Math.min(PAGE_TIMEOUT_MS, Math.max(deadline - Date.now(), 500)),
        ),
      });
      if (!response.ok) continue;
      const html = await response.text();
      for (const candidate of extractCnpjCandidates(html)) found.add(candidate);
    } catch {
      // Unreachable page, timeout, bad TLS, whatever — just skip it, this is best-effort.
    }
    if (found.size > 0) break; // stop at the first page that yields a valid CNPJ
  }

  return [...found];
}
