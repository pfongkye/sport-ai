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

### 23. LLM hallucinates numbers the tools don't provide — compute, don't estimate
Symptom: coach reported a "fastest 1km" ~1 min/km faster than reality. Cause: getRecentActivities
only returns AVERAGE pace; there was no tool for peak/segment data, so the LLM invented a
plausible "fastest" figure. Averages are always slower than a best split, so any "fastest X"
derived from an average is a hallucination.
Fix (two layers):
1. Compute it server-side: `lib/ai/splits.ts` `computeBestSplits()` finds the fastest rolling
   window (400m/1km/1mile/5km/10km) from the GPS `latlng` stream (falls back to integrating the
   pace stream for treadmill). Exposed via the `getBestSplits` tool. Verified against real data:
   avg 5:41/km run → fastest 1km 5:29 (realistic, not the fabricated ~4:40).
2. Prompt guardrail: "only state a number if it came from a tool result this conversation;
   never derive 'fastest' from an average; if a tool returns null, say you don't have it."
General rule: when the coach needs a metric, there must be a TOOL that computes it from real
data. Don't rely on the LLM to derive peak/segment/aggregate values from summaries — add a
typed tool (this is also why we favour typed tools over the athlete asking open-ended MCP SQL).

### 22. coaching_messages is shared across surfaces — tag with metadata.kind
Chat and per-activity post-session insights both live in `coaching_messages` (intentionally,
for future RAG recall). Without a discriminator, insights leaked into the chat feed as
orphaned assistant messages. Convention: every message carries `metadata.kind` —
`'chat'` for the coach chat, `'post_session_insight'` for activity insights (also has
`activity_id`). The chat history query excludes non-chat kinds
(`metadata->>kind.is.null,metadata->>kind.neq.post_session_insight`; null kept defensively).
Migration `009_coaching_message_kind.sql` backfills legacy null-kind rows to 'chat'
(idempotent) and indexes `(user_id, metadata->>kind)`, so ALL rows now carry an explicit kind
— code can rely on `kind='chat'` without the null special-case. Any NEW message kind
(nutrition insight, weekly summary, etc.) must set `metadata.kind` and be filtered from
surfaces where it doesn't belong.

### 21. Readiness/TSB math needs a sparse-data guard
Symptom: coach reports "0/100 fatigued" for an athlete who just did one easy run and is
actually fresh.
Cause: ATL/CTL/TSB models need weeks of consistent data. With little history, a single recent
run makes ATL spike above a near-zero CTL → large negative TSB → the old `score = 50 + tsb*2`
scaling floored at 0. Pure garbage-in on sparse data.
Fix: `lib/ai/readiness.ts` `computeReadiness()` is the single source of truth (used by chat
route AND getTrainingLoad tool). It (a) returns a neutral/fresh score (80) with an explanatory
message when data is insufficient (< 6 sessions OR CTL < 5 OR span < 10 days), and (b)
normalises TSB by CTL (`65 + ratio*35`) so fatigue is relative to the athlete's own base. The
coach system prompt also instructs: low CTL = little history, NOT fatigue. Verified across
sparse/established/overloaded scenarios.

### 20. MCP was intentionally REMOVED from the app runtime (typed tools only)
Decision: the CoachAgent uses typed Mastra tools only (getRecentActivities, getTrainingLoad,
getPlannedSessions, getUserProfile, updateSessionStatus). MCP is NOT wired into the app.
Rationale:
- Typed tools are safe (RLS-enforced), fast, testable, and deploy anywhere.
- stdio MCP (spawning `uvx mcp-server-*`) CANNOT run on Vercel (no subprocess) — it was a
  local-dev-only convenience that wouldn't survive production.
- Supabase MCP = LLM-generated SQL with a service-role key → RLS bypass / multi-tenant
  footgun. Prefer adding typed aggregation tools (e.g. getStats, getPersonalBests) instead.
- Long-term memory: use the existing pgvector `coaching_messages.embedding` +
  `search_coaching_messages` (planned RAG), not mem0.
If MCP is genuinely needed later, use a REMOTE (HTTP) MCP service, not stdio, and re-add
`@mastra/mcp`. `app/src/lib/mcp/config-example.json` still documents Kiro IDE MCP (dev tooling).
Still true: "AI is not configured" = buildCoachAgent threw — check `[ai/chat] failed to build
agent` logs for the real cause before assuming a missing key. (MCPClient, if ever re-added,
must be a process singleton — Mastra throws on duplicate identical configs.)

