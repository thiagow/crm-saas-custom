/**
 * CNPJ extraction, validation, and match-confidence scoring.
 * Pure functions — no network. Used to (a) find CNPJ candidates in already-crawled
 * site HTML (cheapest, highest-precision source) and (b) decide whether a candidate
 * CNPJ's registered company actually IS the place we think it is, before ever writing
 * an owner name to a lead — attributing the wrong owner is worse than finding none.
 */

const CNPJ_CANDIDATE_RE = /\b(\d{2})\.?(\d{3})\.?(\d{3})\/?(\d{4})-?(\d{2})\b/g;

/** Finds CNPJ-shaped substrings in text (e.g. a site's footer or /politica-de-privacidade
 *  page) and returns the ones that pass check-digit validation, deduplicated. */
export function extractCnpjCandidates(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(CNPJ_CANDIDATE_RE)) {
    const digits = match.slice(1, 6).join("");
    if (isValidCnpj(digits)) found.add(digits);
  }
  return [...found];
}

/** Standard CNPJ check-digit algorithm (modulo 11 with weighted sums). */
export function isValidCnpj(cnpj: string): boolean {
  const digits = cnpj.replace(/\D/g, "");
  if (digits.length !== 14) return false;
  if (/^(\d)\1{13}$/.test(digits)) return false; // all-same-digit is never valid

  const calcCheckDigit = (base: string, weights: number[]): number => {
    const sum = base
      .split("")
      .reduce((acc, digit, i) => acc + Number(digit) * (weights[i] ?? 0), 0);
    const remainder = sum % 11;
    return remainder < 2 ? 0 : 11 - remainder;
  };

  const base12 = digits.slice(0, 12);
  const d1 = calcCheckDigit(base12, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const d2 = calcCheckDigit(base12 + d1, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);

  return digits[12] === String(d1) && digits[13] === String(d2);
}

function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/\b(ltda|me|epp|eireli|s\/?a|sa|comercio|servicos|de|da|do|e)\b/g, "")
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(name: string): Set<string> {
  return new Set(normalizeCompanyName(name).split(" ").filter(Boolean));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface CnpjMatchCandidate {
  name: string;
  city: string | null;
  state: string | null;
}

export interface CnpjMatchCompany {
  razaoSocial: string;
  nomeFantasia: string | null;
  municipio: string;
  uf: string;
}

/**
 * 0..1 confidence that `company` (from a CNPJ lookup) really is `place` (from Google Maps).
 * Callers should only write ownerName/ownerEmail when this is >= 0.6 — see
 * lib/apify/job-handler.ts deep-search step. Below that, keep the candidate around
 * (e.g. in provenance/notes) but don't attribute a person to the wrong business.
 */
export function scoreCnpjMatch(place: CnpjMatchCandidate, company: CnpjMatchCompany): number {
  const placeTokens = tokenize(place.name);
  const razaoTokens = tokenize(company.razaoSocial);
  const fantasiaTokens = company.nomeFantasia ? tokenize(company.nomeFantasia) : new Set<string>();

  const nameScore = Math.max(
    jaccard(placeTokens, razaoTokens),
    jaccard(placeTokens, fantasiaTokens),
  );

  const cityMatch =
    place.city && company.municipio
      ? normalizeCompanyName(place.city) === normalizeCompanyName(company.municipio)
      : false;
  const stateMatch =
    place.state && company.uf
      ? place.state.trim().toUpperCase() === company.uf.trim().toUpperCase()
      : false;

  const score = 0.7 * nameScore + 0.2 * (cityMatch ? 1 : 0) + 0.1 * (stateMatch ? 1 : 0);
  return Math.round(score * 100) / 100;
}

export const CNPJ_MATCH_THRESHOLD = 0.6;
