import { estimateExtractionCostUsd } from "@/lib/apify/cost";

/**
 * Client-safe cost estimator (no "use server").
 * Called from client components before submitting an extraction form.
 * Apify is the primary provider now — see lib/apify/cost.ts for the measured basis.
 */
export function estimateCost(maxResults: number, enrichContacts = true): number {
  return estimateExtractionCostUsd({ maxResults, enrichContacts });
}
