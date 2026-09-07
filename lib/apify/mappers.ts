import { type SocialLinks, resolveContactLinks } from "@/lib/enrichment/link-classifier";
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
  /** True when Google offers a "Claim this business" affordance — i.e. the Google Business
   *  Profile is NOT claimed. Always present on discovery items (99/99 on 2026-08-28). */
  claimThisBusiness?: boolean | null;
  /** Present only for claimed profiles (94/94 on 2026-08-28) — corroborates the flag above. */
  businessProfileId?: string | null;
  emails?: string[];
  phones?: string[];
  /**
   * Present when the scrapeContacts add-on actually runs.
   *
   * ⚠️ On this Apify account it does not. The 2026-08-28 run sent `scrapeContacts: true`
   * (verified in the run's INPUT record) and Apify billed `contact-details-scraped: 0` —
   * no item came back with `emails` or `instagrams`. The pipeline therefore treats these
   * as a bonus, never a source of truth: Instagram and e-mail are resolved from the
   * `website` field (lib/enrichment/link-classifier.ts) and from our own site crawl
   * (lib/enrichment/site-enrich.ts). Do not delete those fallbacks on the assumption
   * that the paid add-on covers this.
   */
  instagrams?: string[];
  instagramProfiles?: Array<{
    username: string;
    followersCount?: number;
    isBusinessAccount?: boolean;
    accountVerificationStatus?: boolean;
    profileURL: string;
    /**
     * ⚠️ Field names not yet confirmed against a real run of this actor with
     * scrapeSocialMediaProfiles.instagrams on — actors.ts documents that path as built
     * but never invoked (see EXTRACTION_PIPELINE_PENDING.md #6, cut for cost reasons).
     * `biography`/`externalUrl` are the field names Apify's own Instagram scrapers
     * (apify/instagram-profile-scraper) publish; kept optional and read defensively so a
     * mismatch degrades to "no bio found" instead of a crash. Confirm with
     * scripts/test-deep-search.ts --instagram against one real result before relying on
     * this in production, then delete this note.
     */
    biography?: string;
    externalUrl?: string;
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
    .replace(/\p{Diacritic}/gu, "")
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
  gbpStatus: "claimed" | "unclaimed" | "unknown";
  businessProfileId: string | null;
  socialLinks: SocialLinks;
  raw: Record<string, unknown>;
}

/**
 * Reads the Google Business Profile claim state.
 *
 * `claimThisBusiness` is the primary signal; `businessProfileId` corroborates it. When the
 * flag is absent we fall back to the id's presence rather than guessing "claimed", so an
 * actor output change degrades to "unknown" instead of quietly mislabelling every row.
 */
export function readGbpStatus(item: {
  claimThisBusiness?: boolean | null;
  businessProfileId?: string | null;
}): "claimed" | "unclaimed" | "unknown" {
  if (typeof item.claimThisBusiness === "boolean") {
    return item.claimThisBusiness ? "unclaimed" : "claimed";
  }
  if (item.businessProfileId) return "claimed";
  return "unknown";
}

/** Maps one dataset item from the discovery run (searchStringsArray-based) into the
 *  extraction_results insert shape. Deep-search results go through mapDeepSearchItem
 *  instead, since that pass has richer Instagram data available. */
export function mapDiscoveryItem(item: ApifyGoogleMapsItem): MappedApifyResult {
  const phone = normalizeBrPhone(item.phoneUnformatted ?? item.phone);

  // The `website` field on a Maps place is whatever the owner typed — often an Instagram
  // or wa.me link rather than a site. Resolving it here is where 17% of this database's
  // Instagram handles come from, at zero cost. See lib/enrichment/link-classifier.ts.
  const links = resolveContactLinks(item.website);

  const bestProfile = pickBestInstagramProfile(item.instagramProfiles);
  const instagramFromApify =
    bestProfile?.username ?? pickInstagramHandle(item.instagrams, item.title);

  // Precedence: the deep-search profile (real follower data) beats the site-crawl link,
  // which beats the profile-field link. Whichever wins, record where it came from so a
  // later enrichment pass can tell a guess from a verified value.
  const instagramHandle = instagramFromApify ?? links.instagramHandle;
  const instagramSource = instagramFromApify
    ? "apify_contacts"
    : links.instagramHandle
      ? "maps_website_field"
      : null;

  // A wa.me link in the profile carries a number the owner published *for messaging* —
  // stronger evidence than our shape-based guess on the main phone.
  const whatsappNumber = links.whatsappFromLink ?? (phone.whatsappLikely ? phone.e164 : null);
  const whatsappStatus: MappedApifyResult["whatsappStatus"] = links.whatsappFromLink
    ? "likely"
    : phone.e164
      ? phone.whatsappLikely
        ? "likely"
        : "none"
      : "unknown";

  return {
    placeId: item.placeId,
    name: item.title,
    address: item.address ?? null,
    city: item.city ?? null,
    state: item.state ?? null,
    phone: item.phone ?? item.phoneUnformatted ?? null,
    website: links.website,
    instagramHandle,
    instagramSource,
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
    whatsappNumber,
    whatsappStatus,
    isOnGoogleMaps: !(item.permanentlyClosed || false),
    googleMapsUrl: item.url ?? null,
    gbpStatus: readGbpStatus(item),
    businessProfileId: item.businessProfileId ?? null,
    socialLinks: links.socialLinks,
    raw: item as unknown as Record<string, unknown>,
  };
}
