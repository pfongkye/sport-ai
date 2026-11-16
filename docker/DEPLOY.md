# SportAI — Production Deployment (Hybrid: Cloud Run + Supabase VM)

This is the runbook for the GCP deployment. Architecture:

```
Browser ──HTTPS──> Cloud Run: Next.js app        (https://sportai-xxxx.a.run.app)
   │                    │ server-side calls
   └──HTTPS────────────┴──> Caddy (VM :443) ──> Envoy api-gw:8000 ──> auth / rest / storage / realtime
                            (https://<dashed-ip>.nip.io)               └──> Postgres 17 + pgvector (internal only)
```

- **App** → Cloud Run (free `*.run.app` HTTPS, scales to zero).
- **Supabase stack** → one Compute Engine VM (`e2-medium`, `europe-west1`), lift-and-shifted
  via `docker-compose.yml` + `docker-compose.prod.yml`, TLS by Caddy on a `nip.io` host.
- **Studio + meta** are NOT in prod (see hardening below).

Scripts live in `deploy/gcp/`. Run them in order from your machine.

---

## Prerequisites

- `gcloud` CLI authenticated (`gcloud auth login`) and a billing-enabled project.
- Local Docker stack up (only needed for the data migration, script 05).
- Edit `deploy/gcp/.deploy.env` — set `GCP_PROJECT` and `SSH_SOURCE_RANGE=<your-ip>/32`.

---

## Manual deploy — step by step

```bash
# 1. Provision VM + static IP + firewall (prints your nip.io SUPABASE_DOMAIN)
./deploy/gcp/01_provision_vm.sh

# 2. Install Docker on the VM and clone the repo
./deploy/gcp/02_vm_bootstrap.sh

# 3. Put prod secrets on the VM, then start Supabase + migrations + encryption key
cp docker/.env.prod.example docker/.env      # fill FRESH secrets (see below)
gcloud compute scp ./docker/.env sportai-supabase:~/sportai/docker/.env --zone europe-west1-b
./deploy/gcp/03_supabase_up.sh

# 4. Build + deploy the app to Cloud Run (needs SUPABASE_DOMAIN + ANON_KEY exported)
export SUPABASE_DOMAIN=<dashed-ip>.nip.io
export ANON_KEY=<prod anon key from docker/.env>
./deploy/gcp/04_deploy_app_cloudrun.sh
# then back-fill SITE_URL + ADDITIONAL_REDIRECT_URLS on the VM .env and: up -d auth

# 5. Migrate test data (Postgres + storage files) from local → VM
./deploy/gcp/05_migrate_data.sh
```

