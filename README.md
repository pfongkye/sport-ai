# SportAI — AI-Powered Athletic Coaching

A personal coaching platform for multi-sport athletes (running, football, gym) with voice-first AI interaction, training plan generation, activity tracking, and nutrition logging.

**Current goal**: Marathon 3h30, November 2026.

---

## Project Structure

```
sportai/
├── app/                  # Next.js 16 application (TypeScript)
│   ├── src/
│   │   ├── app/          # App Router pages and API routes
│   │   ├── components/   # UI components
│   │   ├── lib/          # Supabase clients, AI agents, importers
│   │   └── types/        # TypeScript types
│   └── .env.local        # App environment variables (you create this)
├── docker/               # Docker Compose + Supabase self-hosted stack
│   ├── docker-compose.yml
│   ├── .env              # Docker stack secrets (you create this)
│   ├── kong.yml          # Kong API gateway config
│   └── vector.yml        # Log aggregation config
├── supabase/
│   └── migrations/       # Ordered SQL migration files
└── .kiro/specs/          # Feature specs (requirements, design, tasks)
```

---

## Prerequisites

- [Node.js](https://nodejs.org) v20+ (v22 recommended)
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) — running
- [ngrok](https://ngrok.com) — optional, for mobile testing

---

## 1. Environment Setup

There are two `.env` files to create. Both are already populated with generated secrets — you only need to add your own API keys.

### 1a. Docker stack — `docker/.env`

This file controls the Supabase self-hosted stack (Postgres, Auth, Storage, Studio).

```bash
cp docker/.env.example docker/.env
```

The `.env.example` is pre-filled with generated secrets. The only values you need to add are OAuth provider credentials if you want Google/Facebook login locally:

```bash
# docker/.env — only these need real values for OAuth to work locally
ENABLE_GOOGLE_SIGNUP=true
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

> **OAuth setup**: Create a project at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials).
> Set the authorised redirect URI to: `http://localhost:8000/auth/v1/callback`

For local testing without OAuth, you can leave them empty — email/password login still works.

---

### 1b. Next.js app — `app/.env.local`

This file configures the Next.js application.

```bash
cp app/.env.local.example app/.env.local
```

Then open `app/.env.local` and fill in:

```bash
# Required — your OpenAI key (used as system default for AI coaching)
OPENAI_API_KEY=sk-...

# Required for YouTube video search in the coach
YOUTUBE_API_KEY=...         # console.cloud.google.com → YouTube Data API v3

# Optional — USDA food database for nutrition macro lookup (free)
USDA_API_KEY=...            # https://fdc.nal.usda.gov/api-guide.html

# Optional — mem0 for long-term coaching memory
MEM0_API_KEY=...            # https://app.mem0.ai
```

The Supabase URL and API keys in `.env.local` are already set to point at your local Docker stack — no changes needed unless you switch to Supabase managed cloud.

> **Key relationship**: `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` in `app/.env.local`
> must match `ANON_KEY` and `SERVICE_ROLE_KEY` in `docker/.env`.
> They are already in sync — only change them together if you regenerate secrets.

---

## 2. Start the Supabase Stack

```bash
cd docker
docker compose --env-file .env up -d
```

First run pulls ~1.5 GB of images — takes 2–3 minutes. Subsequent starts take ~20 seconds.

**Verify everything is healthy:**

```bash
docker compose --env-file .env ps
```

All services should show `running` or `healthy`. If `auth` or `rest` show unhealthy, wait another 30 seconds and check again — they depend on Postgres being fully ready.

**Services started:**

| Service | URL | Purpose |
|---|---|---|
| Kong (API gateway) | http://localhost:8000 | Supabase API entry point |
| Supabase Studio | http://localhost:8080 | DB browser and admin UI |
| Postgres | localhost:5432 | Database (user: `postgres`) |
| Auth (GoTrue) | internal | OAuth + JWT |
| Storage | internal | File storage |
| Realtime | internal | Websocket subscriptions |

---

## 3. Run Database Migrations

After the stack is healthy, apply the schema:

```bash
# From the workspace root
cd /path/to/sportai

for f in supabase/migrations/*.sql; do
  echo "→ $f"
  docker exec -i sportai-db psql -U postgres -d postgres < "$f"
done
```

This creates all tables, RLS policies, pgvector indexes, storage buckets, and helper functions.

To re-run a single migration:

```bash
docker exec -i sportai-db psql -U postgres -d postgres < supabase/migrations/005_coaching.sql
```

To open a Postgres shell:

```bash
docker exec -it sportai-db psql -U postgres -d postgres
```

---

## 4. Start the App

```bash
cd app
npm install        # first time only
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

You'll be redirected to `/login`. On first login you'll be sent through `/onboarding` to set your profile and goal, then land on `/dashboard`.

---

## 5. Mobile Testing with Ngrok

To test on your phone or share with other athletes:

```bash
ngrok http 3000
# → https://abc123.ngrok-free.app  (temporary URL, changes on restart)
```

For a **stable URL** (needed so OAuth redirect URIs don't break on restart), use a free Ngrok account with a static domain:

```bash
ngrok http --domain=sportai.ngrok.io 3000
```

Then update your env files:

**`app/.env.local`:**
```bash
NEXT_PUBLIC_APP_URL=https://sportai.ngrok.io
```

**`docker/.env`:**
```bash
SITE_URL=https://sportai.ngrok.io
ADDITIONAL_REDIRECT_URLS=https://sportai.ngrok.io/**
```

Restart the auth service to pick up the new URLs:

```bash
cd docker
docker compose --env-file .env restart auth
```

Also update your OAuth provider redirect URIs to include `https://sportai.ngrok.io/auth/v1/callback`.

---

## 6. Regenerating Secrets (optional)

If you need fresh secrets — for example when sharing the project with another developer:

```bash
# New Postgres password
openssl rand -base64 32 | tr -d '=+/' | cut -c1-32

# New JWT secret (min 32 chars)
openssl rand -base64 48 | tr -d '\n'

# Regenerate ANON_KEY and SERVICE_ROLE_KEY after changing JWT_SECRET
# Run from the app directory:
node -e "
const c = require('crypto');
const s = 'YOUR_NEW_JWT_SECRET';
const b = (v) => Buffer.from(v).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
const j = (p) => { const h=b(JSON.stringify({alg:'HS256',typ:'JWT'})), d=b(JSON.stringify(p)), sig=c.createHmac('sha256',s).update(h+'.'+d).digest('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,''); return h+'.'+d+'.'+sig; };
console.log('ANON_KEY=' + j({role:'anon',iss:'supabase',iat:1700000000,exp:99999999999}));
console.log('SERVICE_ROLE_KEY=' + j({role:'service_role',iss:'supabase',iat:1700000000,exp:99999999999}));
"
```

After updating secrets, run `docker compose --env-file .env down -v && docker compose --env-file .env up -d` to reset the stack with the new values.

---

## Common Commands

```bash
# ── Docker stack ──────────────────────────────────────────────
cd docker

# Start
docker compose --env-file .env up -d

# Stop (preserves data)
docker compose --env-file .env down

# Stop and wipe all data (full reset)
docker compose --env-file .env down -v

# View logs (all services)
docker compose --env-file .env logs -f

# View logs (specific service)
docker compose --env-file .env logs -f auth
docker compose --env-file .env logs -f app
docker compose --env-file .env logs -f db

# Restart a single service
docker compose --env-file .env restart auth

# ── App ───────────────────────────────────────────────────────
cd app

npm run dev          # development server (hot reload)
npm run build        # production build
npm run lint         # ESLint

# ── Database ──────────────────────────────────────────────────

# Run all migrations
for f in ../supabase/migrations/*.sql; do
  docker exec -i sportai-db psql -U postgres -d postgres < "$f"
done

# Open Postgres shell
docker exec -it sportai-db psql -U postgres -d postgres

# Regenerate TypeScript types from live schema
npx supabase gen types typescript \
  --db-url postgresql://postgres:YOUR_POSTGRES_PASSWORD@localhost:5432/postgres \
  > app/src/types/database.ts
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 16 (App Router) + Tailwind CSS + shadcn/ui |
| AI Framework | Mastra AI (agents, tools, workflows) |
| MCP Servers | Supabase MCP, Fetch MCP, mem0 Memory MCP |
| Auth | Supabase Auth (Google, Apple, Facebook, Strava OAuth) |
| Database | Supabase Postgres + pgvector |
| Storage | Supabase Storage |
| Voice | Web Speech API + OpenAI Whisper |
| Activity parsing | fit-file-parser (.FIT), gpxparser (.GPX), custom (.TCX) |
| Charts | Recharts |
| Maps | Leaflet + react-leaflet |
| Dev infra | Docker Compose + Ngrok |
| Prod hosting | Vercel + Supabase managed |

---

## Implementation Phases

| Phase | Focus | Status |
|---|---|---|
| 1 | Auth, activity upload (.FIT/.GPX/.TCX), dashboard | Scaffolded |
| 2 | AI coaching chat, voice interface, RAG memory | Agents wired |
| 3 | Training plan, readiness score, fatigue adaptation | Spec ready |
| 4 | Nutrition photo logging, YouTube video search | Spec ready |
| 5 | PWA, data visualisation, polish | Spec ready |
| 6 | Strava/Garmin API, AI gateway, SaaS billing | Post-marathon |

See full spec: `.kiro/specs/sportai-coaching-app/`
