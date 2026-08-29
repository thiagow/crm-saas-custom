/**
 * Spend and concurrency guardrails for extractions.
 *
 * Before this module, `MAX_EXTRACTIONS_PER_DAY` was read at the top of
 * lib/extractions/actions.ts and never used anywhere — there was no daily cap, no monthly
 * cap and no concurrency cap. Nothing stopped a handful of clicks from burning the whole
 * Apify budget (Free plan, US$ 5/month), which would then block extraction for the rest
 * of the month.
 *
 * Everything runs inside the caller's transaction, behind an advisory lock keyed on the
 * project. Without the lock, two clicks landing together would both read the same "spent
 * so far" and both pass — the classic check-then-act race. `pg_advisory_xact_lock`
 * releases automatically when the transaction ends, including on rollback.
 */
import { extractions } from "@/db/schema";
import type { db } from "@/lib/db/client";
import { and, eq, gte, inArray, sql } from "drizzle-orm";

/** Drizzle doesn't export its transaction type directly — derive it from db.transaction's
 *  own callback signature so this stays correct if the driver or schema changes. */
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const MAX_PER_DAY = Number.parseInt(process.env.MAX_EXTRACTIONS_PER_DAY ?? "20", 10);
const MAX_CONCURRENT = Number.parseInt(process.env.MAX_CONCURRENT_EXTRACTIONS ?? "2", 10);
/** Kept under the Apify Free plan's US$ 5 ceiling so a run never dies mid-way for lack of credit. */
const MAX_MONTHLY_SPEND_USD = Number.parseFloat(process.env.MAX_MONTHLY_SPEND_USD ?? "4");

/** Thrown for a limit the user can act on — the message is shown verbatim in the UI. */
export class ExtractionLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionLimitError";
  }
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/**
 * Asserts a new extraction is allowed. Must be called inside a transaction, before the
 * insert, so the lock covers the check and the write together.
 *
 * @param tx      the transaction handle from db.transaction()
 * @param projectId  tenant scope — limits are per project, not global
 * @param estimatedCostUsd  from estimateExtractionCostUsd (lib/apify/cost.ts)
 */
export async function assertExtractionAllowed(
  tx: Transaction,
  projectId: string,
  estimatedCostUsd: number,
) {
  // Serialize concurrent creates for this project. hashtext() gives the bigint the lock
  // API wants; collisions across projects would only cost a brief wait, never correctness.
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${projectId}))`);

  const [active] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(extractions)
    .where(
      and(eq(extractions.projectId, projectId), inArray(extractions.status, ["queued", "running"])),
    );

  if ((active?.count ?? 0) >= MAX_CONCURRENT) {
    throw new ExtractionLimitError(
      `Já existem ${active?.count} extrações em andamento (limite: ${MAX_CONCURRENT}). Aguarde terminarem.`,
    );
  }

  const [today] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(extractions)
    .where(and(eq(extractions.projectId, projectId), gte(extractions.createdAt, startOfToday())));

  if ((today?.count ?? 0) >= MAX_PER_DAY) {
    throw new ExtractionLimitError(
      `Limite diário de ${MAX_PER_DAY} extrações atingido. Tente novamente amanhã.`,
    );
  }

  // Real billed cost, not estimates — costUsd is written from run.usageTotalUsd.
  const [month] = await tx
    .select({ spent: sql<number>`coalesce(sum(${extractions.costUsd}), 0)::float8` })
    .from(extractions)
    .where(and(eq(extractions.projectId, projectId), gte(extractions.createdAt, startOfMonth())));

  const spent = month?.spent ?? 0;
  if (spent + estimatedCostUsd > MAX_MONTHLY_SPEND_USD) {
    throw new ExtractionLimitError(
      `Teto mensal de US$ ${MAX_MONTHLY_SPEND_USD.toFixed(2)} seria ultrapassado ` +
        `(gasto no mês: US$ ${spent.toFixed(2)}, estimativa desta extração: US$ ${estimatedCostUsd.toFixed(2)}).`,
    );
  }
}
