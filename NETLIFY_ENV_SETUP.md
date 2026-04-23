# Configuração de Environment Variables na Netlify

Este guia explica quais variáveis de ambiente precisam ser configuradas na Netlify para o deploy em produção.

## Onde Configurar

1. Acesse: https://app.netlify.com/sites/crm-saas-custom/settings/build
2. Vá para: **Build & deploy** → **Environment**
3. Clique: **+ Add environment variable**
4. Preencha cada variável abaixo

---

## Variáveis CRÍTICAS (Necessárias)

Sem essas, o app não funciona.

### DATABASE_URL
- **O quê**: URL de conexão do PostgreSQL
- **Onde obter**: Painel Neon ou seu provedor Postgres
- **Valor**: `postgresql://user:password@host:port/dbname?sslmode=require`
- **Exemplo**: `postgresql://crm_user:xxxxx@ep-xxx.neon.tech/crm?sslmode=require`

### AUTH_SECRET
- **O quê**: Chave de criptografia para sessions
- **Como gerar**: `openssl rand -base64 32`
- **Importante**: Gere uma nova, nunca reutilize

### AUTH_URL
- **O quê**: URL pública da sua aplicação
- **Valor para Netlify**: `https://crm-saas-custom.netlify.app`
- **Se tiver domínio customizado**: `https://seu-dominio.com`

### RESEND_API_KEY
- **O quê**: API key do Resend (email service)
- **Onde obter**: https://resend.com → Dashboard → API Keys
- **Prefixo esperado**: `re_xxxxx`

### RESEND_FROM_EMAIL
- **O quê**: Email remetente para magic links
- **Valor**: Um email verificado no Resend
- **Exemplo**: `noreply@seu-dominio.com`

### SENTRY_AUTH_TOKEN
- **O quê**: Token para upload de source maps durante build
- **Onde obter**: https://sentry.io → Settings → Auth Tokens → "Generate New Token"
- **Escopo necessário**: `project:releases`, `org:read`

### GOOGLE_PLACES_API_KEY
- **O quê**: Chave da API Google Places (para extração de dados)
- **Onde obter**: Google Cloud Console → APIs & Services → Credentials
- **APIs necessárias**: Maps Platform → Places API

---

## Variáveis IMPORTANTES (Funcionalidades)

Sem essas, algumas features não funcionam, mas o app não quebra.

### NEXT_PUBLIC_SENTRY_DSN
- **O quê**: DSN para Sentry (error tracking)
- **Onde obter**: https://sentry.io → Project → Settings → Client Keys
- **Formato**: `https://xxxxx@o000.ingest.sentry.io/999999`

### SENTRY_ORG
- **O quê**: Slug da organização no Sentry
- **Exemplo**: `seu-org-slug`

### SENTRY_PROJECT
- **O quê**: Slug do projeto no Sentry
- **Exemplo**: `crm-saas-custom`

### BING_SEARCH_API_KEY (Opcional)
- **O quê**: Fallback para busca de Instagram
- **Onde obter**: Azure Portal → "Bing Search v7"
- **Nota**: Apenas necessário se Google Places falhar

### AXIOM_TOKEN (Opcional)
- **O quê**: Token para logging estruturado
- **Onde obter**: https://axiom.co
- **Nota**: Para observabilidade de background jobs

### ALLOWED_ORIGINS
- **O quê**: Origens CORS permitidas (comma-separated)
- **Valor para Netlify**: `https://crm-saas-custom.netlify.app`
- **Se customizado**: `https://seu-dominio.com`

---

## Variáveis de CONTROLE DE ACESSO

### ALLOWED_EMAILS
- **O quê**: Emails que podem fazer login
- **Valor**: Comma-separated, sem espaços
- **Exemplo**: `user1@domain.com,user2@domain.com`
- **Nota**: Qualquer outro email é bloqueado

### OWNER_EMAIL
- **O quê**: Email do proprietário da app
- **Valor**: Um dos emails em `ALLOWED_EMAILS`
- **Efeito**: Esse usuário terá `is_owner=true` automaticamente

---

## Variáveis de LIMITES E RATE LIMITING

### MAX_EXTRACTIONS_PER_DAY
- **Default**: `20`
- **O quê**: Máximo de extrações por dia
- **Ajuste conforme**: Capacidade de API e custo

### MAX_RESULTS_PER_EXTRACTION
- **Default**: `200`
- **O quê**: Máximo de resultados por extração
- **Nota**: Controla quantidade de Google Places queries

### RATE_LIMIT_AUTH_MAX
- **Default**: `5`
- **O quê**: Máximo de tentativas de login em `RATE_LIMIT_AUTH_WINDOW_SECONDS`

### RATE_LIMIT_AUTH_WINDOW_SECONDS
- **Default**: `60`
- **O quê**: Janela de tempo para rate limiting de auth

---

## Checklist de Configuração

- [ ] `DATABASE_URL` configurado
- [ ] `AUTH_SECRET` gerado e configurado
- [ ] `AUTH_URL` apontando para domínio correto
- [ ] `RESEND_API_KEY` adicionado
- [ ] `RESEND_FROM_EMAIL` configurado
- [ ] `SENTRY_AUTH_TOKEN` adicionado (ou desabilitar Sentry no build se não tiver)
- [ ] `GOOGLE_PLACES_API_KEY` adicionado
- [ ] `NEXT_PUBLIC_SENTRY_DSN` configurado
- [ ] `SENTRY_ORG` e `SENTRY_PROJECT` preenchidos
- [ ] `ALLOWED_EMAILS` e `OWNER_EMAIL` configurados
- [ ] `ALLOWED_ORIGINS` apontando para domínio correto

---

## Variáveis que NÃO precisam estar no .env local

Essas são geradas automaticamente pela Netlify ou Next.js:

```
NODE_VERSION (no netlify.toml)
NPM_FLAGS (no netlify.toml)
CI (no netlify.toml)
NEXT_RUNTIME (gerado pelo Next.js)
NODE_ENV (gerado pelo Next.js)
```

---

## Segurança

⚠️ **Nunca**:
- Commitar arquivo `.env` no Git (está no `.gitignore`)
- Compartilhar variáveis sensíveis em chat ou email
- Usar a mesma `AUTH_SECRET` em dev e produção
- Expor API keys em logs de build

✅ **Sempre**:
- Adicionar variáveis via Netlify Dashboard (não via arquivo)
- Rotar secrets periodicamente
- Monitorar logs de erro no Sentry
- Revisar quem tem acesso ao painel Netlify
