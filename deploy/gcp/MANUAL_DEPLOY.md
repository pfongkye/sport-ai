# SportAI — Manual GCP Deployment (step by step)

A start-to-finish manual deploy of SportAI to GCP using the scripts in
`deploy/gcp/`. No CI/CD — you run each script yourself and copy a couple of
values between steps.

**Architecture recap**

```
Browser ──HTTPS──> Cloud Run: Next.js app        (https://sportai-xxxx.a.run.app)
   │                    │ server-side calls
   └──HTTPS────────────┴──> Caddy (VM :443) ──> Envoy api-gw:8000 ──> auth / rest / storage / realtime
                            (https://<dashed-ip>.nip.io)               └──> Postgres 17 + pgvector (internal only)
```

- **App** → Cloud Run (free `*.run.app` HTTPS, scales to zero).
- **Supabase stack** → one Compute Engine VM (`e2-medium`, `europe-west1`), your
  `docker-compose.yml` + `docker-compose.prod.yml`, TLS via Caddy on a `nip.io` host.
- **Studio/meta** excluded from prod; only Caddy is public (80/443).

**Time**: ~45–60 min the first time. **Cost**: ~$25/mo VM + near-zero Cloud Run at MVP traffic.

---

## 0. Prerequisites (once)

1. **Install the gcloud CLI** and log in:
   ```bash
   gcloud auth login
   gcloud auth application-default login
   ```
2. **Create a project** (or use an existing one) and make sure **billing is enabled**:
   ```bash
   gcloud projects create sportai-prod --name="SportAI Prod"   # or reuse one
   gcloud billing projects link sportai-prod --billing-account=XXXXXX-XXXXXX-XXXXXX
   ```
   List billing accounts with `gcloud billing accounts list`.
3. **Docker running locally** (needed only for the data migration in step 8, and if
   you build the image locally instead of Cloud Build).
4. **Find your public IP** (to lock down SSH):
   ```bash
   curl -s ifconfig.me
   ```

---

## 1. Configure the deploy scripts

Edit `deploy/gcp/config.sh` and set at least:

| Variable | Set to | Notes |
|---|---|---|
| `GCP_PROJECT` | `sportai-prod` | your project id |
| `SSH_SOURCE_RANGE` | `<your-ip>/32` | from `curl ifconfig.me`; locks SSH to you |
| `GCP_REGION` | `europe-west1` | default is fine |
| `GCP_ZONE` | `europe-west1-b` | default is fine |
| `VM_MACHINE_TYPE` | `e2-medium` | cheapest sensible for the stack |

Everything else has sensible defaults. `REPO_URL` (step 3) defaults to your git `origin`.

---

## 2. Provision the VM + network  →  `01_provision_vm.sh`

```bash
./deploy/gcp/01_provision_vm.sh
```

What it does:
- Enables APIs (compute, artifactregistry, run, secretmanager, iamcredentials).
- Reserves a **static external IP** and prints your **`nip.io` host**.
- Creates firewall rules: **80/443 open to the world**, **22 only from `SSH_SOURCE_RANGE`**.
- Creates the VM (`e2-medium`, Ubuntu 22.04, tagged `sportai-supabase`).

**➡ Write down the line it prints:**
```
nip.io host = 34-120-55-10.nip.io   ← this is your SUPABASE_DOMAIN
```
You'll reuse this everywhere. (Your value will differ — it's your VM's IP with dashes.)

---

## 3. Install Docker on the VM + clone the repo  →  `02_vm_bootstrap.sh`

```bash
./deploy/gcp/02_vm_bootstrap.sh
```

Installs Docker + the compose plugin on the VM and clones your repo to `~/sportai`.
The repo (`https://github.com/pfongkye/sport-ai.git`) is **public**, so the clone needs
no credentials — `REPO_URL` defaults to your git `origin` and just works.

