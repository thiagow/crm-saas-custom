# Guia de Deployment — Job Worker para Netlify

## TL;DR

Extrações ficam presas em "Na fila" na Netlify porque Scheduled Functions requerem plano Pro. Solução: API route + cron externo gratuito.

---

## Problema

O sistema usa `netlify/functions/job-worker.ts` com `schedule: "* * * * *"` para processar jobs de extração. Isso funciona em planos **Pro/Business**, mas em planos **Starter (gratuito)**, a função nunca roda.

**Resultado**: Extrações marcadas com status `"queued"` nunca são processadas.

---

## Solução implementada

Foram feitos 3 fixes:

### 1. Detectar erro silencioso (lib/extractions/actions.ts)

`boss.send()` retorna `null` ao invés de lançar exceção quando a fila não existe. Agora detectamos e mostramos erro ao usuário.

### 2. Nova API route (app/api/internal/job-worker/route.ts)

Endpoint HTTP que pode processar jobs sem Scheduled Functions:
- **URL**: `POST /api/internal/job-worker`
- **Auth**: Header `x-worker-secret` (token secreto)
- **Resposta**: `{ ok: true, jobsProcessed: N }`

### 3. Configuração de secrets (.env.example, .env.local)

`WORKER_SECRET` — token para autenticar a API route.

---

## Steps de deployment

### Passo 1: Verificar plano Netlify

1. Abrir https://app.netlify.com
2. Selecionar seu site
3. **Settings > Billing & Usage > Current plan**
4. Se ver **"Starter"** → precisa fazer esses steps (Scheduled Functions não rodam)
5. Se ver **"Pro/Business"** → pode usar `job-worker.ts` diretamente, mas esta solução é um bom fallback

### Passo 2: Configurar WORKER_SECRET no Netlify

1. No site na Netlify, ir para **Settings > Build & deploy > Environment**
2. Clique em **Edit variables**
3. Adicionar nova variável:
   - **Key**: `WORKER_SECRET`
   - **Value**: Gerar valor seguro (recomendado: `openssl rand -base64 32`)
   - Exemplo: `kYrpL7FqK2m9xN8qP3vR5sD6aG9jL0pQ+w1yT4mW5zA=`

### Passo 3: Copiar WORKER_SECRET para .env.local

1. Copiar o valor que você gerou acima
2. Adicionar a `.env.local` deste projeto:
   ```
   WORKER_SECRET="kYrpL7FqK2m9xN8qP3vR5sD6aG9jL0pQ+w1yT4mW5zA="
   ```

### Passo 4: Configurar cron externo

