# Architecture — CRM Custom SaaS

## What & Why

Internal CRM for managing prospecting and sales pipelines across multiple SaaS products. Each SaaS = isolated workspace with its own leads, Kanban, and extraction jobs. Core differentiator: built-in Google Maps extractor + Instagram enrichment + triage screen.

## Stack Decisions

### Framework: Next.js 15.5.15 (App Router)
Server Components, Server Actions, and Route Handlers in one framework. Netlify's Next.js plugin gives full compatibility without Vercel.

### Database: External Postgres (own cloud)
Relational model is mandatory for CRM — leads reference stages reference projects, activities reference leads. NoSQL would require denormalization that makes queries expensive and data integrity fragile.

Connection: `postgres.js` driver. Pool size: 5 connections max (Netlify Functions are serverless, multiple concurrent invocations).

### ORM: Drizzle ORM
- Smaller bundle than Prisma (critical for serverless cold start)
- SQL-first type safety — generated types match actual DB schema
- `drizzle-kit` handles migrations deterministically
- No magic — SQL is readable and predictable

### Auth: Auth.js v5 (NextAuth) + Drizzle adapter
- Magic link via Resend as primary flow (no password = smaller attack surface)
- Email + password as fallback (bcryptjs, cost 12)
- Session as HttpOnly cookie + signed JWT
- Stores everything in own Postgres — zero external auth service

### Background Jobs: pg-boss + Netlify Scheduled Functions
- pg-boss: Postgres-native job queue. No Redis, no extra infrastructure.
- Netlify Scheduled Functions: run every 1 minute as the worker that drains the pg-boss queue.
- Long extraction jobs (100+ results) are chunked into sub-jobs per Google Places page (max 20 results/page).
- Netlify Function timeout: 26s max on Pro plan. Each sub-job processes one page = well within limit.

### Instagram Enrichment
Two-layer strategy, sequential:
1. Fetch company website → parse HTML → regex `instagram.com/(@?[a-zA-Z0-9_.]+)`
2. Fallback: Google Custom Search API — `"company name" "city" site:instagram.com`
No external scraping services — too fragile, ToS violations.

### Project Isolation (no Supabase RLS)
Enforced in code with 4 layers:
1. Next.js Middleware: validates session on all `/[project]/*` routes
2. `db.forProject(projectId, userId)` wrapper: verifies `project_members` table before any query → throws 403 if not authorized
3. `requireRole(user, projectId, minRole)` helper in every Server Action
4. Automated tests: cross-project access must return 403

### UI: shadcn/ui + Tailwind v4 + Radix primitives
Components are owned (not a dependency). Dark-first. Radix handles accessibility/keyboard nav.

### Drag & Drop: dnd-kit
Smaller, more accessible, and actively maintained vs. react-beautiful-dnd (deprecated).

### Linting & Formatting: Biome
Single config, single tool, 10–20x faster than ESLint + Prettier.

### Testing: Vitest + Playwright
- Vitest: unit + integration (business logic, DB isolation, auth helpers)
- Playwright: E2E golden paths (login, create project, extraction flow, kanban drag)

## Port Map (local dev)

| Service | Port | Notes |
|---|---|---|
| Next.js dev server | 3000 | `npm run dev` |
| Postgres (Docker) | 5433 | Avoids conflict with local Postgres (5432) |
| Drizzle Studio | 4983 | `npm run db:studio` |

## Directory Structure

```
/
├── app/
│   ├── (auth)/              # Unauthenticated routes
│   │   ├── login/
│   │   └── verify/          # Magic link verification
│   ├── (app)/               # Authenticated routes (middleware protected)
│   │   ├── [project]/       # Per-project workspace
│   │   │   ├── kanban/
│   │   │   ├── leads/
│   │   │   ├── extractions/
│   │   │   ├── triage/
│   │   │   └── settings/
│   │   └── settings/
│   │       └── security/    # Session management
│   └── api/
│       ├── auth/            # Auth.js handlers
│       └── jobs/            # Job status endpoints
├── components/
│   ├── ui/                  # shadcn/ui base components
│   ├── kanban/              # KanbanBoard, KanbanColumn, LeadCard
│   ├── leads/               # LeadDrawer, ActivityTimeline
│   └── extractions/         # ExtractionForm, TriageTable
├── lib/
│   ├── auth/                # Auth.js config, session helpers, requireRole
│   ├── db/                  # Drizzle client, forProject wrapper
│   ├── google-places/       # Places API client, job handler
│   ├── instagram-finder/    # Site parser, Custom Search client
│   └── validations/         # Zod schemas
├── db/
│   ├── schema/              # Drizzle table definitions (one file per domain)
│   └── migrations/          # Generated SQL migrations
├── netlify/
│   └── functions/           # pg-boss worker (scheduled, runs every 1min)
└── docker-compose.yml       # Local Postgres for dev
```

## Security Decisions

- TLS required on DB connection (`sslmode=require`)
- DB role: DML only on `public` schema — no `SUPERUSER`, no `CREATE`
- API keys (Google, Resend) — server-side env vars only, never client
- Rate limiting: Postgres sliding window on `/api/auth/*` (5 req/min per IP)
- Security headers: CSP, HSTS, X-Frame-Options, Referrer-Policy (see `next.config.ts`)
- Logs: PII masked (phone, email truncated in structured logs)
- Auth audit log: every login attempt (success/fail, IP, user-agent)
- Sessions: revocable via `/settings/security`

## Cost Envelope (monthly, low volume)

| Service | Cost |
|---|---|
| Netlify | $0–$19 |
| Postgres (own cloud) | Existing |
| Google Places API | ~$10–$50 (volume dependent) |
| Google Custom Search | ~$0–$5 |
| Resend | $0 (3k emails/mo free) |
| Sentry | $0 (free tier) |
| **Total** | **~$10–$75/mo** |

## Phase 2 Upgrade Path

- Jobs: migrate pg-boss → Trigger.dev v3 if volume > 1000 jobs/day
- Auth: add TOTP 2FA (Auth.js supports it natively)
- Real-time: add Pusher/Soketi for live Kanban updates
- Multi-user: RBAC is already modeled — just add invitation flow
- LLM scoring: lead fit score via Claude API, agent-first prospecting assistant
