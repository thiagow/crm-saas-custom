import { handlers } from "@/lib/auth";
import { checkRateLimit } from "@/lib/auth/rate-limit";
import type { NextRequest } from "next/server";

function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  );
}

async function withRateLimit(req: NextRequest, handler: (req: NextRequest) => Promise<Response>) {
  const ip = getClientIp(req);
  const allowed = await checkRateLimit(`auth:${ip}`);
  if (!allowed) {
    return new Response(JSON.stringify({ error: "Too many requests" }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    });
  }
  return handler(req);
}

export function GET(req: NextRequest) {
  return withRateLimit(req, (r) => handlers.GET(r));
}

export function POST(req: NextRequest) {
  return withRateLimit(req, (r) => handlers.POST(r));
}
