/**
 * Pure phone normalization/classification for Brazilian numbers — no network calls.
 *
 * This is a heuristic, not a verification: we classify mobile vs landline from the
 * number's shape and guess WhatsApp likelihood from that. It is NOT proof the number
 * has WhatsApp — that requires an actual lookup (e.g. a WhatsApp Business API check),
 * which is intentionally out of scope for now. `whatsappStatus` never becomes
 * "verified" from this function; that value is reserved for a future real check.
 */

export type PhoneType = "mobile" | "landline" | "tollfree" | "unknown";
export type WhatsappStatus = "unknown" | "likely" | "none";

export interface NormalizedPhone {
  /** E.164 without the leading '+', e.g. "5511999998888". Null if the input couldn't be parsed as BR. */
  e164: string | null;
  type: PhoneType;
  ddd: string | null;
  whatsappLikely: boolean;
}

// Valid Brazilian area codes (ANATEL). Anything outside this set is not a real DDD.
const VALID_DDDS = new Set([
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "21",
  "22",
  "24",
  "27",
  "28",
  "31",
  "32",
  "33",
  "34",
  "35",
  "37",
  "38",
  "41",
  "42",
  "43",
  "44",
  "45",
  "46",
  "47",
  "48",
  "49",
  "51",
  "53",
  "54",
  "55",
  "61",
  "62",
  "63",
  "64",
  "65",
  "66",
  "67",
  "68",
  "69",
  "71",
  "73",
  "74",
  "75",
  "77",
  "79",
  "81",
  "82",
  "83",
  "84",
  "85",
  "86",
  "87",
  "88",
  "89",
  "91",
  "92",
  "93",
  "94",
  "95",
  "96",
  "97",
  "98",
  "99",
]);

export function normalizeBrPhone(raw: string | null | undefined): NormalizedPhone {
  const empty: NormalizedPhone = { e164: null, type: "unknown", ddd: null, whatsappLikely: false };
  if (!raw) return empty;

  const digits = raw.replace(/\D/g, "");
  if (!digits) return empty;

  // Toll-free / special numbers (0800, 0300, 0500, 0900) — never mobile.
  if (/^0(?:800|300|500|900)\d{6,7}$/.test(digits)) {
    return { e164: null, type: "tollfree", ddd: null, whatsappLikely: false };
  }

  // Strip a leading country code (55) if present, keep only the national significant number.
  let national = digits;
  if (national.length >= 12 && national.startsWith("55")) {
    national = national.slice(2);
  }
  // Drop a leading trunk '0' some sources include before the DDD (e.g. "0 11 99999-8888").
  if (national.length === 11 + 1 && national.startsWith("0")) {
    national = national.slice(1);
  }

  if (national.length !== 10 && national.length !== 11) return empty;

  const ddd = national.slice(0, 2);
  if (!VALID_DDDS.has(ddd)) return empty;

  const subscriber = national.slice(2);
  const e164 = `55${ddd}${subscriber}`;

  if (national.length === 11) {
    // 9-digit subscriber number: mobile iff the first digit is '9' (post-2012 format).
    if (subscriber[0] === "9") {
      return { e164, type: "mobile", ddd, whatsappLikely: true };
    }
    return empty; // 11-digit number that isn't a valid mobile shape — don't guess.
  }

  // 8-digit subscriber number: landline iff it starts with 2-5 (the assigned ranges).
  if (/^[2-5]/.test(subscriber)) {
    return { e164, type: "landline", ddd, whatsappLikely: false };
  }

  return empty;
}