Netlify não oferece cron gratuitamente no plano Starter. Usar [cron-job.org](https://cron-job.org) (gratuito):

1. Ir para https://cron-job.org
2. Se não tiver conta, criar uma (gratuita)
3. Clicar em **Create Cronjob**
4. Preencher assim:
   - **Title**: `Extraction Job Worker`
   - **URL**: `https://seu-dominio.netlify.app/api/internal/job-worker`
   - **Method**: `POST`
   - **Schedule**: `*/1 * * * *` (a cada 1 minuto)
   - **Headers**: adicionar um header customizado:
     - **Header name**: `x-worker-secret`
     - **Header value**: Cole aqui o mesmo `WORKER_SECRET` que configurou acima
5. Salvar e testar clicando em **FORCE EXECUTION**
6. Deve retornar resposta: `{ "ok": true, "jobsProcessed": 0, ... }`

Observação: Se houver erro 401/403, significa `x-worker-secret` está errado ou não está sendo enviado.

### Passo 5: Deploy para Netlify

```bash
git add .
git commit -m "fix: extraction worker for Netlify free tier via API route + cron"
git push
```

Netlify detecta push e faz deploy automaticamente.

### Passo 6: Testar em produção

1. Abrir seu site em produção
2. Criar uma nova extração (qualquer projeto, qualquer query)
3. Observar o status:
   - **Tempo T+0**: Status = "Na fila" ✓
   - **Tempo T+0-60s**: Aguardar cron-job.org dispararr
   - **Tempo T+60s**: Status deve mudar para "Rodando" ✓
   - **Tempo T+90s a T+300s** (dependendo de quantos resultados): Status = "Concluída" ✓

Se não mudar de status:
- Ir a **cron-job.org** e verificar se está executando (na aba **Executions**)
- Verificar logs da Netlify: **Functions > job-worker (API route)** (no painel da Netlify, procurar "Functions" no menu)
- Se ver errros, copiar o erro e enviar para analise

---

## Alternativa (se upgrade para Pro)

Se fizer upgrade para Netlify Pro:
- `netlify/functions/job-worker.ts` começa a rodar automaticamente
- A API route continua funcionando como backup
- Não precisa remover nada
- Para desabilitar cron-job.org, pausar em https://cron-job.org (opcional)

---

## Troubleshooting

### Status ainda em "Na fila" depois de 2+ minutos

**Causa provável**: cron-job.org não está enviando o header correto

**Solução**:
1. Ir a cron-job.org > seu job > **Settings**
2. Descer até **Custom HTTP Headers**
3. Verificar se `x-worker-secret` está lá com o valor correto
4. Clicar **FORCE EXECUTION** novamente
5. Deveria retornar `401` se o header estiver faltando, ou `200` se correto

### Erro 401 no cron-job.org

**Causa**: `WORKER_SECRET` no cron não bate com o da Netlify

**Solução**:
1. Copiar o valor exato de **Settings > Build & deploy > Environment** na Netlify
2. Colar no cron-job.org **Custom HTTP Headers** (sem espaços extras)
3. Test novamente

### Logs da Netlify não mostram nada

**Causa**: Cron não está disparando a URL

**Solução**:
1. Usar `curl` manualmente pra testar se o endpoint existe:
   ```bash
   curl -X POST https://seu-dominio.netlify.app/api/internal/job-worker \
     -H "x-worker-secret: kYrpL7FqK2m9xN8qP3vR5sD6aG9jL0pQ+w1yT4mW5zA=" \
     -H "Content-Type: application/json"
   ```
2. Deve retornar `200 OK` com JSON `{ "ok": true, ... }`
3. Se retornar `401`, o header está errado
4. Se retornar `404`, o arquivo `app/api/internal/job-worker/route.ts` não foi deployado corretamente

### Database connection error

**Causa**: `DATABASE_URL` não está configurada na Netlify

**Solução**:
1. Ir a **Settings > Build & deploy > Environment**
2. Verificar se `DATABASE_URL` está lá (copiada de `.env.local`)
3. Tentar reconectar manualmente: `DATABASE_URL="postgresql://user:pass@host/db"` (incluindo porta se necessário)

---

## Monitoramento contínuo

Para saber se tudo está funcionando:

1. **Logs Netlify**: https://app.netlify.com > seu site > **Functions** → procurar chamadas a `job-worker`
2. **Sentry**: Se estiver usando (verificar `.env.local` `NEXT_PUBLIC_SENTRY_DSN`), erros vão aparecer em https://sentry.io
3. **Database**: Query pra ver se `extraction_results` está recebendo registros:
   ```sql
   SELECT COUNT(*) FROM extraction_results WHERE created_at > NOW() - INTERVAL '1 hour';
   ```

---

## Notas arquiteturais

- **Local dev**: Usa `lib/jobs/dev-worker.ts` via `setInterval` (2s)
- **Produção com Scheduled Functions**: `netlify/functions/job-worker.ts` (Pro+)
- **Produção sem Scheduled Functions**: `app/api/internal/job-worker` via cron externo (Starter)

Ambas chamam a mesma função core: `lib/google-places/job-handler.ts` → `processExtractionPage()`

---

## Support

Se algo não funcionar:
1. Compartilhar erro exato (screenshot de Sentry ou logs da Netlify)
2. Confirmar que `WORKER_SECRET` está igual em 3 lugares:
   - `.env.local` (local)
   - Netlify Environment Variables (settings > build & deploy)
   - cron-job.org Custom HTTP Headers
