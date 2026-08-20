// One-off smoke test for the "pesquisa profunda" (CNPJ/QSA) pipeline: seeds a fake
// extraction_result with a known CNPJ (Magazine Luiza's, public data) and runs
// handleEnrichDeep directly. Cleans up after itself. Run: npx tsx scripts/test-deep-search.ts
import { randomUUID } from "node:crypto";
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
  const resultId = randomUUID();

  async function cleanup() {
    await sql`delete from extraction_results where id = ${resultId}`;
    await sql`delete from extractions where id = ${extractionId}`;
    await sql`delete from projects where id = ${projectId}`;
    await sql`delete from cnpj_cache where cnpj = ${"47960950000121"}`;
  }

  try {
    await sql`insert into projects (id, slug, name, type) values (${projectId}, ${"smoke-deep-" + Date.now()}, ${"Smoke Deep"}, ${"B2B"})`;
    await sql`insert into extractions (id, project_id, query, city, state, status) values (${extractionId}, ${projectId}, ${"x"}, ${"Franca"}, ${"SP"}, ${"completed"})`;
    // Name deliberately close to the real razão social/fantasia so scoreCnpjMatch should pass threshold.
    await sql`insert into extraction_results (id, extraction_id, project_id, place_id, name, city, state, cnpj)
              values (${resultId}, ${extractionId}, ${projectId}, ${"fake-place-id"}, ${"Magazine Luiza"}, ${"Franca"}, ${"SP"}, ${"47960950000121"})`;

    const { handleEnrichDeep } = await import("../lib/enrichment/job-handler");
    console.log("Running handleEnrichDeep...");
    await handleEnrichDeep({ resultIds: [resultId] });

    const row = (await sql`select * from extraction_results where id = ${resultId}`)[0];
    console.log("\n=== RESULT ===");
    console.log({
      deepStatus: row?.deep_status,
      deepError: row?.deep_error,
      cnpj: row?.cnpj,
      legalName: row?.legal_name,
      ownerName: row?.owner_name,
      ownerRole: row?.owner_role,
      cnpjConfidence: row?.cnpj_confidence,
      companyStatus: row?.company_status,
    });

    const cached =
      await sql`select cnpj, provider from cnpj_cache where cnpj = ${"47960950000121"}`;
    console.log("\ncnpj_cache row:", cached[0] ?? "(none — unexpected)");
  } catch (err) {
    console.error("SMOKE TEST FAILED:", err);
  } finally {
    await cleanup();
    await sql.end();
  }
}

main();
