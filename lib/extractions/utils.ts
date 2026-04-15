import { estimateExtractionCost } from "@/lib/google-places/client";

/**
 * Client-safe cost estimator (no "use server").
 * Called from client components before submitting an extraction form.
 */
export function estimateCost(maxResults: number): number {
  return estimateExtractionCost(maxResults);
}
