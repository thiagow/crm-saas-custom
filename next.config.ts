import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

const nextConfig: NextConfig = {
  // Security headers
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "X-DNS-Prefetch-Control",
            value: "on",
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-eval' 'unsafe-inline'", // unsafe-eval/inline required by Next.js dev
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' blob: data: https://maps.gstatic.com https://maps.googleapis.com",
              "font-src 'self'",
              "connect-src 'self' https://*.sentry.io https://o*.ingest.sentry.io",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ];
  },
  // Logging
  logging: {
    fetches: {
      fullUrl: process.env.NODE_ENV === "development",
    },
  },
};

export default withSentryConfig(nextConfig, {
  // Sentry webpack plugin options
  ...(process.env.SENTRY_ORG ? { org: process.env.SENTRY_ORG } : {}),
  ...(process.env.SENTRY_PROJECT ? { project: process.env.SENTRY_PROJECT } : {}),

  // Only upload source maps in CI/prod — skip locally
  silent: !process.env.CI,

  // Disable source map upload if DSN is not set (local dev)
  sourcemaps: {
    disable: !process.env.NEXT_PUBLIC_SENTRY_DSN,
  },

  // Automatically tree-shake Sentry logger statements in production
  disableLogger: true,

  // Tunneling: route Sentry requests through your own domain
  // Avoids ad blocker interference
  tunnelRoute: "/monitoring-tunnel",
});
