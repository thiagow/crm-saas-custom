/**
 * Actor registry + input builders.
 *
 * IDs and pricing are configurable via env because Apify actor ownership/pricing
 * changes over time — never hardcode assumptions about them elsewhere.
 *
 * Measured cost on this account's plan (Apify Free, $5/mo cap), 2026-08-20:
 *   - discovery alone:                 ~$0.005/place
 *   - discovery + scrapeContacts:      ~$0.006/place  (cheap — safe as an automatic default)
 *   - + scrapeSocialMediaProfiles:     ~$0.10 PER SOCIAL PROFILE FOUND on the Free tier
 *     (drops to ~$0.003-0.01/profile on paid tiers — 10-30x cheaper). This is NOT safe
 *     as a default; it must only run on explicit user action ("pesquisa profunda"),
 *     scoped to the specific results the user picked, with cost shown before running.
 */

export const ACTORS = {
  /** compass/google-maps-extractor — discovery + optional site-contact enrichment. */
  googleMaps: process.env.APIFY_ACTOR_MAPS ?? "compass~google-maps-extractor",
} as const;

export interface DiscoveryInputParams {
  query: string;
  city: string;
  state: string;
  maxResults: number;
  /** Automatic layer: crawls the business website for emails/socials/CNPJ. Cheap. */
  enrichContacts: boolean;
}

export function buildDiscoveryInput(params: DiscoveryInputParams): Record<string, unknown> {
  const { query, city, state, maxResults, enrichContacts } = params;
  return {
    searchStringsArray: [query],
    locationQuery: `${city}, ${state}, Brazil`,
    maxCrawledPlacesPerSearch: maxResults,
    language: "pt-BR",
    countryCode: "br",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: false,
    scrapeContacts: enrichContacts,
  };
}

export interface DeepSearchInputParams {
  /** Google Maps place_id of a single, already-discovered result. */
  placeId: string;
  /** Fetch detailed Instagram profile data (followers, verified, bio) — the expensive add-on. */
  instagram: boolean;
}

/**
 * Scopes the same actor to exactly one place via the `place_id:` search-term syntax,
 * so "pesquisa profunda" reuses the discovery actor instead of a second integration.
 */
export function buildDeepSearchInput(params: DeepSearchInputParams): Record<string, unknown> {
  const { placeId, instagram } = params;
  return {
    searchStringsArray: [`place_id:${placeId}`],
    language: "pt-BR",
    countryCode: "br",
    scrapePlaceDetailPage: false,
    scrapeContacts: true,
    scrapeSocialMediaProfiles: {
      instagrams: instagram,
      facebooks: false,
      youtubes: false,
      tiktoks: false,
      twitters: false,
    },
  };
}
