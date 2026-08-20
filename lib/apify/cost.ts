/**
 * Cost estimation for Apify runs. These are *estimates only* — the number that
 * actually gets billed to extractions.costUsd always comes from run.usageTotalUsd
 * (see lib/apify/client.ts getRun), read after the run finishes. Never trust the
 * estimate for accounting; it exists to warn the user before they spend money.
 *
 * Measured on this account's Apify plan (Free tier, $5/mo cap) on 2026-08-20 —
 * see lib/apify/actors.ts for the full note on why scrapeSocialMediaProfiles is
 * excluded from the automatic-extraction estimate.
 */

/** Per-place cost of discovery, with scrapeContacts included. */
const DISCOVERY_WITH_CONTACTS_USD_PER_PLACE = 0.006;
const DISCOVERY_ONLY_USD_PER_PLACE = 0.005;

/** Per social profile enriched via "pesquisa profunda" — Free-tier price, the worst case.
 *  Real cost may be much lower on a paid Apify plan; this is a safe upper-bound estimate. */
const DEEP_SEARCH_INSTAGRAM_USD_PER_PROFILE = 0.1;

export function estimateExtractionCostUsd(params: {
  maxResults: number;
  enrichContacts: boolean;
}): number {
  const perPlace = params.enrichContacts
    ? DISCOVERY_WITH_CONTACTS_USD_PER_PLACE
    : DISCOVERY_ONLY_USD_PER_PLACE;
  return Math.round(params.maxResults * perPlace * 100) / 100;
}

export function estimateDeepSearchCostUsd(
  resultCount: number,
  opts: { instagram: boolean },
): number {
  if (!opts.instagram) return 0;
  // Worst case: one Instagram profile matched per result. If none is found, the
  // actual charge will be lower — this is a ceiling shown to the user up front.
  return Math.round(resultCount * DEEP_SEARCH_INSTAGRAM_USD_PER_PROFILE * 100) / 100;
}
