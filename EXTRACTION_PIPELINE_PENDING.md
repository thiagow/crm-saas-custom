# Pipeline de Extração v2 — Pendências

Este documento lista o que **ainda falta** do plano de reformulação do pipeline de extração (Apify + enriquecimento em cascata). O que já foi entregue e validado com dados reais (descoberta via Apify, contatos automáticos, WhatsApp por heurística, pesquisa profunda via CNPJ/Receita Federal, promoção sem perda de dados) não está listado aqui — só o que falta.

Está organizado por prioridade de risco, não pela ordem do plano original. Cada item tem contexto suficiente pra retomar sem precisar re-explorar o código do zero.

---

## 1. Teto de gasto real (prioridade máxima — risco financeiro)

**O que existe hoje:** `APIFY_MAX_RUN_COST_USD` (default 2.00) aborta *um run* individual se `usageTotalUsd` ultrapassar o teto (`lib/apify/job-handler.ts`, `handleExtractionPoll`). É a única proteção que existe.

**O que falta:**
- `MAX_EXTRACTIONS_PER_DAY` é lido em `lib/extractions/actions.ts:13` mas **nunca usado** — não há contagem diária em lugar nenhum. Isso já era letra morta antes desta reforma; continua sendo.
- Não existe limite de gasto **mensal agregado**. Nada soma `SUM(cost_usd)` do mês antes de permitir uma nova extração.
- Não existe limite de **concorrência** — nada impede disparar 10 extrações simultâneas, cada uma abrindo um run na Apify.
- Não existe lock contra dois cliques simultâneos no botão "Nova extração" furarem qualquer teto que venha a existir.

**Por que importa:** a conta Apify está no plano Free, com teto de **US$ 5/mês** (medido nesta sessão em 2026-08-20). Sem limite agregado, é possível estourar esse teto — e travar toda a extração do mês — com poucos cliques.

**Como implementar** (referência: Fase 3 do plano original):
- Criar `lib/extractions/limits.ts` com `assertExtractionAllowed(tx, projectId, estimatedCostUsd)`.
- Dentro de uma transação, `SELECT pg_advisory_xact_lock(hashtext($projectId))` **primeiro** (evita corrida entre cliques simultâneos).
- Checar: (1) extrações hoje vs. `MAX_EXTRACTIONS_PER_DAY`; (2) `SUM(cost_usd)` do mês + estimativa vs. novo env `MAX_MONTHLY_SPEND_USD` (sugestão: default 4, deixando margem sob o teto de $5 da Apify); (3) extrações `queued`/`running` vs. `MAX_CONCURRENT_EXTRACTIONS` (sugestão: default 2).
- Chamar dentro de `createExtraction` (`lib/extractions/actions.ts`), na mesma transação do `insert`.
- `estimateExtractionCostUsd` já existe em `lib/apify/cost.ts` — reaproveitar para a estimativa.

---

## 2. Orçamento de tempo nos workers (risco de jobs travados)

**O que existe hoje:** os três workers (`netlify/functions/job-worker.ts`, `app/api/internal/job-worker/route.ts`, `lib/jobs/dev-worker.ts`) drenam as filas via `lib/jobs/handlers.ts` sem checar quanto tempo já passou desde o início da execução.

**Por que importa:** a Netlify Function tem timeout de ~10s (free) ou ~26s (Pro). Se um lote de jobs (`batchSize: 5`, múltiplas filas) demorar mais que isso, a função morre no meio — e como o job já foi puxado da fila (`boss.fetch`) mas nem `complete()` nem `fail()` foi chamado, ele fica "pendurado" até o `expireInSeconds` da política da fila (60-120s configurados em `lib/jobs/boss.ts`) estourar e o pg-boss reagendar via retry.

**Como implementar** (referência: Fase 0.4 do plano original):
- Em `lib/jobs/handlers.ts` (ou um novo `lib/jobs/dispatch.ts`), criar `drainQueues(boss, { budgetMs, batchSize })` que checa `Date.now() - t0 > budgetMs` **antes** de cada `boss.fetch` e para de puxar mais jobs (mas deixa o job em andamento terminar).
- `budgetMs` sugerido: ~8s pro free tier, ~20s pro Pro.
- Os três workers passam a chamar essa função em vez de reimplementar o loop cada um.

---

## 3. Testes automatizados (zero existentes)

**O que existe hoje:** nada. Não há `vitest.config.ts` nem `playwright.config.ts` no repo. Toda a validação desta reforma foi manual — scripts em `scripts/test-apify-pipeline.ts` e `scripts/test-deep-search.ts` (que rodam contra a Apify e o Postgres de produção de verdade; úteis como smoke test manual, não como suíte de regressão).