> The whole monorepo is cloned (`app/`, `docker/`, `supabase/`, `deploy/`), which is
> required: `docker/docker-compose.yml` uses relative paths (`context: ../app`,
> `dockerfile: ../docker/Dockerfile`) and script 03 runs compose from `~/sportai/docker`,
> so all sibling folders must be present. Don't sparse-checkout a single folder.

> If you later make the repo private, give the VM access via an SSH deploy key, or set
> `REPO_URL` to an HTTPS URL with a token:
> ```bash
> REPO_URL="https://<user>:<token>@github.com/pfongkye/sport-ai.git" ./deploy/gcp/02_vm_bootstrap.sh
> ```

---

## 4. Create the production env file and copy it to the VM

Start from the template and fill it in **locally**:
```bash
cp docker/.env.prod.example docker/.env.prod
```

### 4a. Generate fresh secrets
Generate NEW values for prod (do **not** reuse dev), e.g.:
```bash
openssl rand -hex 32     # good for JWT_SECRET / *_ENC_KEY / SECRET_KEY_BASE / passwords
```
Fill these in `docker/.env.prod`:

| Key | How to get it |
|---|---|
| `POSTGRES_PASSWORD` | fresh random |
| `JWT_SECRET` | fresh random (≥32 chars) |
| `ANON_KEY`, `SERVICE_ROLE_KEY` | **regenerate from the new `JWT_SECRET`** — see README “Regenerating Secrets”. They are signed JWTs; they must match `JWT_SECRET` or auth breaks. |
| `VAULT_ENC_KEY`, `REALTIME_DB_ENC_KEY`, `PG_META_CRYPTO_KEY`, `SECRET_KEY_BASE` | fresh random |
| `DASHBOARD_PASSWORD` | fresh random (Studio basic-auth, admin profile only) |

### 4b. Set the URLs (use your nip.io host from step 2)
```dotenv
SUPABASE_DOMAIN=34-120-55-10.nip.io
API_EXTERNAL_URL=https://34-120-55-10.nip.io
SUPABASE_PUBLIC_URL=https://34-120-55-10.nip.io
# SITE_URL + ADDITIONAL_REDIRECT_URLS are filled AFTER Cloud Run exists (step 7).
SITE_URL=https://placeholder.a.run.app
ADDITIONAL_REDIRECT_URLS=https://placeholder.a.run.app/**
```

