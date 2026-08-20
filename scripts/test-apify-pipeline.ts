import { randomUUID } from "node:crypto";
// One-off smoke test: exercises the real Apify extraction pipeline (start → poll →
// ingest) against a throwaway project, using a tiny maxResults to keep cost near zero.
// Cleans up everything it creates at the end. Run: npx tsx scripts/test-apify-pipeline.ts
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

  const projectId = randomUUID();
  const extractionId = randomUUID();

  async function cleanup() {
    await sql`delete from extraction_results where project_id = ${projectId}`;
    await sql`delete from extractions where id = ${extractionId}`;
    await sql`delete from projects where id = ${projectId}`;
  }

  try {
    await sql`insert into projects (id, slug, name, type) values (${projectId}, ${"smoke-test-" + Date.now()}, ${"Smoke Test"}, ${"B2B"})`;
    await sql`insert into extractions (id, project_id, query, city, state, max_results, status, provider, enrich_contacts)
              values (${extractionId}, ${projectId}, ${"pilates"}, ${"Sao Paulo"}, ${"SP"}, 2, ${"queued"}, ${"apify"}, true)`;
    console.log("Seeded extraction:", extractionId);

    const { handleExtractionStart, handleExtractionPoll, handleExtractionIngest } = await import(
      "../lib/apify/job-handler"
    );
    const { getRun } = await import("../lib/apify/client");

    console.log("\n--- handleExtractionStart ---");
    await handleExtractionStart({ extractionId });

    let row = (await sql`select * from extractions where id = ${extractionId}`)[0]!;
    console.log(
      "status:",
      row.status,
      "| apifyRunId:",
      row.apify_run_id,
      "| datasetId:",
      row.apify_dataset_id,
    );

    console.log("\n--- polling ---");
    for (let i = 0; i < 20; i++) {
      await handleExtractionPoll({ extractionId });
      row = (await sql`select * from extractions where id = ${extractionId}`)[0]!;
      console.log(
        `poll ${i + 1}: status=${row.status} provider=${row.provider} pollAttempts=${row.poll_attempts} apifyRunId=${row.apify_run_id}`,
      );
      if (row.status !== "running" || !row.apify_run_id) break;

      const run = await getRun(row.apify_run_id);
      if (
        run.status === "SUCCEEDED" ||
        run.status.includes("FAIL") ||
        run.status.includes("ABORT") ||
        run.status.includes("TIMED")
      ) {
        await handleExtractionPoll({ extractionId }); // one more call processes the terminal state
        break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    row = (await sql`select * from extractions where id = ${extractionId}`)[0]!;
    console.log("\nafter poll loop:", {
      status: row.status,
      provider: row.provider,
      costUsd: row.cost_usd,
      errorMessage: row.error_message,
    });

    if (row.status === "running" && row.apify_dataset_id) {
      console.log("\n--- handleExtractionIngest (manual, since run likely succeeded) ---");
      await handleExtractionIngest({ extractionId, offset: 0 });
    }

    row = (await sql`select * from extractions where id = ${extractionId}`)[0]!;
    const results = await sql`
      select place_id, name, email, phone_e164, phone_type, whatsapp_status,
             is_on_google_maps, google_maps_url, rating, reviews_count, instagram_handle
      from extraction_results where extraction_id = ${extractionId}`;

    console.log("\n=== FINAL EXTRACTION STATE ===");
    console.log({
      status: row.status,
      processed: row.processed,
      totalFound: row.total_found,
      costUsd: row.cost_usd,
      provider: row.provider,
    });
    console.log("\n=== RESULTS ===");
    console.table(results);
  } catch (err) {
    console.error("\nSMOKE TEST FAILED:", err);
  } finally {
    console.log("\n--- cleaning up test data ---");
    await cleanup();
    await sql.end();
  }
}

main();
