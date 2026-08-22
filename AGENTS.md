# AGENTS.md — Notes for AI agents working in this repo

This file captures hard-won gotchas and conventions so future agents (and humans) don't
re-learn them the hard way. Read this before touching Docker, Supabase, auth, or env config.

> **Maintenance directive** (for agents): whenever you diagnose a non-obvious failure,
> discover a setup step that wasn't documented, or hit anything a future agent would waste
> time re-learning, add it here (and to the README Troubleshooting section if user-facing)
> WITHOUT being asked. Keep entries concise: symptom → cause → fix. Number new gotchas
> sequentially. This is a living memory file.

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
The app UI has Google/Apple/Facebook/Strava buttons, but GoTrue rejects them (HTTP 400,
`"provider is not enabled"`) until you set `GOOGLE_ENABLED=true` + credentials in
`docker/.env` AND uncomment the `GOTRUE_EXTERNAL_GOOGLE_*` lines (all four, including
`REDIRECT_URI`) in the `auth` service, then recreate the container (see gotcha #8).
The Google OAuth client must register `http://localhost:8000/auth/v1/callback` (the GoTrue
gateway callback, NOT the app's `:3000/api/auth/callback`) or Google returns
`redirect_uri_mismatch`.

### 11. Ngrok mobile testing needs TWO tunnels; HMR WebSocket errors are harmless
Symptom: `wss://<ngrok>/_next/hmr ... failed` console errors; login page renders on phone
but sign-in fails.
Causes & fixes:
- **HMR WebSocket errors**: dev-server hot-reload socket that ngrok free tier can't proxy.
  HARMLESS — no functional impact. Eliminate entirely by testing with a production build
  (`npm run build && npm start`) instead of `npm run dev`.
- **Auth/DB fails on phone**: `localhost:8000` on a phone means the phone itself. You must
  tunnel BOTH the app (3000) and Supabase (8000), then set `NEXT_PUBLIC_SUPABASE_URL` +
  the `docker/.env` URLs to the public tunnel URLs. Config: `docker/ngrok.yml`
  (`ngrok start --all --config docker/ngrok.yml`).
- Free ngrok rotates domains each restart → run `./docker/ngrok-sync.sh` (reads live tunnel
  URLs from ngrok's local API at :4040 and rewrites both `.env` files), rebuild app
  (NEXT_PUBLIC baked in), `up -d auth`. `ngrok-sync.sh --local` reverts to localhost.
- Free plan gives ONE stable dev domain. Pin it to the SUPABASE tunnel via
  `NGROK_SUPABASE_DOMAIN` (in `docker/.env`) — then Google's callback URL is stable and you
  whitelist it ONCE. The app tunnel can rotate (not referenced by Google). A paid plan is
  only needed for a SECOND stable domain or a custom name.
- `docker/ngrok.yml` is a TEMPLATE using `${NGROK_AUTHTOKEN}` and `${NGROK_SUPABASE_DOMAIN}`.
  Don't run it directly — use `./docker/ngrok-start.sh`, which reads those from `docker/.env`
  (shell env wins), renders `docker/.ngrok.rendered.yml` via envsubst, and starts both
  tunnels. The rendered file is gitignored (contains the authtoken).

### 13. 403 on /_next/static/* through ngrok → allowedDevOrigins
Symptom: `GET https://<ngrok>/_next/static/chunks/....js 403 (Forbidden)`; app shell won't
load through the tunnel. Dev-server log shows "Blocked cross-origin request to Next.js dev
resource".
Cause: Next.js blocks cross-origin requests to `/_next/*` dev resources by default. The ngrok
host is a different origin than `localhost`, so chunks 403.
Fix: `allowedDevOrigins` in `app/next.config.ts` includes `*.ngrok-free.app` /`*.ngrok.app`/
`*.ngrok.io` wildcards, PLUS reads `NEXT_ALLOWED_DEV_ORIGINS` (comma-separated) which
`ngrok-sync.sh` sets to the exact rotating app host (belt-and-suspenders, since wildcard
support has been buggy in some Next versions). Restart the dev server after changes. This
only affects `npm run dev` — a production build (`npm start`) has no dev-resource guard.

### 12. Google OAuth needs the redirect URI, NOT a JavaScript origin
This app uses the server-side authorization-code flow (browser → Supabase → Google →
Supabase `/auth/v1/callback`). The browser never calls Google via JS, so **Authorized
JavaScript origins** are NOT needed. Only **Authorized redirect URIs** matter, and it must be
the Supabase gateway callback (`:8000/auth/v1/callback` or the ngrok Supabase URL), NOT the
app's `:3000/api/auth/callback`. Use `localhost` consistently (Google treats `localhost` and
`127.0.0.1` as distinct origins).

### 10. PKCE verifier not found — browser and server clients must share a storageKey
Symptom: OAuth callback fails with `pkce_code_verifier_not_found` (HTTP 400); user bounces
back to `/login?error=auth_callback_failed`.
Cause: `@supabase/ssr` derives the auth cookie name from the Supabase URL's project ref.
Our browser client uses the PUBLIC url (`localhost:8000`) and the server client uses the
INTERNAL url (`api-gw:8000`) — so they compute DIFFERENT cookie keys. The verifier written
by the browser is never found by the server callback.
Fix: pin an explicit `storageKey` (`SUPABASE_STORAGE_KEY` in `lib/supabase/config.ts`) and
`flowType: 'pkce'` on ALL three clients (browser, server, middleware) so cookie names match
regardless of URL. After changing the storageKey, clear existing `sb-*` cookies in the
browser or old cookies linger under the previous key.

### 9. Auth middleware must whitelist `/api/auth/*` and static assets
The OAuth callback route (`/api/auth/callback`) runs BEFORE the user has a session — it's
the thing that creates the session by exchanging the code. If middleware treats it as
protected, it redirects to `/login?redirectTo=%2Fapi%2Fauth%2Fcallback` and the code
exchange never happens (symptom: OAuth completes at Google but you land back on login).
Public routes list must include `/api/auth` (not just `/auth/callback`). Also skip static
assets (`/manifest.json`, icons, images) or they get bounced to login too.
See `app/src/lib/supabase/middleware.ts`.

Note: the middleware entry file is `app/src/proxy.ts` (Next.js 16 renamed `middleware.ts`
→ `proxy.ts`; the exported function is `proxy`, not `middleware`).

### 8. `docker compose restart` does NOT reload env vars or compose config
This is the single most common trap when editing `.env` or `docker-compose.yml`.
`restart` reuses the existing container as-is. To apply config changes you MUST recreate:
```bash
docker compose --env-file .env up -d <service>   # recreates if config changed
```
Verify a service picked up new env with `docker exec <container> env | grep <VAR>`.
For `NEXT_PUBLIC_*` changes to the app, add `--build` (see gotcha #2).

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
