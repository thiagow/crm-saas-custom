/**
 * Backfills the fields added by the data-quality pass over rows that already exist.
 *
 * Everything it needs is already stored in `extraction_results.raw` — the Apify item is
 * kept verbatim — so this reprocesses history without calling Apify and without spending
 * anything. Two things get fixed:
 *
 *   1. Google Business Profile claim state (`gbp_status`, `business_profile_id`), read
 *      from `claimThisBusiness` / `businessProfileId`.
 *   2. The `website` field, which is frequently an Instagram or wa.me link rather than a
 *      site. Those get moved into `instagram_handle` / `whatsapp_number` / `social_links`
 *      and cleared from `website`.
 *
 * Idempotent: re-running it changes nothing further. Never overwrites a value that is
 * already set — a manually edited handle survives.
 *
 * Run: npx tsx scripts/backfill-extraction-fields.ts [--dry-run]
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { readGbpStatus } from "../lib/apify/mappers";
import { resolveContactLinks } from "../lib/enrichment/link-classifier";

try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
    const match = line.match(/^([A-Z_]+)="?(.*?)"?$/);
    if (match?.[1] && !(match[1] in process.env)) process.env[match[1]] = match[2];
  }
} catch {}

interface Row {
  id: string;
  name: string;
  website: string | null;
  instagram_handle: string | null;
  instagram_source: string | null;
  whatsapp_number: string | null;
  whatsapp_status: string;
  gbp_status: string;
  raw: Record<string, unknown>;
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const sql = postgres(process.env.DATABASE_URL as string, {
    ssl: process.env.DATABASE_SSL === "require",
  });

  const rows = await sql<Row[]>`
    select id, name, website, instagram_handle, instagram_source,
           whatsapp_number, whatsapp_status, gbp_status, raw
    from extraction_results
  `;

  console.log(`${rows.length} resultados a analisar${dryRun ? " (dry-run)" : ""}\n`);

  const stats = { gbp: 0, instagram: 0, whatsapp: 0, social: 0, websiteCleared: 0 };

  for (const row of rows) {
    const updates: Record<string, unknown> = {};

    // ── Google Business Profile ────────────────────────────────────────────
    if (row.gbp_status === "unknown") {
      const status = readGbpStatus({
        claimThisBusiness: (row.raw?.claimThisBusiness as boolean | undefined) ?? null,
        businessProfileId: (row.raw?.businessProfileId as string | undefined) ?? null,
      });
      if (status !== "unknown") {
        updates.gbp_status = status;
        const profileId = row.raw?.businessProfileId;
        if (typeof profileId === "string") updates.business_profile_id = profileId;
        stats.gbp++;
      }
    }

    // ── website field → the column it actually belongs in ──────────────────
    if (row.website) {
      const links = resolveContactLinks(row.website);

      if (links.instagramHandle && !row.instagram_handle) {
        updates.instagram_handle = links.instagramHandle;
        updates.instagram_source = "maps_website_field";
        stats.instagram++;
      }
      if (links.whatsappFromLink && !row.whatsapp_number) {
        updates.whatsapp_number = links.whatsappFromLink;
        updates.whatsapp_status = "likely";
        stats.whatsapp++;
      }
      if (Object.keys(links.socialLinks).length > 0) {
        updates.social_links = links.socialLinks;
        stats.social++;
      }
      // The link was a social/messaging destination, not a site — stop calling it one.
      if (links.website === null) {
        updates.website = null;
        stats.websiteCleared++;
      }
    }

    if (Object.keys(updates).length === 0) continue;

    if (dryRun) {
      console.log(`${row.name.slice(0, 45).padEnd(45)} ${JSON.stringify(updates)}`);
      continue;
    }

    await sql`update extraction_results set ${sql(updates)} where id = ${row.id}`;
  }

  console.log("\nResumo:");
  console.log(`  Google Meu Negócio preenchido : ${stats.gbp}`);
  console.log(`  Instagram recuperado          : ${stats.instagram}`);
  console.log(`  WhatsApp recuperado           : ${stats.whatsapp}`);
  console.log(`  Redes sociais guardadas       : ${stats.social}`);
  console.log(`  Campo "site" limpo            : ${stats.websiteCleared}`);

  if (!dryRun) {
    const [after] = await sql`
      select count(instagram_handle) as ig,
             count(*) filter (where gbp_status = 'unclaimed') as nao_reivindicado,
             count(*) filter (where gbp_status = 'claimed')   as reivindicado,
             count(*) filter (where website ~* 'instagram|wa\\.me|facebook') as site_sujo
      from extraction_results`;
    console.log("\nEstado final:", after);
  }

  await sql.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