**O que teria mais valor testar primeiro** (funções puras, sem rede — o ganho mais barato):
- `lib/enrichment/phone.ts` (`normalizeBrPhone`): tabela de casos — `(11) 99999-8888` → mobile/likely; `(11) 3333-4444` → landline; `0800...` → tollfree; DDD inválido → unknown; celular antigo de 8 dígitos → unknown (não pode chutar mobile).
- `lib/enrichment/cnpj.ts` (`isValidCnpj`, `extractCnpjCandidates`, `scoreCnpjMatch`): dígitos verificadores com casos válidos/inválidos conhecidos; extração de CNPJ com/sem máscara; `scoreCnpjMatch` com acentos e sufixos tipo "LTDA/ME" — já validado manualmente com o CNPJ real da Magazine Luiza (score 1.0), vale virar fixture de teste.
- `lib/apify/mappers.ts` (`mapDiscoveryItem`, `pickInstagramHandle`): usar o item real capturado em 2026-08-20 (está documentado no cabeçalho do arquivo) como fixture.

**O mais importante de todos — teste de segurança:**
- **Anti-IDOR em `lib/enrichment/actions.ts` (`deepEnrichResults`)**: usuário do projeto A chama a action com ids de resultado do projeto B → precisa retornar `{ queued: 0 }` e não alterar nada em B. O claim atômico (`UPDATE ... WHERE project_id = $tenant ... RETURNING`) foi *desenhado* pra isso, mas nunca foi verificado por um teste automatizado — só por leitura de código.

**Setup sugerido:** `vitest.config.ts` com dois projects (`node` para `lib/**`, `jsdom` para `components/**`), alias `@`. Testes de integração (`promote.test.ts`, o anti-IDOR acima) precisam de um Postgres — `docker-compose.yml` já existe no repo pra isso, mas nunca foi testado nesta sessão (Docker não estava disponível no ambiente em que a reforma foi feita).

---

## 4. Proveniência dos dados enriquecidos

**O que existe hoje:** quando um campo é re-enriquecido (ex.: rodar "pesquisa profunda" duas vezes, ou o usuário editar manualmente e depois um enriquecimento automático rodar por cima), o valor novo **sobrescreve** o antigo sem checar origem ou confiança. Não existe coluna `provenance` em `extraction_results` nem em `leads`.

**Risco concreto:** um usuário edita manualmente o telefone de um resultado (`updateExtractionResult`), e se esse resultado for reprocessado por engano (ex.: reextração do mesmo `place_id` após ser descartado e reativado), o valor manual pode ser sobrescrito pelo automático. Hoje não há proteção contra isso.

**Como implementar** (referência: Fase 2 do plano original):
```ts
// lib/enrichment/provenance.ts
export const SOURCE_RANK = {
  manual: 100, cnpj_receita: 80, site_crawl: 60,
  apify_maps: 50, google_places: 40, heuristic: 10,
};
export function resolveField<T>(current, incoming): { value: T; prov } | null;
```
Regras: (1) `incoming` vazio nunca escreve; (2) `current` nulo → escreve; (3) `source === "manual"` nunca é sobrescrito; (4) senão compara `RANK × confidence`; (5) empate mantém o atual.

Precisa de nova coluna `provenance jsonb` em `extraction_results` e `leads` (migration nova). Todos os pontos que escrevem campos enriquecidos (`lib/apify/job-handler.ts` no ingest, `lib/enrichment/job-handler.ts` no deep-search) passam a usar `resolveField` em vez de `UPDATE` direto.

---

## 5. UI da triagem — itens menores

Nenhum destes é bloqueante, mas ficaram pendentes:

| Item | Onde | Detalhe |
|---|---|---|
| Filtro "Tem WhatsApp" | `components/extractions/triage-table.tsx` | Só "Tem e-mail" foi adicionado; falta espelhar pra `whatsappStatus === 'likely'` |
| Filtro "Tem dono" | idem | `isNotNull(extractionResults.ownerName)` |
| Filtro "No Google Maps" | idem | `eq(extractionResults.isOnGoogleMaps, true)` |
| Ordenação "Mais completo" | `lib/extractions/actions.ts` (`getTriageResults`) | Soma de campos preenchidos como critério de order by |
| Contador real de resultados | idem | Hoje mostra `results.length` (máx. 100, sem paginação real). `getTriageResults` precisa devolver `{ items, total }` com um `COUNT(*)` |
| Acessibilidade do modal de edição | `triage-table.tsx`, overlay manual (linhas ~420+) | Sem `role="dialog"`, sem handler de `Escape`, sem focus trap. Migrar pra `components/ui/dialog` (já existe no repo, baseado em Base UI) |
| Quebra em subcomponentes | `triage-table.tsx` (600+ linhas agora) | Extrair `triage-row.tsx`, `triage-filters.tsx`, `triage-bulk-bar.tsx`, `deep-search-button.tsx` |
| Badge de proveniência (`source-badge.tsx`) | novo componente | Depende do item 4 (proveniência) existir primeiro |
| Botão "Reativar descartados" | `triage-table.tsx` + nova action | O unique `(project_id, place_id)` em `extraction_results` (migration 0004) impede re-extrair um place já descartado. Mitigação prevista no plano original nunca foi implementada — hoje um place descartado fica preso, sem forma de trazê-lo de volta pela UI |

