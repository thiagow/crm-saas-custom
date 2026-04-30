# Resumo: Correção de Extração Travada em "Na fila" (Netlify)

## 📋 Problema

Extrações criadas em produção (Netlify) ficam presas com status **"Na fila"** e nunca são processadas, apesar de funcionar perfeitamente em localhost.

## 🔍 Causa raiz

1. **CRÍTICO**: Netlify Scheduled Functions (necessárias para rodar `job-worker.ts`) requerem **plano Pro ou Business**. Plano Starter (gratuito) **não suporta**.

2. **ALTO**: `boss.send()` retorna `null` silenciosamente quando a fila não existe, sem exceção ou aviso ao usuário. Extração fica bloqueada sem feedback.

## ✅ Soluções implementadas

### Fix 1: Detectar erro de enfileiramento

**Arquivo**: `lib/extractions/actions.ts:70-75`

**O que foi mudado**:
```ts
// Antes: boss.send() retorna null, nada acontecia
jobId = await boss.send("extraction:start", { ... });

// Depois: agora detecta null e marca como falha
jobId = await boss.send("extraction:start", { ... });
if (jobId === null) {
  throw new Error("Fila de jobs nao disponível — boss.send() retornou null");
}
```

**Resultado**: Agora quando o job não consegue ser enfileirado, a extração é marcada como "failed" com mensagem de erro clara ao usuário.

---

### Fix 2: Nova API route para processar jobs

**Novo arquivo**: `app/api/internal/job-worker/route.ts`

**Como funciona**:
- Endpoint HTTP: `POST /api/internal/job-worker`
- Autenticação: Header `x-worker-secret` (token secreto)
- Funcionalidade: Processa jobs do pg-boss (mesma lógica que Netlify Scheduled Function)
- Timeout: Netlify Functions 10s (Starter) até 26s (Pro) — o suficiente para 1 página de 20 lugares

**Vantagem**: Pode ser chamado por qualquer serviço de cron externo, não depende de Scheduled Functions.

---

### Fix 3: Adicionar WORKER_SECRET às env vars

**Arquivos modificados**:
- `.env.example` — adicionado `WORKER_SECRET` com instrução de gerar valor seguro
- `.env.local` — adicionado `WORKER_SECRET` com valor dev (não sensível)

**Para produção**, este secret precisa ser configurado no painel da Netlify.

---

## 🚀 Próximos passos para deployment

### 1. Fazer push das mudanças

```bash
git add .
git commit -m "fix: extraction job worker for Netlify free tier

- Add null-safety check to boss.send() to surface enqueue failures
- Add API route /api/internal/job-worker as fallback for Scheduled Functions
- Add WORKER_SECRET env var for API authentication"
git push
```

### 2. Configurar Netlify (5 minutos)

1. Abrir https://app.netlify.com > seu site > **Settings > Build & deploy > Environment**
2. Clicar **Edit variables**
3. Adicionar:
   - **Key**: `WORKER_SECRET`
   - **Value**: gerar com `openssl rand -base64 32` (exemplo: `kYrpL7FqK2m9xN8qP3vR5sD6aG9jL0pQ+w1yT4mW5zA=`)

### 3. Configurar cron externo (5 minutos)

1. Ir a https://cron-job.org (gratuito, não precisa de crédito)
2. Criar conta (se não tiver)
3. **Create Cronjob**:
   - **Title**: `Extraction Job Worker`
   - **URL**: `https://seu-dominio.netlify.app/api/internal/job-worker`
   - **Method**: `POST`
   - **Schedule**: `*/1 * * * *` (a cada 1 minuto)
   - **Custom HTTP Header**:
     - **Name**: `x-worker-secret`
     - **Value**: Cole o valor que configurou na Netlify
4. Salvar

### 4. Testar

```bash
# Dentro do projeto:
npm run dev

# Em outra aba do terminal:
curl -X POST http://localhost:3000/api/internal/job-worker \
  -H "x-worker-secret: dev-secret-no-espacial-security-required-locally"

# Deve retornar: { "ok": true, "jobsProcessed": 0, ... }
```

### 5. Verificar após deploy

1. Criar nova extração em produção
2. Status deve mudar em até 60 segundos (quando cron dispara)
3. Sequência esperada: "Na fila" → "Rodando" → "Concluída"

---

## 📚 Documentação

Veja **DEPLOYMENT_NETLIFY_JOB_WORKER.md** para:
- Guia detalhado passo-a-passo
- Troubleshooting completo
- Alternativa se fizer upgrade para Netlify Pro
- Comandos curl para debug

---

## 🏗️ Arquitetura (antes vs depois)

### Antes (quebrado em Starter)
```
createExtraction() 
  → boss.send() 
    → [aqui termina, job nunca processa]
  → Extraction fica "Na fila" para sempre
```

### Depois (funciona em Starter)
```
createExtraction() 
  → boss.send() 
    → [agora detecta null e marca como erro, OU]
    → [enfileira com sucesso]

cron-job.org (a cada 1 min) 
  → POST /api/internal/job-worker
    → boss.fetch() — pega jobs da fila
    → processExtractionPage() — executa a extração
    → boss.complete() — marca como pronto
    → Extraction progride: "Na fila" → "Rodando" → "Concluída"
```

---

## 📊 Status

| Item | Status |
|---|---|
| Fix 1 (null-safety) | ✅ Implementado |
| Fix 2 (API route) | ✅ Implementado |
| Fix 3 (env vars) | ✅ Implementado |
| Testes locais | ⏳ Pronto para testar |
| Deploy Netlify | ⏳ Aguardando configuração |
| cron-job.org | ⏳ Aguardando configuração |

---

## 🔐 Segurança

- API route autenticada via `x-worker-secret` (previne qualquer um de dispararr processamento)
- Secret gerado com `openssl rand -base64 32` (seguro o suficiente para este caso)
- Se precisar de segurança adicional: pode restringir IPs de cron-job.org (eles publicam sua range)

---

## 💾 Memória do projeto

Salvo em: `extraction_bug_netlify_fix.md` (para referência futura)
