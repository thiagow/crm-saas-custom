import { createHash } from "node:crypto";
// One-off: apply 0006 statement-by-statement (drizzle-kit's CLI migrate hangs on a
// TTY spinner in this environment — see scripts/mark-migrations-applied.mjs for the
// same workaround used for 0004/0005) and register it in the tracking table.
// Run: npx tsx scripts/apply-migration-0006.ts
import { readFileSync } from "node:fs";
import postgres from "postgres";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match?.[1] && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
} catch {}

async function main() {
  const sql = postgres(process.env.DATABASE_URL as string, {
    ssl: process.env.DATABASE_SSL === "require",
  });

  const path = "db/migrations/0006_cnpj_owner_lookup.sql";
  const content = readFileSync(path, "utf8");
  const statements = content
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  console.log(`Applying ${statements.length} statements from ${path}...`);
  for (let i = 0; i < statements.length; i++) {
    process.stdout.write(`[${i}] ${statements[i]!.slice(0, 70).replace(/\n/g, " ")} ... `);
    await sql.unsafe(statements[i]!);
    console.log("OK");
  }

  const hash = createHash("sha256").update(content).digest("hex");
  const journal = JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8"));
  const entry = journal.entries.find((e: { tag: string }) => e.tag === "0006_cnpj_owner_lookup");
  if (!entry) throw new Error("0006 entry not found in journal — did generate succeed?");

  const existing = await sql`select id from drizzle.__drizzle_migrations where hash = ${hash}`;
  if (existing.length === 0) {
    await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${hash}, ${String(entry.when)})`;
    console.log("Registered in drizzle.__drizzle_migrations");
  } else {
    console.log("Already registered, skipping insert");
  }

  await sql.end();
}

main();
