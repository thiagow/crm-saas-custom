/**
 * Classifies what a Google Maps "website" field actually points at.
 *
 * Why this exists: the `website` field on a Google Maps place is whatever the owner
 * typed into their business profile, and in Brazil that is very often *not* a website.
 * Measured against the 258 real results in this database on 2026-08-28:
 *
 *   43 × instagram.com     ← 17% of the base, silently discarded before this module
 *    7 × facebook.com
 *    3 × wa.me / api.whatsapp.com
 *    2 × linktr.ee / bio.link
 *  ~100 × an actual website
 *
 * Two consequences the product was paying for:
 *   1. Instagram handles that cost nothing to obtain were being thrown away, while the
 *      pipeline waited on a paid Apify add-on that never ran.
 *   2. The triage "Contato" column showed a wa.me link under "site", which is exactly
 *      the WhatsApp/site confusion reported by the user.
 *
 * Pure functions, no network. Safe to run over historical rows in a backfill.
 */
import { normalizeBrPhone } from "./phone";

export type BusinessLinkKind =
  | "instagram"
  | "facebook"
  | "whatsapp"
  | "linktree"
  | "youtube"
  | "tiktok"
  | "website";

export interface ClassifiedLink {
  kind: BusinessLinkKind;
  /** Original URL, normalized with a scheme. Null when the input could not be parsed. */
  url: string | null;
  /** Instagram/TikTok username, without '@'. Only set for those kinds. */
  handle: string | null;
  /** E.164 (no '+') extracted from a wa.me / api.whatsapp.com link. Only set for "whatsapp". */
  phoneE164: string | null;
}

/** Instagram path segments that are never a profile handle. */
const INSTAGRAM_RESERVED = new Set([
  "p",
  "reel",
  "reels",
  "stories",
  "explore",
  "accounts",
  "direct",
  "tv",
  "share",
  "s",
]);

const LINKTREE_HOSTS = ["linktr.ee", "linkr.bio", "bio.link", "beacons.ai", "linkbio.co"];

function parseUrl(raw: string): URL | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }
}

/** Strips "www." so host checks don't have to repeat themselves. */
function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

function firstPathSegment(url: URL): string | null {
  const segment = url.pathname.split("/").filter(Boolean)[0];
  return segment ? decodeURIComponent(segment) : null;
}

function extractInstagramHandle(url: URL): string | null {
  const segment = firstPathSegment(url);
  if (!segment) return null;
  const handle = segment.replace(/^@/, "");
  if (INSTAGRAM_RESERVED.has(handle.toLowerCase())) return null;
  // Instagram usernames: letters, digits, underscore, period; 1-30 chars.
  if (!/^[A-Za-z0-9_.]{1,30}$/.test(handle)) return null;
  return handle;
}

/**
 * Classifies one link. Returns kind "website" for anything that isn't a recognised
 * social/messaging destination — including URLs we failed to parse, so a malformed
 * value is never silently promoted into a social field.
 */
export function classifyBusinessLink(raw: string | null | undefined): ClassifiedLink | null {
  if (!raw) return null;

  const url = parseUrl(raw);
  if (!url) return { kind: "website", url: null, handle: null, phoneE164: null };

  const host = bareHost(url);
  const normalized = url.toString();
  const base: ClassifiedLink = { kind: "website", url: normalized, handle: null, phoneE164: null };

  if (host === "instagram.com" || host.endsWith(".instagram.com")) {
    return { ...base, kind: "instagram", handle: extractInstagramHandle(url) };
  }

  if (host === "facebook.com" || host.endsWith(".facebook.com") || host === "fb.com") {
    return { ...base, kind: "facebook" };
  }

  if (host === "wa.me" || host === "api.whatsapp.com" || host === "whatsapp.com") {
    // wa.me/5562999998888  |  api.whatsapp.com/send?phone=5562999998888
    const candidate = url.searchParams.get("phone") ?? firstPathSegment(url) ?? "";
    const phone = normalizeBrPhone(candidate);
    return { ...base, kind: "whatsapp", phoneE164: phone.e164 };
  }

  if (host === "tiktok.com" || host.endsWith(".tiktok.com")) {
    const segment = firstPathSegment(url);
    return { ...base, kind: "tiktok", handle: segment?.replace(/^@/, "") ?? null };
  }

  if (host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be") {
    return { ...base, kind: "youtube" };
  }

  if (LINKTREE_HOSTS.includes(host)) {
    return { ...base, kind: "linktree" };
  }

  return base;
}

export interface SocialLinks {
  facebook?: string;
  youtube?: string;
  tiktok?: string;
  linktree?: string;
}

export interface ResolvedContactLinks {
  /** Only a real website ends up here — never a social or messaging link. */
  website: string | null;
  instagramHandle: string | null;
  /** Set only when the link itself carried a usable number. */
  whatsappFromLink: string | null;
  socialLinks: SocialLinks;
}

/**
 * Resolves the single `website` value a place carries into the fields it actually
 * belongs in. Callers merge this with data from other sources — this function never
 * decides precedence, it only reports what the link is.
 */
export function resolveContactLinks(website: string | null | undefined): ResolvedContactLinks {
  const empty: ResolvedContactLinks = {
    website: null,
    instagramHandle: null,
    whatsappFromLink: null,
    socialLinks: {},
  };

  const link = classifyBusinessLink(website);
  if (!link || !link.url) return empty;

  switch (link.kind) {
    case "instagram":
      // A recognised Instagram URL whose handle we could not parse is still not a
      // website — drop it rather than mislabel it.
      return { ...empty, instagramHandle: link.handle };
    case "whatsapp":
      return { ...empty, whatsappFromLink: link.phoneE164 };
    case "facebook":
      return { ...empty, socialLinks: { facebook: link.url } };
    case "youtube":
      return { ...empty, socialLinks: { youtube: link.url } };
    case "tiktok":
      return { ...empty, socialLinks: { tiktok: link.url } };
    case "linktree":
      return { ...empty, socialLinks: { linktree: link.url } };
    default:
      return { ...empty, website: link.url };
  }
}
