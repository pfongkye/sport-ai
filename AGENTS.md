# AGENTS.md — Notes for AI agents working in this repo

This file captures hard-won gotchas and conventions so future agents (and humans) don't
re-learn them the hard way. Read this before touching Docker, Supabase, auth, or env config.

---

## Project layout

- `app/` — Next.js 16 (App Router, TypeScript, Tailwind 4). All application code.
- `docker/` — Supabase self-hosted stack + the `app` service. Run compose from here.
- `supabase/migrations/` — ordered SQL (`001`–`008`). Applied manually, NOT auto-run.
- `.kiro/specs/sportai-coaching-app/` — requirements, design, tasks (source of truth for scope).

Run everything with an explicit env file: `docker compose --env-file .env <cmd>` from `docker/`.

---

## Critical gotchas (in priority order)

### 1. Never change `POSTGRES_PASSWORD` on an existing volume
Supabase seeds service-role passwords (`supabase_auth_admin`, `authenticator`,
`supabase_storage_admin`, etc.) from `POSTGRES_PASSWORD` **only on first DB init**.
If the `db-data` volume already exists with a different password, `auth`/`rest`/`storage`/
`realtime` crash-loop with `SQLSTATE 28P01` and Envoy returns "no healthy upstream".

**Fix**: `docker compose --env-file .env down -v` then `up -d`, then re-run migrations and
re-set the encryption key. There is no in-place fix without manually ALTERing each role.

### 2. `NEXT_PUBLIC_*` vars are baked into the browser bundle at build time
- The browser cannot resolve Docker-internal hostnames like `api-gw`.
- `NEXT_PUBLIC_SUPABASE_URL` MUST be host-reachable: `http://localhost:8000` (or Ngrok URL).
- Server-side code uses `SUPABASE_INTERNAL_URL=http://api-gw:8000` (set in compose for the
  `app` service). The split is resolved in `app/src/lib/supabase/config.ts`:
  - `SUPABASE_PUBLIC_URL` → browser
  - `SUPABASE_SERVER_URL` → server (internal URL, falls back to public when not in Docker)
- Changing any `NEXT_PUBLIC_*` requires a dev-server restart, or `--build` for the Docker app.

### 3. The API gateway is Envoy, not Kong
Supabase replaced Kong with Envoy (`envoyproxy/envoy:v1.39.0`). The gateway is the `api-gw`
service (aliased as both `envoy` and `kong` on the network). Config lives in
`docker/volumes/api/envoy/`. Do not reintroduce Kong config files.

### 4. DB init scripts only run on an empty data dir
`docker/volumes/db/*.sql` (roles, jwt, _supabase, realtime, logs, pooler, webhooks) are
mounted into `/docker-entrypoint-initdb.d/` and run ONCE on first init. Editing them after
init has no effect without a volume reset. App migrations in `supabase/migrations/` are
applied manually (see README step 3), never auto-mounted, to avoid ordering issues with
`auth.users` and the `vector` extension.

### 5. Supavisor needs `pooler.exs` mounted
Without `./volumes/pooler/pooler.exs:/etc/pooler/pooler.exs:ro`, Supavisor crashes with
"EVAL expects an expression as argument". Supavisor (pooler, port 6543) is NOT required for
the app or OAuth to function.

### 6. `app.encryption_key` must be set via `supabase_admin`
The `encrypt_api_key`/`decrypt_api_key` pgcrypto functions read a DB-level GUC. Set it with
the `supabase_admin` role over TCP — the `postgres` user gets "permission denied to set
parameter". See README step 4.

### 7. OAuth providers are disabled by default in the auth service
The app UI has Google/Apple/Facebook/Strava buttons, but GoTrue rejects them (HTTP 400)
until you set `GOOGLE_ENABLED=true` + credentials in `docker/.env` AND uncomment the
`GOTRUE_EXTERNAL_GOOGLE_*` lines in the `auth` service, then `restart auth`.

---

## Image versions (as of August 2025 — from official supabase/supabase)

Keep these in sync with the official compose when upgrading:
- `supabase/postgres:17.6.1.136`
- `supabase/gotrue:v2.189.0`
- `postgrest/postgrest:v14.12`
- `supabase/realtime:v2.102.3`
- `supabase/storage-api:v1.60.4`
- `supabase/postgres-meta:v0.96.6`
- `supabase/studio:2026.08.03-sha-022b374`
- `darthsim/imgproxy:v3.30.1`
- `supabase/supavisor:2.9.5`
- `envoyproxy/envoy:v1.39.0`

When bumping, re-fetch config files from
`https://github.com/supabase/supabase/tree/master/docker/volumes` — the gateway and pooler
configs change between versions.

---

## Conventions

- **Types**: `app/src/types/database.ts` has explicit row interfaces. `Database` is currently
  typed as `any` for dev velocity — regenerate real types with
  `npx supabase gen types typescript` once the schema stabilizes.
- **Supabase clients**: use `lib/supabase/server.ts` (server), `client.ts` (browser),
  `middleware.ts` (session refresh). Never instantiate `createServerClient` directly.
- **AI**: `CoachAgent` in `lib/ai/agents/coach.ts`. Model passed as a provider-qualified
  string (`"openai:gpt-4o"`) to avoid AI SDK ↔ Mastra version mismatches. MCP tools injected
  via `lib/mcp/client.ts`.
- **Verification**: always `npm run build` in `app/` after code changes — it runs the
  TypeScript check. The build passing is the bar before claiming a task is done.

---

## Runbook quick reference

```bash
# Full reset (fixes 90% of "stack won't start" issues)
cd docker
docker compose --env-file .env down -v
docker compose --env-file .env up -d
# wait for all 11 services healthy, then:
cd ..
for f in supabase/migrations/*.sql; do docker exec -i sportai-db psql -U postgres -d postgres < "$f"; done
ENC_KEY=$(grep SUPABASE_ENCRYPTION_KEY app/.env.local | cut -d= -f2)
source docker/.env
docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -i sportai-db psql -h 127.0.0.1 -U supabase_admin -d postgres -c "ALTER DATABASE postgres SET app.encryption_key TO '$ENC_KEY';"
```
