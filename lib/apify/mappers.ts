import { normalizeBrPhone } from "@/lib/enrichment/phone";

/**
 * Shape of one compass/google-maps-extractor dataset item, trimmed to the fields
 * this pipeline reads. Captured from a real run against this actor on 2026-08-20 —
 * see lib/apify/actors.ts for the measured cost notes. The actor returns many more
 * fields (openingHours, popularTimes, additionalInfo, ...); anything not listed here
 * is still preserved verbatim in the `raw` jsonb column for future use.
 */
export interface ApifyGoogleMapsItem {
  title: string;
  categoryName?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  website?: string | null;
  phone?: string | null;
  phoneUnformatted?: string | null;
  location?: { lat: number; lng: number } | null;
  totalScore?: number | null;
  reviewsCount?: number | null;
  placeId: string;
  permanentlyClosed?: boolean | null;
  temporarilyClosed?: boolean | null;
  url?: string | null; // Google Maps URL for this place
  emails?: string[];
  phones?: string[];
  instagrams?: string[]; // present when scrapeContacts is on — raw profile URLs from the site
  instagramProfiles?: Array<{
    username: string;
    followersCount?: number;
    isBusinessAccount?: boolean;
    accountVerificationStatus?: boolean;
    profileURL: string;
  }>; // present only when scrapeSocialMediaProfiles.instagrams is on (paid deep-search step)
  [key: string]: unknown;
}

function extractInstagramUsername(url: string): string | null {
  const match = url.match(/instagram\.com\/([a-zA-Z0-9_.]+)/);
  return match?.[1] ?? null;
}

/**
 * Picks one Instagram handle out of the (possibly several) profile links found while
 * crawling the business site — a site can link to a photographer's or an agency's
 * profile alongside the business's own. Without profile detail (discovery pass) we
 * can't score by follower count, so this is best-effort: prefer a username that looks
 * related to the business name, otherwise take the first link.
 */
export function pickInstagramHandle(
  instagrams: string[] | undefined,
  businessName: string,
): string | null {
  if (!instagrams || instagrams.length === 0) return null;

  const normalizedName = businessName
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, "");

  const usernames = instagrams.map(extractInstagramUsername).filter((u): u is string => !!u);
  if (usernames.length === 0) return null;

  const nameMatch = usernames.find((u) => {
    const normalizedUser = u.toLowerCase().replace(/[^a-z0-9]/g, "");
    return (
      normalizedUser.includes(normalizedName.slice(0, 6)) || normalizedName.includes(normalizedUser)
    );
  });

  return nameMatch ?? usernames[0] ?? null;
}

/**
 * Same idea but for the deep-search step, where we have real profile data
 * (followers, business-account flag) to score with instead of guessing from the URL.
 */
export function pickBestInstagramProfile(
  profiles: ApifyGoogleMapsItem["instagramProfiles"],
): NonNullable<ApifyGoogleMapsItem["instagramProfiles"]>[number] | null {
  if (!profiles || profiles.length === 0) return null;
  const business = profiles.find((p) => p.isBusinessAccount);
  if (business) return business;
  return [...profiles].sort((a, b) => (b.followersCount ?? 0) - (a.followersCount ?? 0))[0] ?? null;
}

export interface MappedApifyResult {
  placeId: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  website: string | null;
  instagramHandle: string | null;
  instagramSource: string | null;
  instagramFollowers: number | null;
  instagramVerified: boolean | null;
  category: string | null;
  rating: number | null;
  reviewsCount: number | null;
  lat: number | null;
  lng: number | null;
  email: string | null;
  emails: string[];
  phoneE164: string | null;
  phoneType: "mobile" | "landline" | "tollfree" | "unknown";
  whatsappNumber: string | null;
  whatsappStatus: "unknown" | "likely" | "verified" | "none";
  isOnGoogleMaps: boolean;
  googleMapsUrl: string | null;
  raw: Record<string, unknown>;
}

/** Maps one dataset item from the discovery run (searchStringsArray-based) into the
 *  extraction_results insert shape. Deep-search results go through mapDeepSearchItem
 *  instead, since that pass has richer Instagram data available. */
export function mapDiscoveryItem(item: ApifyGoogleMapsItem): MappedApifyResult {
  const phone = normalizeBrPhone(item.phoneUnformatted ?? item.phone);
  const bestProfile = pickBestInstagramProfile(item.instagramProfiles);
  const instagramHandle = bestProfile?.username ?? pickInstagramHandle(item.instagrams, item.title);

  return {
    placeId: item.placeId,
    name: item.title,
    address: item.address ?? null,
    city: item.city ?? null,
    state: item.state ?? null,
    phone: item.phone ?? item.phoneUnformatted ?? null,
    website: item.website ?? null,
    instagramHandle,
    instagramSource: instagramHandle ? "apify_site_crawl" : null,
    instagramFollowers: bestProfile?.followersCount ?? null,
    instagramVerified: bestProfile?.accountVerificationStatus ?? null,
    category: item.categoryName ?? null,
    rating: item.totalScore ?? null,
    reviewsCount: item.reviewsCount ?? null,
    lat: item.location?.lat ?? null,
    lng: item.location?.lng ?? null,
    email: item.emails?.[0] ?? null,
    emails: item.emails ?? [],
    phoneE164: phone.e164,
    phoneType: phone.type,
    whatsappNumber: phone.whatsappLikely ? phone.e164 : null,
    whatsappStatus: phone.e164 ? (phone.whatsappLikely ? "likely" : "none") : "unknown",
    isOnGoogleMaps: !(item.permanentlyClosed || false),
    googleMapsUrl: item.url ?? null,
    raw: item as unknown as Record<string, unknown>,
  };
}
