/**
 * Minimal Apify REST client — just what the extraction pipeline needs.
 * Docs: https://docs.apify.com/api/v2
 *
 * All calls are server-only (this module reads APIFY_TOKEN from process.env).
 * The token always goes in the Authorization header, never in the query string —
 * query strings end up in logs/proxies/error messages.
 */

const API_BASE = "https://api.apify.com/v2";

export type ApifyRunStatus =
  | "READY"
  | "RUNNING"
  | "SUCCEEDED"
  | "FAILED"
  | "ABORTING"
  | "ABORTED"
  | "TIMING-OUT"
  | "TIMED-OUT";

const TERMINAL_STATUSES: ReadonlySet<ApifyRunStatus> = new Set([
  "SUCCEEDED",
  "FAILED",
  "ABORTED",
  "TIMED-OUT",
]);

export function isTerminalRunStatus(status: ApifyRunStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** true if the caller should retry (429/5xx); false for 4xx (bad input, bad actor id, etc). */
    readonly retriable: boolean,
    readonly runId?: string,
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

function getToken(): string {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("APIFY_TOKEN is not set");
  return token;
}

async function apifyFetch(
  path: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 15_000, ...rest } = init;
  const response = await fetch(`${API_BASE}${path}`, {
    ...rest,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      ...rest.headers,
    },
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    const retriable = response.status === 429 || response.status >= 500;
    throw new ApifyError(
      `Apify API error (${response.status}) on ${path}: ${body.slice(0, 500)}`,
      response.status,
      retriable,
    );
  }

  return response;
}

export interface StartRunParams {
  /** e.g. "compass~google-maps-extractor" — '~' in place of '/' per Apify's URL convention. */
  actorId: string;
  input: Record<string, unknown>;
  memoryMbytes?: number;
  timeoutSecs?: number;
  /** Hard cap on items collected — always set this, it's the real cost ceiling. */
  maxItems?: number;
}

export interface RunInfo {
  runId: string;
  status: ApifyRunStatus;
  datasetId: string;
  usageTotalUsd: number | null;
  statusMessage: string | undefined;
}

export async function startRun(params: StartRunParams): Promise<RunInfo> {
  const { actorId, input, memoryMbytes, timeoutSecs, maxItems } = params;
  const query = new URLSearchParams();
  if (memoryMbytes) query.set("memory", String(memoryMbytes));
  if (timeoutSecs) query.set("timeout", String(timeoutSecs));
  if (maxItems) query.set("maxItems", String(maxItems));

  const response = await apifyFetch(`/acts/${actorId}/runs?${query.toString()}`, {
    method: "POST",
    body: JSON.stringify(input),
    timeoutMs: 20_000,
  });
  const { data } = (await response.json()) as {
    data: { id: string; status: ApifyRunStatus; defaultDatasetId: string; usageTotalUsd?: number };
  };

  return {
    runId: data.id,
    status: data.status,
    datasetId: data.defaultDatasetId,
    usageTotalUsd: data.usageTotalUsd ?? null,
    statusMessage: undefined,
  };
}

export async function getRun(runId: string): Promise<RunInfo> {
  const response = await apifyFetch(`/actor-runs/${runId}`, { timeoutMs: 15_000 });
  const { data } = (await response.json()) as {
    data: {
      id: string;
      status: ApifyRunStatus;
      defaultDatasetId: string;
      usageTotalUsd?: number;
      statusMessage?: string;
    };
  };

  return {
    runId: data.id,
    status: data.status,
    datasetId: data.defaultDatasetId,
    usageTotalUsd: data.usageTotalUsd ?? null,
    statusMessage: data.statusMessage,
  };
}

export async function abortRun(runId: string): Promise<void> {
  await apifyFetch(`/actor-runs/${runId}/abort`, { method: "POST", timeoutMs: 15_000 });
}

export async function listDatasetItems<T>(params: {
  datasetId: string;
  offset: number;
  limit: number;
}): Promise<{ items: T[]; total: number }> {
  const { datasetId, offset, limit } = params;
  const response = await apifyFetch(
    `/datasets/${datasetId}/items?offset=${offset}&limit=${limit}&clean=true`,
    { timeoutMs: 20_000 },
  );
  const items = (await response.json()) as T[];
  const total = Number(response.headers.get("x-apify-pagination-total") ?? items.length);
  return { items, total };
}
