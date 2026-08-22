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
│   └── volumes/          # Supabase config (Envoy gateway, DB init, pooler)
│       ├── api/envoy/    # Envoy API gateway config
│       ├── db/           # Postgres init scripts (roles, jwt, _supabase, ...)
│       └── pooler/       # Supavisor pooler config
├── supabase/
│   └── migrations/       # Ordered SQL migration files (001–008)
├── AGENTS.md             # Notes for AI agents working in this repo
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

The `.env.example` is pre-filled with generated secrets (Postgres password, JWT secret,
ANON/SERVICE keys, and the various encryption keys the current Supabase stack requires:
`VAULT_ENC_KEY`, `REALTIME_DB_ENC_KEY`, `PG_META_CRYPTO_KEY`, `S3_PROTOCOL_*`).

For a first local run you don't need to change anything — email login works out of the box.
To enable social login later, see [Enabling Google Sign-In](#enabling-google-sign-in).

> **Do not change `POSTGRES_PASSWORD` after the stack has been initialized** without a
> volume reset — see [Troubleshooting](#troubleshooting).

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

First run pulls ~1.5 GB of images — takes 2–3 minutes. Subsequent starts take ~20 seconds.

**Verify everything is healthy:**

```bash
docker compose --env-file .env ps
```

All 11 services should show `healthy`. If `auth`, `rest`, `realtime`, or `storage` show
`Restarting`, see [Troubleshooting](#troubleshooting) — this is almost always a stale
database volume with a mismatched password.

**Services started:**

| Service | URL | Purpose |
|---|---|---|
| Envoy (API gateway) | http://localhost:8000 | Supabase API entry point (replaced Kong) |
| Supabase Studio | http://localhost:8080 | DB browser and admin UI |
| Postgres 17 | localhost:5432 | Database (user: `postgres`) |
| Supavisor | localhost:6543 | Connection pooler (transaction mode) |
| Auth (GoTrue) | internal | OAuth + JWT |
| PostgREST | internal | Auto REST API |
| Storage | internal | File storage |
| Realtime | internal | Websocket subscriptions |
| postgres-meta | internal | Schema introspection for Studio |
| imgproxy | internal | Image transformation |

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

## 4. Set the encryption key (one-time, for AI provider API keys)

The `encrypt_api_key`/`decrypt_api_key` functions need a DB-level encryption key.
Set it once after the first migration run (must use the `supabase_admin` role):

```bash
# From workspace root — reads SUPABASE_ENCRYPTION_KEY from app/.env.local
ENC_KEY=$(grep SUPABASE_ENCRYPTION_KEY app/.env.local | cut -d= -f2)
source docker/.env
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -i sportai-db \
  psql -h 127.0.0.1 -U supabase_admin -d postgres \
  -c "ALTER DATABASE postgres SET app.encryption_key TO '$ENC_KEY';"
```

---

## 5. Start the App

You can run the app **two ways**. Pick one.

### Option A — App on the host (recommended for development)

Fastest hot reload, easiest debugging. The browser and the Next.js server both run on
your host, so both use `http://localhost:8000` to reach Supabase.

```bash
cd app
npm install        # first time only
npm run dev
```

### Option B — App inside Docker

The `app` service is included in the compose stack. In this mode the browser uses
`http://localhost:8000` (baked into the bundle via `NEXT_PUBLIC_SUPABASE_URL`) while the
Next.js server uses the internal `http://api-gw:8000` (via `SUPABASE_INTERNAL_URL`). This
split is handled automatically in `src/lib/supabase/config.ts`.

```bash
cd docker
docker compose --env-file .env up -d --build app
```

> If you change `NEXT_PUBLIC_*` variables, you MUST rebuild the app image
> (`--build`) — these are baked into the browser bundle at build time.

Open [http://localhost:3000](http://localhost:3000).

You'll be redirected to `/login`. On first login you'll be sent through `/onboarding` to
set your profile and goal, then land on `/dashboard`.

---

## 6. Mobile Testing with Ngrok

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

## 7. Regenerating Secrets (optional)

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

> **Important**: changing `POSTGRES_PASSWORD` on an existing stack **requires** a volume
> reset (`down -v`). Service-role passwords are only seeded on first DB init — see
> [Troubleshooting](#troubleshooting).

---

## Enabling Google Sign-In

Social login is wired in the app but disabled in the auth service by default. To enable Google:

1. Create OAuth credentials at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
2. Add authorised redirect URI: `http://localhost:8000/auth/v1/callback`
   (and your Ngrok equivalent if testing on mobile)
3. In `docker/.env`, set:
   ```bash
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=your-client-id
   GOOGLE_SECRET=your-client-secret
   ```
4. In `docker/docker-compose.yml`, uncomment the four `GOTRUE_EXTERNAL_GOOGLE_*` lines in the `auth` service
5. Restart auth:
   ```bash
   cd docker && docker compose --env-file .env restart auth
   ```

The same pattern applies to Facebook (`FACEBOOK_*`) and other providers.

---

## Troubleshooting

### `auth` / `rest` / `storage` containers stuck `Restarting`, or Envoy returns "no healthy upstream"

**Symptom**: `docker compose ps` shows services restarting. Logs show:
```
password authentication failed for user "supabase_auth_admin" (SQLSTATE 28P01)
```

**Cause**: Supabase seeds service-role passwords (`supabase_auth_admin`, `authenticator`,
`supabase_storage_admin`, etc.) from `POSTGRES_PASSWORD` **only on the first database
initialization**. If the `db-data` volume was created with a different password, every
dependent service fails to authenticate.

**Fix** (wipes local DB data — safe for dev):
```bash
cd docker
docker compose --env-file .env down -v   # -v removes the stale volume
docker compose --env-file .env up -d
# then re-run migrations (step 3) and re-set the encryption key (step 4)
```

---

### Browser shows "This site can't be reached — check if there is a typo in api-gw"

**Cause**: A `NEXT_PUBLIC_SUPABASE_URL` pointing at the Docker-internal hostname
`api-gw` leaked into the browser bundle. The browser runs on your host and can't resolve
Docker network hostnames.

**Fix**: `NEXT_PUBLIC_SUPABASE_URL` must be `http://localhost:8000` (host-reachable).
Server-side code uses `SUPABASE_INTERNAL_URL=http://api-gw:8000` separately. If you edited
these, rebuild the app image so the corrected value is baked in:
```bash
cd docker && docker compose --env-file .env up -d --build app
```

---

### Envoy 400 on `/auth/v1/authorize?provider=google`

Auth is running but Google OAuth isn't enabled. See [Enabling Google Sign-In](#enabling-google-sign-in).

---

### `{"error_code":"validation_failed","msg":"Unsupported provider: provider is not enabled"}`

**Cause**: The credentials are in `docker/.env` and the `GOTRUE_EXTERNAL_GOOGLE_*` lines are
uncommented in `docker-compose.yml`, but the `auth` container was created **before** those
changes. `docker compose restart` reuses the existing container and does NOT reload
environment variables.

**Fix**: recreate the container (not restart):
```bash
cd docker && docker compose --env-file .env up -d auth
```
Verify the vars are actually present:
```bash
docker exec sportai-auth env | grep -i GOOGLE   # should list all 4 GOTRUE_EXTERNAL_GOOGLE_*
```
A working authorize endpoint returns `HTTP 302` redirecting to `accounts.google.com`.

> **General rule**: `restart` never reloads env or compose config — always use
> `up -d <service>` after editing `.env` or `docker-compose.yml`.

---

### Google returns `redirect_uri_mismatch`

The OAuth flow sends `redirect_uri=http://localhost:8000/auth/v1/callback` (the GoTrue
callback, NOT the app callback). This exact URI must be registered as an authorized redirect
URI in your Google OAuth client at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials).
Note it's the `:8000/auth/v1/callback` gateway URL, not `:3000/api/auth/callback`.

---

### OAuth completes at Google but you land back on `/login?redirectTo=%2Fapi%2Fauth%2Fcallback`

**Cause**: The auth middleware treated the OAuth callback route as protected. The callback
runs before the session exists (it's what creates the session), so middleware bounced it to
login and the code exchange never ran.

**Fix**: `/api/auth/*` must be in the middleware public-routes list. Static assets
(`/manifest.json`, icons) should also be skipped or they get redirected too. This is handled
in `app/src/lib/supabase/middleware.ts`. Restart the app after changing it:
```bash
cd docker && docker compose --env-file .env restart app
```

> Note: the middleware entry file is `app/src/proxy.ts` (Next.js 16 renamed `middleware.ts`
> → `proxy.ts`). The core logic still lives in `lib/supabase/middleware.ts`.

---

### Supavisor (`sportai-pooler`) restarting with "EVAL expects an expression as argument"

**Cause**: The `pooler.exs` config file isn't mounted into the container.

**Fix**: Ensure `docker-compose.yml` mounts it in the `supavisor` service:
```yaml
volumes:
  - ./volumes/pooler/pooler.exs:/etc/pooler/pooler.exs:ro
```
Then `docker compose --env-file .env up -d supavisor`. Note: Supavisor is not required
for the app or OAuth — it's the transaction pooler on port 6543.

---

### `permission denied to set parameter "app.encryption_key"`

**Cause**: The `postgres` user in the Supabase image can't set database-level parameters.

**Fix**: Use the `supabase_admin` role over TCP (see step 4).

---

### `NEXT_PUBLIC_*` changes not taking effect

These are compiled into the browser bundle at build time. A running dev server picks up
changes on restart; a Docker `app` container needs `--build`. Never expect a `NEXT_PUBLIC_*`
change to apply without a restart/rebuild.

---

### OAuth works locally but breaks after Ngrok restart

Free Ngrok URLs rotate on restart. Either use a stable Ngrok domain (paid/reserved) or
update `SITE_URL` + `ADDITIONAL_REDIRECT_URLS` in `docker/.env`, the OAuth provider's
redirect URI, and `NEXT_PUBLIC_APP_URL` every time, then `restart auth`.

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
