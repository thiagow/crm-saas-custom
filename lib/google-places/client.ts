/**
 * Google Places API (New) client.
 * Docs: https://developers.google.com/maps/documentation/places/web-service/op-overview
 *
 * Cost model (as of 2025):
 * - Text Search: $32.00 / 1000 requests
 * - Place Details (basic): $17.00 / 1000 requests
 * Total: ~$49 / 1000 unique places
 *
 * We use Text Search to get place IDs, then Place Details for full data.
 * Cache by place_id to avoid re-fetching.
 */

const PLACES_API_BASE = "https://places.googleapis.com/v1";

export interface PlaceBasic {
  id: string; // Google place_id
  name: string;
  address: string | undefined;
  city: string | undefined;
  state: string | undefined;
  phone: string | undefined;
  website: string | undefined;
  category: string | undefined;
  rating: number | undefined;
  reviewsCount: number | undefined;
  lat: number | undefined;
  lng: number | undefined;
  photoUrl: string | undefined;
  raw: Record<string, unknown>;
}

interface TextSearchResponse {
  places?: Array<{
    id: string;
    displayName?: { text: string };
    formattedAddress?: string;
    internationalPhoneNumber?: string;
    websiteUri?: string;
    primaryTypeDisplayName?: { text: string };
    rating?: number;
    userRatingCount?: number;
    location?: { latitude: number; longitude: number };
    photos?: Array<{ name: string }>;
    nextPageToken?: string;
  }>;
  nextPageToken?: string;
}

/**
 * Search for places by text query + city/state.
 * Returns up to 20 results per call (Google's max per page).
 * Use pageToken for pagination.
 */
export async function searchPlaces(params: {
  query: string;
  city: string;
  state: string;
  radiusMeters: number | undefined;
  pageToken: string | undefined;
  apiKey: string;
}): Promise<{ places: PlaceBasic[]; nextPageToken: string | undefined; costUsd: number }> {
  const { query, city, state, radiusMeters, pageToken, apiKey } = params;

  const body: Record<string, unknown> = {
    textQuery: `${query} em ${city}, ${state}, Brasil`,
    languageCode: "pt-BR",
    regionCode: "BR",
    maxResultCount: 20,
  };

  if (radiusMeters) {
    body.locationBias = {
      circle: {
        // Brazil center-ish for radius searches without a specific lat/lng
        center: { latitude: -15.7801, longitude: -47.9292 },
        radius: radiusMeters,
      },
    };
  }

  if (pageToken) {
    body.pageToken = pageToken;
  }

  const response = await fetch(`${PLACES_API_BASE}/places:searchText`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.internationalPhoneNumber",
        "places.websiteUri",
        "places.primaryTypeDisplayName",
        "places.rating",
        "places.userRatingCount",
        "places.location",
        "places.photos",
        "nextPageToken",
      ].join(","),
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Google Places API error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as TextSearchResponse;
  const places = (data.places ?? []).map((p) => parsePlaceResponse(p, city, state));

  // Text Search: $32.00 / 1000 = $0.032 per request (one request per page call)
  const costUsd = 0.032;

  const result: { places: PlaceBasic[]; nextPageToken: string | undefined; costUsd: number } = {
    places,
    nextPageToken: data.nextPageToken,
    costUsd,
  };
  return result;
}

function parsePlaceResponse(
  p: NonNullable<TextSearchResponse["places"]>[number],
  fallbackCity: string,
  fallbackState: string,
): PlaceBasic {
  // Extract city/state from formattedAddress (best effort)
  const addressParts = p.formattedAddress?.split(",").map((s) => s.trim()) ?? [];
  const city = addressParts[addressParts.length - 3] ?? fallbackCity;
  const state =
    addressParts[addressParts.length - 2]?.replace(/\s*-\s*\d+.*$/, "").trim() ?? fallbackState;

  const photoUrl = p.photos?.[0]?.name
    ? `${PLACES_API_BASE}/${p.photos[0].name}/media?maxHeightPx=400&maxWidthPx=600&key=${process.env.GOOGLE_PLACES_API_KEY ?? ""}`
    : undefined;

  return {
    id: p.id,
    name: p.displayName?.text ?? "",
    address: p.formattedAddress,
    city,
    state,
    phone: p.internationalPhoneNumber,
    website: p.websiteUri,
    category: p.primaryTypeDisplayName?.text,
    rating: p.rating,
    reviewsCount: p.userRatingCount,
    lat: p.location?.latitude,
    lng: p.location?.longitude,
    photoUrl,
    raw: p as unknown as Record<string, unknown>,
  };
}

/**
 * Estimate cost before running an extraction.
 * Based on: maxResults / 20 pages × $0.032 per Text Search call.
 */
export function estimateExtractionCost(maxResults: number): number {
  const pages = Math.ceil(maxResults / 20);
  const textSearchCost = pages * 0.032;
  return Math.round(textSearchCost * 100) / 100; // Round to 2 decimal places
}
