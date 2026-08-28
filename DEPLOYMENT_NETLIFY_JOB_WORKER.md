# Job worker — como as extrações são processadas

Documento único sobre o processamento de jobs de extração. Substitui o antigo
`EXTRACTION_FIX_SUMMARY.md` (removido), cuja premissa central estava errada.

---

## Premissa que estava errada (e custou dois meses)

> "Extrações ficam presas em 'Na fila' porque Netlify Scheduled Functions requerem plano Pro."

**Falso.** Scheduled Functions existem em todos os planos, inclusive o free (`nf_team_dev`),
que é o plano deste site. O plano nunca foi o problema.

A causa real era de sintaxe. `netlify/functions/job-worker.ts` era assim:

```ts
const handler: Handler = async () => { … };
export { handler };                                        // named export → função v1
export const config: Config = { schedule: "* * * * *" };   // só lido em funções v2
```

`zip-it-and-ship-it` classifica a função pelo formato do export. Export nomeado `handler`
= função v1 (Lambda-compat), e nesse modo o `export const config` é **ignorado em silêncio**.
Build passava, função deployava, cron nunca era registrado. A API de deploy da Netlify
mostrava a prova: `"function_schedules": []`.

Consequência: nenhum worker consumia a fila. O job ficava em `pgboss.job.state = 'created'`
para sempre e a extração em `queued` — sem erro, sem log, sem sinal.

---

## Arquitetura atual

```
createExtraction()                  lib/extractions/actions.ts
  └─ boss.send("extraction:apify-start")        role: producer

netlify/functions/job-worker.ts     Scheduled Function, "* * * * *"   ← caminho primário
  └─ drainQueues()                  lib/jobs/dispatch.ts, budget 8s
      ├─ extraction:apify-start  → startRun na Apify        → status "running"
      ├─ extraction:poll         → getRun, re-enfileira a cada 15s
      ├─ extraction:ingest       → grava resultados página a página → "completed"
      └─ enrich:deep             → pesquisa profunda (CNPJ/QSA)
  └─ expireStalledExtractions()     lib/extractions/watchdog.ts

app/api/internal/job-worker        cron externo a cada 5 min          ← redundância
lib/jobs/dev-worker.ts             setInterval 2s, só em NODE_ENV=development
```

Os três entrypoints compartilham `drainQueues()` e `JOB_HANDLERS` — a tabela de roteamento
e o loop existem em um lugar só.

### Orçamento de tempo

Netlify Functions morrem em ~10s (free) / ~26s (Pro). `drainQueues` checa o relógio
**antes de cada `boss.fetch`** e para de puxar trabalho novo quando o budget acaba (8s),
deixando o job em voo terminar. Sem isso, uma função morta no meio deixa jobs em `active`
sem `complete()` nem `fail()` — pendurados até o `expireInSeconds` da fila.

### Papéis do pg-boss

`getBoss({ role })` — produtor e consumidor rodam em funções serverless diferentes:

| role | supervise | monitorState | usa |
|---|---|---|---|
| `producer` (default) | não | não | server actions, rotas do app |
| `worker` | sim | 30s | scheduled function, API route, dev-worker |

O worker também é dono das políticas de fila: só ele chama `updateQueue`. Isso importa
porque `createQueue` é no-op quando a fila já existe — `extraction:start` e
`extraction:page`, criadas em abril/2026, ficaram com `retry_limit = null` por meses
porque toda chamada posterior de `createQueue` não fazia nada.

### Watchdog

`expireStalledExtractions()` marca como `failed`, com mensagem explicando a causa:
- `queued` há mais de 10 min (nenhum worker drenou a fila);
- `running` há mais de 45 min (o poll da Apify termina em ~20 min no pior caso).

Na UI, uma extração `queued` há mais de 3 min já aparece como **"Na fila — atrasada"**
em laranja. Extrações `failed` passam a mostrar o `errorMessage`. O objetivo é que uma
parada nunca mais seja indistinguível de lentidão.

---

## Configuração de produção

### Variáveis de ambiente (painel da Netlify, contexto production)

| Var | Obrigatória | Para quê |
|---|---|---|
| `DATABASE_URL` | sim | pg-boss + app |
| `APIFY_TOKEN` | sim | sem ela toda extração falha (agora com erro visível) |
| `WORKER_SECRET` | só se usar o cron externo | autentica `POST /api/internal/job-worker` |

### Cron externo (redundância opcional)

[cron-job.org](https://cron-job.org) → `POST https://crm.techhive.com.br/api/internal/job-worker`,
header `x-worker-secret: <WORKER_SECRET>`, a cada **5 minutos** (não 1 — o caminho primário
é a Scheduled Function).

---

## Verificação após qualquer mudança no worker

**1. O schedule registrou** — este é o teste que faltava antes:

```bash
curl -s -H "Authorization: Bearer $NETLIFY_TOKEN" \
  "https://api.netlify.com/api/v1/sites/e8294cde-1139-45c0-b865-bcc1355bd56a/deploys?per_page=1" \
  | jq '.[0].function_schedules'
```
Precisa conter `job-worker`. Se voltar `[]`, o cron não existe — não importa o que o
código diga.

**2. A fila drena:**

```sql
SELECT name, state, count(*), min(created_on) FROM pgboss.job GROUP BY 1,2;
SELECT id, status, provider, apify_run_id, processed, error_message
FROM extractions ORDER BY created_at DESC LIMIT 3;
```
Nada deve permanecer em `state = 'created'` por mais de ~1 min.

**3. Logs:** Netlify → Functions → `job-worker` → uma invocação por minuto,
`{ ok: true, processed, failed, expired }`, sem timeout.

**4. Fallback:**
```bash
curl -X POST https://crm.techhive.com.br/api/internal/job-worker -H "x-worker-secret: <secret>"
# 200 { ok: true, ... }   |   secret errado → 401
```

**5. Caminho de falha:** com `APIFY_TOKEN` inválido, a extração deve virar `failed`
com mensagem em ≤ 1 min. Nunca `queued` silencioso.