---

## 6. Escopo cortado deliberadamente (não é bug, foi decisão de custo/tempo)

Documentado aqui só para não ser redescoberto como "esquecimento":

- ~~**Instagram detalhado** (seguidores, verificado, bio) via `scrapeSocialMediaProfiles`~~ — **implementado em 2026-09-07** (pivot pro nicho de clínicas de estética/salões, que raramente têm site — ver `lib/apify/instagram-deep-handler.ts`, filas `enrich:instagram-start`/`enrich:instagram-poll`, opt-in via checkbox na triagem, custo mostrado via `estimateDeepSearchCostUsd`). ⚠️ Os nomes de campo `biography`/`externalUrl` no item do dataset (`lib/apify/mappers.ts`) **não foram confirmados contra um run real** com `scrapeSocialMediaProfiles.instagrams: true` — só o caminho sem essa opção foi validado (2026-08-20/28). Rodar `scripts/test-deep-search.ts` com essa flag e corrigir os nomes de campo se necessário antes de confiar nisso em produção.
- **CNPJ via busca SERP** (`apify/google-search-scraper`) como fallback quando o resultado não tem site — só a busca no site (`lib/enrichment/site-cnpj.ts`) foi implementada. Resultados sem website nunca vão encontrar CNPJ hoje.
- **CNPJ via bio do Instagram** — mesma lógica, não implementado.

## 7. Novidades 2026-09-07 — pivot pra nichos locais (salões, clínicas de estética)

Motivado por: boa parte desses negócios não tem site, só Instagram — as duas fontes de e-mail existentes (`site-enrich.ts`, `deep-search.ts`/CNPJ) exigiam um site com CNPJ visível.

- **Resolver de Linktree/Beacons** (`lib/enrichment/linktree-resolve.ts`) — quando o campo `website` de um lugar aponta pra um link-in-bio (`socialLinks.linktree`, já classificado por `link-classifier.ts` mas nunca antes buscado), `enrich:site` agora busca essa página também. Grátis, automático.
- **Instagram detalhado** — ver item 6 acima. Pago, opt-in, mostra custo antes de rodar.
- **Validação de e-mail via Bouncer** (`lib/enrichment/bouncer.ts`, fila `enrich:validate-email`) — nenhuma das fontes de e-mail acima confirma que a caixa existe de fato. Ação explícita na triagem ("Validar e-mails"), nunca automática. Requer `BOUNCER_API_KEY` no `.env`. ⚠️ Endpoint/formato de resposta vieram da documentação pública, não testados contra uma chave real — confirmar com uma chamada real antes de depender disso.
- Nova coluna de filtro "E-mail validado" na triagem (`emailValidationStatus === 'deliverable'`) — é a lista que de fato deveria alimentar uma cadência de e-mail, ao contrário de "Tem e-mail" (que só diz que uma string parecida com e-mail foi encontrada em algum lugar).

---

## Onde estão as coisas (mapa rápido pra retomar)

```
lib/apify/           client.ts, actors.ts, mappers.ts, cost.ts, job-handler.ts    → descoberta
lib/enrichment/       phone.ts, cnpj.ts, receita.ts, site-cnpj.ts,
                       deep-search.ts, job-handler.ts, actions.ts                 → pesquisa profunda
lib/jobs/             boss.ts (filas + retry policy), handlers.ts (routing)       → pg-boss
lib/extractions/      actions.ts (createExtraction, promoteResultsToLeads, ...)   → CRUD de extração/triagem
db/schema/            extractions.ts, leads.ts                                     → schema (migrations 0002-0006 aplicadas em prod)
components/extractions/ triage-table.tsx, new-extraction-button.tsx, extractions-list.tsx
scripts/               test-apify-pipeline.ts, test-deep-search.ts, mark-migrations-applied.mjs, apply-migration-0006.ts
```
