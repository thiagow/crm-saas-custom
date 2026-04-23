import * as Sentry from "@sentry/nextjs";

export const onRequestError = Sentry.captureRequestError;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");

    if (process.env.NODE_ENV === "development") {
      const { startDevWorker } = await import("./lib/jobs/dev-worker");
      await startDevWorker().catch((err) =>
        console.error("[dev-worker] failed to start:", err),
      );
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}
