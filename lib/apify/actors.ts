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

import type { ExtractionFilters } from "@/db/schema/extractions";

export const ACTORS = {
  /** compass/google-maps-extractor — discovery + optional site-contact enrichment. */
  googleMaps: process.env.APIFY_ACTOR_MAPS ?? "compass~google-maps-extractor",
} as const;

export interface DiscoveryInputParams {
  query: string;
  city: string;
  state: string;
  maxResults: number;
  /**
   * Automatic layer: asks Apify to crawl the business website for emails/socials.
   *
   * ⚠️ Measured on 2026-08-28: sending `true` billed `contact-details-scraped: 0` and
   * returned no contact fields on any of 99 items. It stays on because it costs nothing
   * when it doesn't run, but nothing in the pipeline depends on it — see the note on
   * `instagrams` in lib/apify/mappers.ts.
   */
  enrichContacts: boolean;
  /** Search-space partition axes — see ExtractionFilters in db/schema/extractions.ts. */
  filters?: ExtractionFilters;
}

export function buildDiscoveryInput(params: DiscoveryInputParams): Record<string, unknown> {
  const { query, city, state, maxResults, enrichContacts, filters = {} } = params;

  // postalCode narrows the area on its own and Apify explicitly warns against combining
  // it with a city — so it replaces the location query rather than adding to it.
  const location = filters.postalCode
    ? { postalCode: filters.postalCode, countryCode: "br" }
    : { locationQuery: `${city}, ${state}, Brazil`, countryCode: "br" };

  return {
    searchStringsArray: [query],
    ...location,
    maxCrawledPlacesPerSearch: maxResults,
    language: "pt-BR",
    skipClosedPlaces: true,
    scrapePlaceDetailPage: false,
    scrapeContacts: enrichContacts,
    website: filters.websiteFilter ?? "allPlaces",
    placeMinimumStars: filters.minStars ?? "",
    searchMatching: filters.searchMatching ?? "all",
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
