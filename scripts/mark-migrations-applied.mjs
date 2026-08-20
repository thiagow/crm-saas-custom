// One-off script: registers migrations 0004 and 0005 in Drizzle's tracking table.
// Their DDL was already applied manually (statement-by-statement) during development —
// this just tells `drizzle-kit migrate` not to try applying them again.
// Run: node scripts/mark-migrations-applied.mjs
import { readFileSync } from "node:fs";
import postgres from "postgres";

// Minimal .env.local loader — avoids depending on the `dotenv` package, which isn't
// installed in this repo. Only reads DATABASE_URL/DATABASE_SSL, doesn't overwrite
// anything already set in the real environment.
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
} catch {
  // .env.local missing — fine if DATABASE_URL is already set in the real environment.
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is required (check .env.local)");

const sql = postgres(DATABASE_URL, { ssl: process.env.DATABASE_SSL === "require" });

const entries = [
  {
    hash: "1af831c6dfb194488a926e8e106c2f6054d4b925fdfe4eb0bae755c25b8f36a2",
    created_at: "1787196394292",
    tag: "0004_indexes_and_dedup",
  },
  {
    hash: "efa1860ecda644e09b67ce3d0503a4267fc528c42bd8c995b50445c2046e18ab",
    created_at: "1787197486890",
    tag: "0005_apify_enrichment_fields",
  },
];

for (const e of entries) {
  const existing = await sql`select id from drizzle.__drizzle_migrations where hash = ${e.hash}`;
  if (existing.length > 0) {
    console.log(`${e.tag}: already registered (id ${existing[0].id}), skipping`);
    continue;
  }
  await sql`insert into drizzle.__drizzle_migrations (hash, created_at) values (${e.hash}, ${e.created_at})`;
  console.log(`${e.tag}: registered`);
}

const rows = await sql`select id, hash, created_at from drizzle.__drizzle_migrations order by id`;
console.log("\nFull migration history now:");
console.table(rows);

await sql.end();