After step 4, whitelist the Google OAuth redirect URI:
`https://<dashed-ip>.nip.io/auth/v1/callback` (the Supabase gateway callback — see
AGENTS.md #12), set `GOOGLE_ENABLED=true` + creds in the VM `docker/.env`, uncomment the
`GOTRUE_EXTERNAL_GOOGLE_*` lines, and `up -d auth`.

---

## Secrets — what to generate fresh for prod

Generate NEW values (do not reuse dev) for: `POSTGRES_PASSWORD`, `JWT_SECRET`,
`ANON_KEY`, `SERVICE_ROLE_KEY`, `VAULT_ENC_KEY`, `REALTIME_DB_ENC_KEY`,
`PG_META_CRYPTO_KEY`, `SECRET_KEY_BASE`, `DASHBOARD_PASSWORD`. Regenerate ANON/SERVICE
keys from the new `JWT_SECRET` (README "Regenerating Secrets").

**`VAULT_ENC_KEY` must be exactly 32 characters** (`openssl rand -hex 16`). A 64-char
`openssl rand -hex 32` value makes `sportai-pooler` (supavisor 2.9.5) crash-loop with
`ErlangError {:badarg,{'aead.c',90},'Unknown cipher or invalid key size'}` and burn ~170% CPU
on the 2 vCPU VM. `deploy/gcp/03_supabase_up.sh` aborts before `compose up` if the length is not 32.

### Is the pooler needed?
`sportai-pooler` (supavisor) is not used by the app: the app talks to PostgREST, which
connects straight to `db`. Nothing else in the compose files references it. It is kept
because it ships in the upstream Supabase stack, and it is internal only in prod (no
published port). It can be dropped safely if you need the CPU/RAM: stop it with
`docker compose ... stop supavisor` (or remove the service). Not removed here.

### Envoy health check for PostgREST
The `rest` cluster in `volumes/api/envoy/cds.yaml` health-checks PostgREST's admin
`/ready` on port 3001 (`PGRST_ADMIN_SERVER_HOST: 0.0.0.0`). The old `path: /` check built
the full OpenAPI document every 5s and hit `57014` statement timeouts. Port 3001 is only
on the internal docker network; no compose file publishes it (Caddy publishes only 80/443).

Apply on the VM after pulling:
```bash
cd ~/sportai/docker
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d --force-recreate rest api-gw
```
(`api-gw` is the Envoy service, container `sportai-envoy`. Env changes need a recreate, see AGENTS.md #8.)

Verify:
```bash
sudo docker exec sportai-envoy curl -s -o /dev/null -w '%{http_code}\n' http://rest:3001/ready   # 200
sudo docker exec sportai-envoy curl -s http://localhost:9901/clusters | grep '^rest::.*health_flags'  # healthy (if admin enabled)
sudo docker logs sportai-envoy --since 5m | grep -i health                     # no failures
sudo docker logs sportai-db --since 5m | grep -c 57014                        # 0 new timeouts
sudo docker exec sportai-envoy envoy --mode validate -c /etc/envoy/envoy.yaml  # config valid
```

### Encryption key (the one exception)
`app.encryption_key` (env `SUPABASE_ENCRYPTION_KEY`) is the pgcrypto symmetric key that
encrypts users' BYO AI provider keys at rest (`user_settings.ai_api_key_enc`).
- **To migrate test data cleanly:** use the SAME value as dev, so the encrypted keys decrypt.
- **For a clean prod:** use a fresh key; users then re-enter their AI keys in Settings
  (the app silently falls back to the system `OPENAI_API_KEY` until they do).
- Script 03 applies whatever `SUPABASE_ENCRYPTION_KEY` is in the VM `.env` via `supabase_admin`.

`OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` go in **Secret Manager** (script 04),
mounted into Cloud Run — never baked into the image.
**YouTube API key is NOT needed** — that feature is unimplemented; add it later when built.

---

## Network hardening (what makes this safe on a public VM)

Two independent layers keep Postgres/Studio off the internet:

1. **No public host ports** — `docker-compose.prod.yml` uses `ports: !reset []` on `db`
   (5432), `api-gw` (8000) and `supavisor` (6543). Only Caddy publishes 80/443.
2. **GCP firewall** — only 80/443 open to the world; 22 restricted to your IP.

Data isolation between users is enforced by **Postgres RLS** (owner-only policies on every
user-data table + the three storage buckets), NOT by OAuth. The service-role key (which
bypasses RLS) is used in exactly 4 server-only routes, each scoped to the authenticated
`user.id`. Google OAuth is authentication only.

### Studio is excluded from prod
`studio` and `meta` are under the `admin` compose profile, so a normal `up` never starts
them, and their host ports are reset. When you genuinely need Studio, reach it over an SSH
tunnel — never a public port:

```bash
# On the VM, start Studio on-demand:
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml \
  --profile admin up -d studio meta
# From your machine, tunnel to it:
gcloud compute ssh sportai-supabase --zone europe-west1-b -- -L 8080:localhost:8080
# then open http://localhost:8080
```

### FUTURE: admin GUI / backoffice in prod
When we want a persistent admin GUI in production, **do NOT re-expose Supabase Studio
publicly.** Studio can read/edit all users' data and bypasses RLS — it's a dev tool, gated
only by dashboard basic-auth. Instead:

- Build a **separate backoffice app** (its own service/deploy, distinct trust boundary) that
  connects to Supabase with the **service-role key server-side only**, behind its own auth
  plus an explicit allowlist of admin user IDs, and ideally IP-restricted or behind IAP.
- Or keep Studio strictly for on-demand use over the SSH/IAP tunnel above — never on a public
  port.
- Either way: off the public internet, and any service-role access is audited.

---

## CI/CD (GitHub Actions, keyless)

Recommended: GitHub Actions + **Workload Identity Federation** (no long-lived SA key in
GitHub; costs nothing extra). On push to `main`: build the app image with the
`NEXT_PUBLIC_*` build args, push to Artifact Registry, `gcloud run deploy`. Migrations run
as a **gated/manual** job. Supabase VM changes stay manual (rare, higher-risk). The
`.github/workflows/deploy.yml` is the next artifact to add.

---

## Gotchas specific to this deployment

- **`NEXT_PUBLIC_*` are baked at build time** (AGENTS.md #2). They are `--build-arg`s in
  script 04 and declared as `ARG`/`ENV` in the Dockerfile `builder` stage. Changing them
  needs a **rebuild**, not just a new Cloud Run revision.
- **`SUPABASE_INTERNAL_URL` must be unset on Cloud Run** — the app is off the Docker network,
  so server calls fall back to the public `NEXT_PUBLIC_SUPABASE_URL` (the nip.io URL). Browser
  and server then share a URL, so the pinned `storageKey` keeps PKCE cookies consistent
  (AGENTS.md #10).
- **First Caddy cert** takes ~30s; `curl -I https://<dashed-ip>.nip.io/auth/v1/health` to confirm.
- **`docker compose restart` does not reload env/config** (AGENTS.md #8) — use `up -d <svc>`.
- **nip.io is a free community service** — fine for MVP/testing; move to a real domain before
  serious production use.
