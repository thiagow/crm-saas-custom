/**
 * "Pesquisa profunda" — the on-demand triage step that looks up the owner/responsible
 * name via CNPJ + Receita Federal QSA data. Runs synchronously within one pg-boss job
 * (a handful of HTTP fetches, well under the ~10s budget) — no Apify run needed here.
 *
 * Rating/review count are NOT part of this step: the automatic discovery pass already
 * captures them from Google Maps (see lib/apify/mappers.ts) for every result.
 */
import { CNPJ_MATCH_THRESHOLD, isValidCnpj, scoreCnpjMatch } from "./cnpj";
import { fetchCnpj } from "./receita";
import { findCnpjCandidatesOnSite } from "./site-cnpj";

export interface DeepSearchInput {
  name: string;
  city: string | null;
  state: string | null;
  website: string | null;
  /** A CNPJ already known for this result (e.g. from a previous partial run) — skips the site crawl. */
  knownCnpj: string | null;
}

export interface DeepSearchOutcome {
  status: "done" | "partial" | "failed";
  cnpj: string | null;
  legalName: string | null;
  cnaeDescription: string | null;
  companyStatus: string | null;
  cnpjConfidence: number | null;
  ownerName: string | null;
  ownerRole: string | null;
  ownerEmail: string | null;
  error: string | null;
}

const NOT_FOUND: DeepSearchOutcome = {
  status: "partial",
  cnpj: null,
  legalName: null,
  cnaeDescription: null,
  companyStatus: null,
  cnpjConfidence: null,
  ownerName: null,
  ownerRole: null,
  ownerEmail: null,
  error: "CNPJ não encontrado no site do estabelecimento",
};

export async function runDeepSearch(input: DeepSearchInput): Promise<DeepSearchOutcome> {
  try {
    const candidates = input.knownCnpj
      ? [input.knownCnpj.replace(/\D/g, "")]
      : input.website
        ? await findCnpjCandidatesOnSite(input.website)
        : [];

    const validCandidates = candidates.filter(isValidCnpj);
    if (validCandidates.length === 0) {
      return input.website
        ? NOT_FOUND
        : { ...NOT_FOUND, error: "Resultado sem site — nada para pesquisar" };
    }

    let best: { score: number; outcome: DeepSearchOutcome } | null = null;

    for (const cnpj of validCandidates.slice(0, 3)) {
      const company = await fetchCnpj(cnpj);
      if (!company) continue;

      const score = scoreCnpjMatch(
        { name: input.name, city: input.city, state: input.state },
        {
          razaoSocial: company.razaoSocial,
          nomeFantasia: company.nomeFantasia,
          municipio: company.municipio,
          uf: company.uf,
        },
      );

      const outcome: DeepSearchOutcome = {
        status: score >= CNPJ_MATCH_THRESHOLD ? "done" : "partial",
        cnpj,
        legalName: company.razaoSocial,
        cnaeDescription: company.cnaeDescricao,
        companyStatus: company.situacao,
        cnpjConfidence: score,
        // Only attribute an owner when we're actually confident this CNPJ is the right business.
        ownerName: score >= CNPJ_MATCH_THRESHOLD ? company.ownerName : null,
        ownerRole: score >= CNPJ_MATCH_THRESHOLD ? company.ownerRole : null,
        ownerEmail: score >= CNPJ_MATCH_THRESHOLD ? company.email : null,
        error:
          score >= CNPJ_MATCH_THRESHOLD
            ? null
            : `CNPJ ${cnpj} encontrado, mas confiança baixa (${Math.round(score * 100)}%) de que é a mesma empresa`,
      };

      if (!best || score > best.score) best = { score, outcome };
      if (score >= CNPJ_MATCH_THRESHOLD) break; // good enough, stop trying more candidates
    }

    return best?.outcome ?? NOT_FOUND;
  } catch (err) {
    return {
      status: "failed",
      cnpj: null,
      legalName: null,
      cnaeDescription: null,
      companyStatus: null,
      cnpjConfidence: null,
      ownerName: null,
      ownerRole: null,
      ownerEmail: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
