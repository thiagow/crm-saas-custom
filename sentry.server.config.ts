import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  ...(dsn ? { dsn } : {}),

  enabled: process.env.NODE_ENV === "production",

  // Capture 10% of transactions
  tracesSampleRate: 0.1,

  // Don't log PII
  beforeSend(event) {
    // Strip request bodies from auth endpoints
    if (event.request?.url?.includes("/api/auth")) {
      delete event.request.data;
    }
    return event;
  },
});