### 19. Mobile "Failed to fetch" on upload — snapshot the File to memory at pick time
Symptom: file upload works on desktop but fails on mobile with "Failed to fetch"; the request
never reaches the server/tunnel; often only SOME files fail (not all).
Cause: on Android Chrome, a `File` picked from Downloads/Drive/Recent can have its underlying
OS handle revoked between selection and the later `fetch`. When `fetch` streams the body it
throws "Failed to fetch" BEFORE sending anything — which looks like a network/tunnel bug but
isn't. This is NOT ngrok (was misdiagnosed as such initially).
Fix: `ActivityUploader` snapshots each picked file into an in-memory `Blob`
(`file.arrayBuffer()`) immediately in `addFiles`, and uploads that Blob — independent of the
OS file handle. Shows "Reading…" while snapshotting; "Could not read file — re-pick it" if the
handle is already dead. Apply the same pattern to any future mobile file upload (nutrition
photos, voice notes).

### 18. ngrok free tier breaks fetch/POST via the browser interstitial (dev-only, env-gated)
Symptom: a feature works on localhost but fails only through the ngrok URL (e.g. file upload
"failed" on mobile, succeeds on desktop). The POST gets ngrok's HTML warning page, not JSON.
Cause: ngrok free tier serves a browser interstitial on requests lacking
`ngrok-skip-browser-warning` (https://ngrok.com/abuse). Page navigations pass it after a
one-time click-through, but `fetch()`/XHR calls don't, so they receive HTML.
IMPORTANT — what does NOT work: ngrok decides the interstitial at its EDGE before the agent
runs, so agent-side `request_header.add` in ngrok.yml does NOT suppress it, and Traffic
Policy add-header is explicitly blocked on free accounts. The header must come FROM the
browser.
Fix (kept vendor-neutral + dev-only): `src/lib/http.ts` `http()` wraps fetch and adds the
header ONLY when `NEXT_PUBLIC_TUNNEL_MODE === 'ngrok'` — so production fetches are pristine.
The browser Supabase client (`lib/supabase/client.ts`) injects the same header via its
`global.fetch` option, also gated on tunnel mode (its calls hit the separate Supabase
tunnel). `ngrok-sync.sh` sets `NEXT_PUBLIC_TUNNEL_MODE=ngrok` and clears it on `--local`.
New client→API calls should use `http()` not raw `fetch`. Cleaner long-term options: a custom
domain on ngrok (paid) or Cloudflare Tunnel (free) have no interstitial and need no app code.

### 17. FIT files come in variants — only activities are importable
`.FIT` is a container format: **activity** (recorded workout, has session + timed records),
**course/route** (planned route, distance-based waypoints, no session), and **workout/plan**
(structured targets). Only activity FITs are real recorded data. The parser
(`lib/importers/fit.ts`) rejects course/workout files with a clear message and requires timed
records. Coros/Garmin export both — users may accidentally pick the course file (often named
`Course...`). The upload route logs parse failures via `console.error('[activities/upload]...')`.

### 16. New npm deps must be installed INSIDE the Docker app container too
Symptom: `Module not found: Can't resolve '<pkg>'` at build/runtime even though the package
is in package.json and in the host `node_modules`.
Cause: the compose `app` service mounts an ANONYMOUS volume at `/app/node_modules`
(`- /app/node_modules` in docker-compose.yml) to keep container deps separate from the host.
A host-side `npm install` does NOT populate that volume.
Fix: after adding a dependency, install it in the container and restart:
```bash
docker exec sportai-app npm install
docker compose --env-file .env restart app
```
(Or rebuild the image: `docker compose --env-file .env up -d --build app`.) When running the
app on the HOST instead (`npm run dev`), a plain `npm install` is enough.

### 15. Middleware must not redirect /api/* routes to the login page
API routes do their own auth and return JSON (401/403). If middleware redirects
unauthenticated `/api/*` requests to `/login` (307 → HTML), client `fetch()` calls receive
an HTML page instead of JSON and break with confusing parse errors. Middleware short-circuits
`pathname.startsWith('/api/')` and lets the route handle auth itself. (Note: `/api/auth/*` is
also covered by this — it no longer needs a separate public-route entry.)

### 14. Post-login redirects bounce to localhost instead of the ngrok URL
Symptom: OAuth/login succeeds but the app redirects to `http://localhost:3000/...` instead
of staying on the ngrok URL.
Cause: `new URL(request.url).origin` and `request.nextUrl` reflect the INTERNAL address the
Next.js server received the proxied request on (localhost:3000), not the public tunnel host.
Fix: build all auth redirects from the forwarded host. `app/src/app/api/auth/callback/route.ts`
has `resolvePublicOrigin()` (x-forwarded-host/proto → NEXT_PUBLIC_APP_URL → request origin),
and `lib/supabase/middleware.ts` rewrites `url.host`/`protocol` from `x-forwarded-host` on all
its redirects. Any NEW redirect in auth/server code behind the proxy must do the same, or it
will leak localhost.

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
- **AI**: `CoachAgent` (`lib/ai/agents/coach.ts`) uses typed tools only — NO MCP in the app
  runtime (see gotcha #20). Model via `@ai-sdk/*@1` factories, stream via `streamLegacy()`.
- **RAG memory**: coaching_messages are embedded on write (`text-embedding-3-small`, 1536-dim,
  `lib/ai/embeddings.ts`). The chat route retrieves relevant past context via the
  `search_coaching_messages` RPC (`lib/ai/memory.ts`) and injects it as a system message.
  pgvector needs the embedding as a string literal `"[0.1,0.2,...]"` (`toPgVector`). Embedding
  is best-effort — if no OpenAI key, it stores null and RAG degrades to recent-window only.
  `POST /api/ai/memory/backfill` embeds pre-RAG rows (idempotent, embedding IS NULL only).
- **Voice = transcript-only**: chat voice and per-session notes transcribe audio via Whisper
  and DISCARD the audio — only the transcript is stored (RAG operates on text). Do not persist
  recordings by default (storage cost + privacy/GDPR). The `audio` bucket + nullable
  `audio_url` exist for a future opt-in "keep audio" preference; leave NULL otherwise.
- **Voice transcription endpoint — SETTLED, DO NOT CHANGE**: use OpenAI
  `/audio/transcriptions` with `language: 'en'` (a spoken-language HINT that fixes
  short-clip mis-detection). The user has decided this at least 3 times. Do NOT switch to
  `/audio/translations` — even though it force-outputs English, the user chose transcription
  so text stays in the spoken language, and i18n is planned for later (then the hint comes
  from `user_settings.language`). If you ever think translation is "better", STOP — it's the
  user's settled call; ask before changing. File: `app/src/app/api/ai/voice/transcribe/route.ts`.
- **Whisper = transcription, NOT translation (locked decision)**: the voice endpoint
  (`app/src/app/api/ai/voice/transcribe/route.ts`) MUST use OpenAI `/audio/transcriptions`
  with a `language` hint (`TRANSCRIBE_LANGUAGE`, currently `en`), so text stays in the language
  spoken. Do NOT switch to `/audio/translations` (force-English output) — the user explicitly
  decided to keep transcription. When i18n lands, drive the hint from
  `user_settings.language`. If tempted to change this for a language issue, ask the user first.
- **English-only for now (i18n deferred to Phase 7)**: don't add per-language logic yet. Voice
  transcription is intentionally pinned to English (`TRANSCRIBE_LANGUAGE='en'`), dates use
  `en-GB`. Seams to change later are marked with `TODO(i18n)` in the code
  (`api/ai/voice/transcribe`, `lib/utils.ts`); `user_settings.language`/`units` columns already
  exist. When you DO add copy, don't hardcode new user-facing strings in a way that's hard to
  extract — but full i18n is a dedicated phase, not incidental work.
- **Security**: never read `.env`/secret files (see `.kiro/steering/security.md`; enforced by
  the `block-secret-reads` PreToolUse hook). `*.env.example` templates are fine to read.
  Never echo secret values into chat, logs, or commits.
- **Testing**: no formal suite yet by design (surface area still churning). Automated tests
  (Vitest + React Testing Library + Playwright) get introduced at MVP — see the Testing
  section in `.kiro/specs/sportai-coaching-app/tasks.md`. From MVP onward: every bug fix gets
  a regression test, every new API route gets auth+happy+error tests, every new table gets an
  RLS isolation test.

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