### 4c. Encryption key decision (`SUPABASE_ENCRYPTION_KEY`)
This is the pgcrypto key protecting users' stored AI keys.
- **Migrating your test data?** Set it to the **same value as dev** so encrypted keys decrypt.
  (Reference it by key name from `app/.env.local` — `SUPABASE_ENCRYPTION_KEY` — don't echo it.)
- **Clean prod?** Use a fresh random value; users re-enter their AI key in Settings.

### 4d. Leave Google OAuth off for now
```dotenv
GOOGLE_ENABLED=false
```
You'll turn it on in step 9 once the callback URL is whitelisted.

### 4e. Copy the file to the VM (as `docker/.env`)
```bash
gcloud compute scp ./docker/.env.prod sportai-supabase:~/sportai/docker/.env --zone europe-west1-b
```
> `docker/.env.prod` is your local working copy; the VM only ever reads `docker/.env`.
> Never commit either — both are gitignored.

---

## 5. Start Supabase + run migrations + set the encryption key  →  `03_supabase_up.sh`

```bash
./deploy/gcp/03_supabase_up.sh
```

What it does on the VM:
- `docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d`
  (hardened: no Studio/meta, no public DB port, Caddy on 80/443).
- Applies `supabase/migrations/001…010`.
- Sets the DB `app.encryption_key` from `SUPABASE_ENCRYPTION_KEY` via `supabase_admin`.

**Verify TLS** (Caddy needs ~30s to get the first Let's Encrypt cert):
```bash
curl -I https://34-120-55-10.nip.io/auth/v1/health      # expect HTTP/2 200
```
If it fails, wait a bit and retry; check `sudo docker logs sportai-caddy` on the VM.

---

## 6. Put runtime secrets in Secret Manager (for Cloud Run)

The app needs these at runtime; they are mounted into Cloud Run, never baked into the image.
```bash
# OpenAI key
printf '%s' 'sk-...your-openai-key...' | gcloud secrets create OPENAI_API_KEY --data-file=- --replication-policy=automatic
# Service-role key (MUST equal SERVICE_ROLE_KEY in the VM docker/.env)
printf '%s' '<your prod service_role key>' | gcloud secrets create SUPABASE_SERVICE_ROLE_KEY --data-file=- --replication-policy=automatic
```
(If a secret already exists, add a new version with `gcloud secrets versions add NAME --data-file=-`.)
`04_deploy_app_cloudrun.sh` also auto-creates these as empty if missing — but you must add a value before the app will work.
**YouTube key is NOT needed** (feature unimplemented) — skip it.

---

## 7. Build + deploy the app to Cloud Run  →  `04_deploy_app_cloudrun.sh`

The app needs two build-time values (baked into the browser bundle) — pass them as env:
```bash
export SUPABASE_DOMAIN=34-120-55-10.nip.io          # your nip.io host
export ANON_KEY='<prod anon key>'                    # same ANON_KEY as VM docker/.env
# OPTIONAL — restrict who can sign in (exact emails, comma-separated). Omit to
# allow anyone with a valid Google login. Runtime env on Cloud Run, NOT a secret
# and NOT in docker/.env (the app runs on Cloud Run).
export ALLOWED_EMAILS='you@example.com,teammate@example.com'
# OPTIONAL — enable Strava import. Export BOTH to turn it on. CLIENT_ID is a
# plain env var; CLIENT_SECRET is stored in Secret Manager by the script.
export STRAVA_CLIENT_ID='<strava client id>'
export STRAVA_CLIENT_SECRET='<strava client secret>'
./deploy/gcp/04_deploy_app_cloudrun.sh
```

> If you enable Strava, the script prints the Cloud Run host — set that as the
> **Authorization Callback Domain** in your Strava API app (domain only, no
> scheme/path). The callback route is `<run-url>/api/integrations/strava/callback`.

What it does:
- Ensures an Artifact Registry repo.
- Builds the image (via Cloud Build, or local docker as fallback), passing
  `NEXT_PUBLIC_SUPABASE_URL=https://<domain>` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` as build args.
- `gcloud run deploy sportai-app` with `--allow-unauthenticated`, port 3000, min-instances 0,
  and mounts the Secret Manager secrets. **`SUPABASE_INTERNAL_URL` is intentionally unset**
  (the app is off the Docker network, so server-side calls use the public nip.io URL).

**➡ It prints the app URL:**
```
App deployed: https://sportai-xxxx.a.run.app
```

Set `NEXT_PUBLIC_APP_URL` to that URL (used for proxy-safe redirects):
```bash
gcloud run services update sportai-app --region europe-west1 \
  --update-env-vars NEXT_PUBLIC_APP_URL=https://sportai-xxxx.a.run.app
```

> Reminder: `NEXT_PUBLIC_*` are baked at build time. If you ever change the Supabase URL or
> anon key, you must **rebuild** (re-run this script), not just update env vars.

> **Changing the allow-list later** is a cheap runtime update (no rebuild):
> ```bash
> gcloud run services update sportai-app --region europe-west1 \
>   --update-env-vars '^|^ALLOWED_EMAILS=a@example.com,b@example.com'
> ```
> (The `^|^` custom delimiter lets the value contain commas. To turn the allow-list OFF,
> remove the var: `--remove-env-vars ALLOWED_EMAILS`.)

---

## 8. Point Supabase auth at the app URL

Now that you have the Cloud Run URL, update the VM `docker/.env` so GoTrue accepts redirects
back to the app:
```bash
gcloud compute ssh sportai-supabase --zone europe-west1-b
# on the VM:
cd ~/sportai/docker
# edit .env:  (use your real Cloud Run URL)
#   SITE_URL=https://sportai-xxxx.a.run.app
#   ADDITIONAL_REDIRECT_URLS=https://sportai-xxxx.a.run.app/**
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d auth
exit
```
> `up -d auth` (not `restart`) — restart does NOT reload env changes (AGENTS.md #8).

---

## 9. Enable Google OAuth

1. In **Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client** (Web app),
   add this **Authorized redirect URI** (the Supabase gateway callback, NOT the app URL):
   ```
   https://34-120-55-10.nip.io/auth/v1/callback
   ```
   Use `localhost`-style consistency; no “Authorized JavaScript origins” are needed
   (server-side code flow). See AGENTS.md #12.
2. On the VM `docker/.env` set:
   ```dotenv
   GOOGLE_ENABLED=true
   GOOGLE_CLIENT_ID=<client id>
   GOOGLE_SECRET=<client secret>
   ```
   (The compose file already maps these to `GOTRUE_EXTERNAL_GOOGLE_*` — no uncommenting needed.)
3. Reload auth:
   ```bash
   sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d auth
   ```

---

## 10. Migrate your test data (optional)

Run from your **local machine** with the **local Docker stack up** (`docker compose --env-file
.env up -d` in `docker/`). The VM stack must already be running with migrations applied (step 5).

> **Which script?** Use the **app-data + UUID remap** approach (`05b`/`05c`), NOT the full-dump
> `05_migrate_data.sh`. See AGENTS.md #26: a full `auth`+`storage` dump fails because those tables
> are owned by `supabase_*_admin` (not `postgres`) and the two stacks mint DIFFERENT user UUIDs
> for the same person, so `auth.users` won't load and every user-scoped FK cascades to failure.
> `05_migrate_data.sh` is kept only for the rare same-owner/same-UUID case; for the normal
> "same Google account, fresh prod stack" case, use 05b + 05c.

### 10a. Get both user UUIDs
Same email, different `auth.users.id` on each stack. Fetch both:
```bash
# local
docker exec sportai-db psql -U postgres -d postgres -At -c "select id,email from auth.users;"
# prod (via the VM)
gcloud compute ssh sportai-supabase --zone europe-west1-b --command \
  "cd ~/sportai/docker && set -a; . ./.env; set +a; sudo docker exec -e PGPASSWORD=\"\$POSTGRES_PASSWORD\" sportai-db psql -U postgres -d postgres -At -c 'select id,email from auth.users;'"
```
Set them as `LOCAL_UID` / `PROD_UID` (the scripts default to the values from the first migration —
override via env if yours differ).

### 10b. Migrate app DATA (remapped)  →  `05b_migrate_appdata_remap.sh`
```bash
LOCAL_UID=<local-uuid> PROD_UID=<prod-uuid> ./deploy/gcp/05b_migrate_appdata_remap.sh
```
Dumps only the `public` app tables + `storage.objects` (`--data-only --no-owner
--column-inserts`), rewrites the local UUID → prod UUID throughout (user_id, profiles.id,
storage.objects.owner + path), restores as `postgres`. Prints row counts at the end — confirm
they match local (activities/coaching_messages/etc.).

### 10c. Migrate storage FILES  →  `05c_migrate_storage_files.sh`
```bash
LOCAL_UID=<local-uuid> PROD_UID=<prod-uuid> ./deploy/gcp/05c_migrate_storage_files.sh
```
Tars the `docker_storage-data` volume, copies it to the VM, unpacks it, and **renames the on-disk
user-UID folder local→prod** (AGENTS.md #25 — storage RLS checks the path's user-folder, so files
are invisible without this). Split from 05b because Docker Desktop on macOS doesn't reliably share
`/var/folders` temp dirs (AGENTS.md #24) — 05c uses a `$HOME` temp dir.

> **Encryption key**: `user_settings.ai_api_key_enc` only decrypts on prod if the VM's
> `SUPABASE_ENCRYPTION_KEY` matches dev (gotcha #6). Otherwise re-enter the AI key in Settings.

---

## 11. Smoke test

Open `https://sportai-xxxx.a.run.app` and verify:
- [ ] Login with Google works (redirects through nip.io and back to the app).
- [ ] Dashboard loads your migrated activities.
- [ ] Coach chat responds (needs `OPENAI_API_KEY` secret) and recalls past context (RAG).
- [ ] An activity upload succeeds and appears.
- [ ] Voice note transcribes (needs mic + HTTPS — both satisfied).

---

## Environment variables — where each one lives

| Variable | Lives in | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Cloud Run (build arg) | `https://<domain>` — browser → Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cloud Run (build arg) | anon key for the browser |
| `NEXT_PUBLIC_APP_URL` | Cloud Run (env) | app's own URL for redirects |
| `ALLOWED_EMAILS` | Cloud Run (env) | login allow-list (exact emails, comma-sep). Unset = allow anyone with Google login |
| `STRAVA_CLIENT_ID` | Cloud Run (env) | Strava import (not sensitive). Set with CLIENT_SECRET to enable |
| `STRAVA_CLIENT_SECRET` | **Secret Manager** → Cloud Run | Strava import secret. Omit both to disable Strava |
| `OPENAI_API_KEY` | **Secret Manager** → Cloud Run | AI coach |
| `SUPABASE_SERVICE_ROLE_KEY` | **Secret Manager** → Cloud Run | server-side admin (RLS-bypass) |
| `SUPABASE_INTERNAL_URL` | **unset** on Cloud Run | forces public-URL fallback |
| `SUPABASE_DOMAIN` | VM `docker/.env` | nip.io host for Caddy |
| `API_EXTERNAL_URL` / `SUPABASE_PUBLIC_URL` | VM `docker/.env` | `https://<domain>` |
| `SITE_URL` / `ADDITIONAL_REDIRECT_URLS` | VM `docker/.env` | Cloud Run app URL (+ `/**`) |
| `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` | VM `docker/.env` | Supabase core |
| `SUPABASE_ENCRYPTION_KEY` | VM `docker/.env` → DB `app.encryption_key` | encrypts stored AI keys |
| `GOOGLE_ENABLED` / `GOOGLE_CLIENT_ID` / `GOOGLE_SECRET` | VM `docker/.env` | OAuth |

> `ANON_KEY` / `SERVICE_ROLE_KEY` must be **identical** in the VM `docker/.env` and (for the
> service-role key) in Secret Manager. They're signed by `JWT_SECRET` — regenerate together.

---

## Common issues

| Symptom | Cause / fix |
|---|---|
| `curl https://<domain>/auth/v1/health` fails | Caddy still fetching cert (~30s) or DNS/IP mismatch. Check `docker logs sportai-caddy`. |
| Login bounces to `localhost:3000` | `SITE_URL`/`ADDITIONAL_REDIRECT_URLS` not set to the Cloud Run URL, or `up -d auth` not run. |
| Google returns `redirect_uri_mismatch` | Redirect URI must be `https://<domain>/auth/v1/callback`, not the app URL (AGENTS.md #12). |
| App shows “AI is not configured” | `OPENAI_API_KEY` secret missing/empty, or `SUPABASE_SERVICE_ROLE_KEY` wrong. |
| Browser bundle calls `undefined` Supabase URL | `NEXT_PUBLIC_*` weren't passed as build args — rebuild via step 7. |
| Changed `.env` but nothing changed | Use `up -d <svc>`, not `restart` (AGENTS.md #8). |
| PKCE `code_verifier_not_found` at login | Browser and server must share `storageKey`; they do here because both use the same nip.io URL. Clear old `sb-*` cookies. |

---

## Teardown (stop paying)

```bash
gcloud run services delete sportai-app --region europe-west1
gcloud compute instances delete sportai-supabase --zone europe-west1-b
gcloud compute addresses delete sportai-supabase-ip --region europe-west1
# optional: delete firewall rules + Artifact Registry repo + secrets
```
