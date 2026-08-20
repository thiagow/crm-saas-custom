import { cnpjCache } from "@/db/schema";
import { db } from "@/lib/db/client";
/**
 * CNPJ lookup against public Receita Federal data, cached 30 days in `cnpj_cache`
 * (BrasilAPI's rate limit is undocumented — the cache is what makes repeated
 * "pesquisa profunda" runs across projects/leads cheap).
 *
 * Response shape confirmed against a real BrasilAPI call on 2026-08-20 (see
 * lib/enrichment/cnpj.ts header for the broader design rationale).
 */
import { eq } from "drizzle-orm";

const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface BrasilApiQsaEntry {
  nome_socio: string;
  qualificacao_socio: string;
}

interface BrasilApiResponse {
  razao_social: string;
  nome_fantasia: string | null;
  municipio: string;
  uf: string;
  email: string | null;
  descricao_situacao_cadastral: string | null;
  cnae_fiscal_descricao: string | null;
  qsa: BrasilApiQsaEntry[];
}

export interface CnpjLookupResult {
  cnpj: string;
  razaoSocial: string;
  nomeFantasia: string | null;
  municipio: string;
  uf: string;
  email: string | null;
  situacao: string | null;
  cnaeDescricao: string | null;
  ownerName: string | null;
  ownerRole: string | null;
}

/** Prefers a sócio whose qualification looks like an actual administrator/owner over
 *  a passive shareholder — falls back to the first QSA entry if none matches. */
function pickOwner(qsa: BrasilApiQsaEntry[]): { name: string; role: string } | null {
  if (qsa.length === 0) return null;
  const adminLike = qsa.find((s) =>
    /administrador|presidente|diretor|s[oó]cio-gerente|titular/i.test(s.qualificacao_socio),
  );
  const chosen = adminLike ?? qsa[0];
  if (!chosen) return null;
  return { name: chosen.nome_socio, role: chosen.qualificacao_socio };
}

export async function fetchCnpj(cnpjDigits: string): Promise<CnpjLookupResult | null> {
  const cnpj = cnpjDigits.replace(/\D/g, "");
  if (cnpj.length !== 14) throw new Error(`fetchCnpj: expected 14 digits, got "${cnpjDigits}"`);

  const cached = await db.query.cnpjCache.findFirst({ where: eq(cnpjCache.cnpj, cnpj) });
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return mapPayload(cnpj, cached.payload as BrasilApiResponse);
  }

  const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, {
    signal: AbortSignal.timeout(10_000),
    // BrasilAPI runs behind Cloudflare, which appears to bot-block requests with no
    // User-Agent (observed as an unconditional 403, confirmed by curl working fine
    // with a UA and Node's bare fetch() not sending one).
    headers: { Accept: "application/json", "User-Agent": "CRMBot/1.0 (+lead enrichment)" },
  });

  if (response.status === 404) return null; // CNPJ doesn't exist — not an error
  if (!response.ok) {
    throw new Error(`BrasilAPI error (${response.status}) for CNPJ ${cnpj}`);
  }

  const payload = (await response.json()) as BrasilApiResponse;

  await db
    .insert(cnpjCache)
    .values({ cnpj, payload, provider: "brasilapi" })
    .onConflictDoUpdate({
      target: cnpjCache.cnpj,
      set: { payload, provider: "brasilapi", fetchedAt: new Date() },
    });

  return mapPayload(cnpj, payload);
}

function mapPayload(cnpj: string, payload: BrasilApiResponse): CnpjLookupResult {
  const owner = pickOwner(payload.qsa ?? []);
  return {
    cnpj,
    razaoSocial: payload.razao_social,
    nomeFantasia: payload.nome_fantasia,
    municipio: payload.municipio,
    uf: payload.uf,
    email: payload.email,
    situacao: payload.descricao_situacao_cadastral,
    cnaeDescricao: payload.cnae_fiscal_descricao,
    ownerName: owner?.name ?? null,
    ownerRole: owner?.role ?? null,
  };
}
