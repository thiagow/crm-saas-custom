import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  ...(dsn ? { dsn } : {}),

  // Only enable in production
  enabled: process.env.NODE_ENV === "production",

  // Capture 10% of transactions for performance monitoring
  tracesSampleRate: 0.1,

  // Replay only for errors (no session replay overhead in prod)
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1.0,

  // Strip PII from breadcrumbs
  beforeBreadcrumb(breadcrumb) {
    // Don't log auth-related URLs in breadcrumbs
    if (breadcrumb.data?.["url"]?.includes("/api/auth")) {
      return null;
    }
    return breadcrumb;
  },
});
