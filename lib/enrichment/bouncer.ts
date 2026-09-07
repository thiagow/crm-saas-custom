/**
 * Bouncer (usebouncer.com) real-time e-mail verification — the gate before any address
 * scraped by this pipeline (site crawl, linktree, Instagram bio, CNPJ/Receita) is used in
 * an outbound cadence.
 *
 * Why this exists at all: none of the discovery sources above ever confirm the mailbox
 * actually exists — they only confirm the string looked like an e-mail somewhere on a
 * page. Sending a cadence against unverified addresses is the fastest way to spike a
 * sending domain's bounce rate and tank deliverability for every other campaign riding
 * the same domain. This is a paid check (one credit per e-mail) — it is never called
 * automatically on ingest, only on explicit user action (lib/enrichment/actions.ts).
 *
 * ⚠️ Endpoint/response shape from docs.usebouncer.com/api-reference/real-time/verify-email
 * (2026-09-07), not yet exercised against a real API key from this codebase — confirm
 * with one live call before relying on this in production, then delete this note.
 */
const API_BASE = "https://api.usebouncer.com/v1.1";

export type BouncerStatus = "deliverable" | "undeliverable" | "risky" | "unknown";

export interface BouncerResult {
  email: string;
  status: BouncerStatus;
  reason: string | null;
}

function getApiKey(): string {
  const key = process.env.BOUNCER_API_KEY;
  if (!key) throw new Error("BOUNCER_API_KEY is not set");
  return key;
}

/** Verifies one e-mail address. Never throws for a bad/nonexistent address — that's a
 *  normal "undeliverable" result, not an error. Throws only on a real API/network failure,
 *  so the caller can tell "we checked, it's bad" from "we couldn't check". */
export async function verifyEmail(email: string): Promise<BouncerResult> {
  const response = await fetch(`${API_BASE}/email/verify?email=${encodeURIComponent(email)}`, {
    method: "GET",
    headers: { "x-api-key": getApiKey() },
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Bouncer API error (${response.status}) for ${email}: ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { email: string; status: BouncerStatus; reason?: string };
  return {
    email: data.email ?? email,
    status: data.status,
    reason: data.reason ?? null,
  };
}
