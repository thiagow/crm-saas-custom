import { db } from "@/lib/db/client";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET() {
  const checks: Record<string, string> = {};

  try {
    await db.execute(sql`SELECT 1`);
    checks.connection = "ok";
  } catch (e) {
    checks.connection = String(e);
    return NextResponse.json({ status: "error", checks }, { status: 503 });
  }

  const tables = [
    "users", "accounts", "sessions", "verification_tokens",
    "auth_audit_log", "rate_limit_buckets", "projects",
    "project_members", "invites",
  ];

  for (const table of tables) {
    try {
      await db.execute(sql.raw(`SELECT 1 FROM "${table}" LIMIT 1`));
      checks[table] = "ok";
    } catch (e) {
      checks[table] = String(e);
    }
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  return NextResponse.json(
    { status: allOk ? "ok" : "degraded", checks },
    { status: allOk ? 200 : 503 }
  );
}
