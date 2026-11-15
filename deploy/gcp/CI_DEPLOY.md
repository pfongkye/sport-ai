# SportAI — Automated CI/CD deploy to Cloud Run (GitHub Actions)

This replaces the manual `./deploy/gcp/04_deploy_app_cloudrun.sh` run (step 7 of
`MANUAL_DEPLOY.md`). Once configured, every push to `main` that touches app code
builds the image on Cloud Build and deploys it to Cloud Run automatically. You can
also trigger a deploy by hand from the **Actions** tab.

Workflow file: [`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml).

---

## What CI does (and does NOT do)

CI replicates **only the app deploy** — the same thing script 04 does:

1. Ensures the Artifact Registry docker repo `sportai` exists in `europe-west1`.
2. Builds the image on **Cloud Build** from `deploy/gcp/cloudbuild.yaml`
   (`-f docker/Dockerfile --target runner`, build context `app/`), passing the
   `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` **build args**.
   Those are baked into the browser bundle at build time (AGENTS.md #2), so they
   MUST be build args, not just runtime env. Building on Cloud Build also makes the
   image `amd64/linux` regardless of your laptop's architecture (AGENTS.md #27).
3. Deploys to the Cloud Run service `sportai-app` with the exact same flags as the
   script (`--allow-unauthenticated --port 3000 --cpu 1 --memory 512Mi
   --min-instances 0 --max-instances 4`), the runtime env vars, and the Secret
   Manager mounts (`--set-secrets`). `SUPABASE_INTERNAL_URL` is intentionally unset.

**CI never touches** the Compute Engine VM, the Supabase stack, migrations, data, or
Secret Manager values. All of that is a one-time manual setup.

### Assumption: the first manual deploy already happened

CI **assumes** the following already exist from your first-time manual deploy
(`MANUAL_DEPLOY.md` steps 1–6):

- The VM + Supabase stack is up (Caddy TLS on your `nip.io` host).
- The GCP Secret Manager secrets `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY`
  (and optionally `STRAVA_CLIENT_SECRET`) exist **and have values**, and the Cloud
  Run runtime service account can read them.

CI only **references** those secrets with `--set-secrets` — it does not create or
populate them. If they are missing, the Cloud Run revision will fail to start. To
(re)create a secret value, use the manual command from `MANUAL_DEPLOY.md` step 6:

```bash
printf '%s' 'sk-...' | gcloud secrets create OPENAI_API_KEY --data-file=- --replication-policy=automatic
# or add a new version to an existing secret:
printf '%s' 'sk-...' | gcloud secrets versions add OPENAI_API_KEY --data-file=-
```

---

## Image tagging & rollback

Each CI build tags the image with its commit SHA:

- `…/sportai/sportai-app:<commit-sha>` — the exact build for that commit.

The deploy always points Cloud Run at the **`:<commit-sha>`** tag, so every revision
is traceable to a commit. To **roll back**, redeploy a previous SHA's image:

```bash
gcloud run deploy sportai-app \
  --project <GCP_PROJECT> --region europe-west1 \
  --image europe-west1-docker.pkg.dev/<GCP_PROJECT>/sportai/sportai-app:<old-sha>
```

(Or, from the Cloud Console → Cloud Run → `sportai-app` → Revisions → manage traffic,
roll 100% back to a previous healthy revision.)

---

## One-time GCP setup for CI (Workload Identity Federation)

CI authenticates to GCP **keylessly** with Workload Identity Federation (WIF) — no
long-lived JSON service-account key is ever stored in GitHub. GitHub mints a short-
lived OIDC token, GCP trusts it (scoped to this repo only), and hands back temporary
credentials for a dedicated deploy service account.

Run these once, locally, authenticated as a project owner (`gcloud auth login`).

### 0. Variables used below

```bash
export GCP_PROJECT="your-gcp-project-id"          # same project as the manual deploy
export GCP_REGION="europe-west1"
export GITHUB_REPO="pfongkye/sport-ai"            # owner/repo — locks federation to this repo
export POOL_ID="github-actions"
export PROVIDER_ID="github"
export DEPLOY_SA="sportai-deployer"               # service-account short name

PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
RUNTIME_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"   # Cloud Run runtime SA
```

### 1. Enable the required APIs

```bash
gcloud services enable \
  iamcredentials.googleapis.com \
  sts.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project "$GCP_PROJECT"
```

### 2. Create the Workload Identity Pool + provider (locked to your repo)

```bash
# Pool
gcloud iam workload-identity-pools create "$POOL_ID" \
  --project "$GCP_PROJECT" --location="global" \
  --display-name="GitHub Actions"

# OIDC provider for GitHub, with an attribute CONDITION that restricts federation
# to THIS repository only. Without the condition, ANY GitHub repo could impersonate
# the deploy SA — the condition is the security boundary, do not omit it.
gcloud iam workload-identity-pools providers create-oidc "$PROVIDER_ID" \
  --project "$GCP_PROJECT" --location="global" \
  --workload-identity-pool="$POOL_ID" \
  --display-name="GitHub" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.repository_owner=assertion.repository_owner" \
  --attribute-condition="assertion.repository=='${GITHUB_REPO}'"
```

### 3. Create the deploy service account

```bash
gcloud iam service-accounts create "$DEPLOY_SA" \
  --project "$GCP_PROJECT" \
  --display-name="SportAI GitHub Actions deployer"

export DEPLOY_SA_EMAIL="${DEPLOY_SA}@${GCP_PROJECT}.iam.gserviceaccount.com"
```

### 4. Let the GitHub repo impersonate the deploy SA

```bash
POOL_NAME="$(gcloud iam workload-identity-pools describe "$POOL_ID" \
  --project "$GCP_PROJECT" --location=global --format='value(name)')"

# Bind ONLY tokens whose repository attribute equals your repo.
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_SA_EMAIL" \
  --project "$GCP_PROJECT" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/${POOL_NAME}/attribute.repository/${GITHUB_REPO}"
```

### 5. Grant the deploy SA the roles it needs

These mirror what script 04 does (build via Cloud Build, push to Artifact Registry,
deploy to Cloud Run, act as the runtime SA, manage the mounted secrets' IAM).

```bash
for ROLE in \
  roles/run.admin \
  roles/cloudbuild.builds.editor \
  roles/artifactregistry.writer \
  roles/storage.admin \
  roles/secretmanager.admin \
  roles/serviceusage.serviceUsageConsumer ; do
  gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
    --member="serviceAccount:${DEPLOY_SA_EMAIL}" \
    --role="$ROLE"
done

# Deploy must be able to "act as" the Cloud Run RUNTIME SA to deploy a revision.
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --project "$GCP_PROJECT" \
  --role="roles/iam.serviceAccountUser" \
  --member="serviceAccount:${DEPLOY_SA_EMAIL}"
```

Why each role:

| Role | Why |
|---|---|
| `roles/run.admin` | create/update the `sportai-app` Cloud Run service & revisions |
| `roles/cloudbuild.builds.editor` | submit builds with `gcloud builds submit` |
| `roles/artifactregistry.writer` | create the repo (if missing) + push images / add tags |
| `roles/storage.admin` | Cloud Build stages the source tarball in a GCS bucket (narrow to `roles/storage.objectAdmin` on that bucket if you prefer least-privilege) |
| `roles/secretmanager.admin` | grant the runtime SA `secretAccessor` on mounted secrets (as script 04's `ensure_secret` does). Drop to `roles/secretmanager.viewer` if you grant those bindings by hand and never want CI to manage them |
| `roles/serviceusage.serviceUsageConsumer` | lets the SA call the enabled APIs in the project |
| `roles/iam.serviceAccountUser` (on the runtime SA) | deploy a revision that RUNS as the runtime SA |

> The **Cloud Build service account** (`${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com`)
> runs the docker build and pushes to Artifact Registry. In most projects it already
> has the roles it needs (`roles/cloudbuild.builds.builder`). If a build fails with a
> push/permission error, grant it `roles/artifactregistry.writer`:
> ```bash
> gcloud projects add-iam-policy-binding "$GCP_PROJECT" \
>   --member="serviceAccount:${PROJECT_NUMBER}@cloudbuild.gserviceaccount.com" \
>   --role="roles/artifactregistry.writer"
> ```

### 6. Get the two values that go into GitHub

```bash
# GCP_WIF_PROVIDER — the full provider resource name:
gcloud iam workload-identity-pools providers describe "$PROVIDER_ID" \
  --project "$GCP_PROJECT" --location=global \
  --workload-identity-pool="$POOL_ID" \
  --format='value(name)'
# → projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github-actions/providers/github

# GCP_DEPLOY_SA — the deploy service-account email:
echo "$DEPLOY_SA_EMAIL"
# → sportai-deployer@<GCP_PROJECT>.iam.gserviceaccount.com
```

---

## Where to enter the secrets & variables in GitHub

On github.com, open the repo **`pfongkye/sport-ai`** →
**Settings** → **Secrets and variables** → **Actions**. There are two tabs:

- **Secrets** tab → "New repository secret" (values are hidden/encrypted).
- **Variables** tab → "New repository variable" (values are plain, visible).

### Secrets (Secrets tab)

| Secret name | Example / value | Description |
|---|---|---|
| `GCP_WIF_PROVIDER` | `projects/123456789/locations/global/workloadIdentityPools/github-actions/providers/github` | WIF provider resource name from setup step 6. Stored as a secret to keep the project number out of logs. |
| `GCP_DEPLOY_SA` | `sportai-deployer@your-project.iam.gserviceaccount.com` | Deploy service-account email the workflow impersonates. |

> **Do NOT put app runtime secrets in GitHub.** `OPENAI_API_KEY`,
> `SUPABASE_SERVICE_ROLE_KEY`, and `STRAVA_CLIENT_SECRET` live **only in GCP Secret
> Manager** and are mounted into Cloud Run at deploy time via `--set-secrets`.
> Duplicating them in GitHub would be redundant and a bigger leak surface.

### Variables (Variables tab)

| Variable name | Required? | Example | Description |
|---|---|---|---|
| `GCP_PROJECT` | **required** | `sportai-prod` | Your GCP project id (same as the manual deploy). |
| `GCP_REGION` | optional | `europe-west1` | Region. Defaults to `europe-west1` if unset. |
| `SUPABASE_DOMAIN` | **required** | `34-120-55-10.nip.io` | VM's nip.io Supabase host (no scheme). Becomes `NEXT_PUBLIC_SUPABASE_URL=https://<domain>` (build arg). |
| `ANON_KEY` | **required** | `eyJhbGciOi...` | Prod Supabase **anon** key. Public by design (baked into the browser bundle); matches the VM `docker/.env`. A variable, not a secret. |
| `NEXT_PUBLIC_APP_URL` | **required** | `https://sportai-app-xxxx.europe-west1.run.app` | The Cloud Run app URL (auth redirects + Strava callback). Get it after the first deploy. |
| `ALLOWED_EMAILS` | optional | `you@example.com,teammate@example.com` | Login allow-list (exact emails, comma-separated). **Leave unset to allow anyone with a Google login. If you set it, include your OWN email or you'll lock yourself out.** |
| `STRAVA_CLIENT_ID` | optional | `123456` | Strava import client id (not sensitive). Only set it if you want Strava enabled — and make sure `STRAVA_CLIENT_SECRET` exists in Secret Manager. |

> `ANON_KEY` and `GCP_WIF_PROVIDER` classification is deliberate:
> - `ANON_KEY` is a **variable** — the anon key is public by design (it ships in the
>   browser bundle), so there's no value in hiding it, and keeping it a variable makes
>   it easy to see/update.
> - `GCP_WIF_PROVIDER` is a **secret** — not sensitive in the cryptographic sense, but
>   it embeds the project number; keeping it out of logs/config is tidier.

The workflow runs a **preflight step** that fails with a clear error naming any missing
required secret/variable before it calls gcloud.

---

## Triggers & running a deploy

The workflow runs when:

- **Push to `main`** that changes any of: `app/**`, `docker/Dockerfile`,
  `deploy/gcp/cloudbuild.yaml`, or `.github/workflows/deploy.yml`. Pushes that only
  touch unrelated files (docs, the VM scripts, etc.) do **not** trigger a deploy.
- **Manual dispatch** — this ignores the paths filter and always runs.

### Run a manual deploy

1. GitHub → repo → **Actions** tab.
2. Select **"Deploy app to Cloud Run"** in the left sidebar.
3. Click **"Run workflow"**, choose the `main` branch, and confirm.

This is the CI equivalent of running `./deploy/gcp/04_deploy_app_cloudrun.sh` locally.

### Roll back

See [Image tagging & rollback](#image-tagging--rollback) above — redeploy a previous
`:<commit-sha>` image, or shift traffic to a previous revision in the Cloud Console.

---

## Parity with the manual script

Everything the workflow passes to gcloud is kept identical to
`deploy/gcp/04_deploy_app_cloudrun.sh` and `deploy/gcp/cloudbuild.yaml`:

| Item | Value |
|---|---|
| Service | `sportai-app` |
| Region | `europe-west1` (overridable via `GCP_REGION`) |
| Artifact Registry repo | `sportai` |
| Image | `europe-west1-docker.pkg.dev/<project>/sportai/sportai-app` (tag `:<sha>`) |
| Build | Cloud Build, `-f docker/Dockerfile --target runner`, context `app/`, `NEXT_PUBLIC_*` as build args |
| Deploy flags | `--allow-unauthenticated --port 3000 --cpu 1 --memory 512Mi --min-instances 0 --max-instances 4` |
| Runtime env | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_APP_URL`, (+`ALLOWED_EMAILS`, +`STRAVA_CLIENT_ID` when set) via `^|^` delimiter |
| Secrets | `OPENAI_API_KEY:latest`, `SUPABASE_SERVICE_ROLE_KEY:latest` (+`STRAVA_CLIENT_SECRET:latest` when Strava enabled) |
| `SUPABASE_INTERNAL_URL` | intentionally unset |

The one intentional CI improvement: the script uses only `:latest`; CI tags and deploys
`:<commit-sha>`, for traceability and easy rollback.

> CI does not move `:latest`: re-pointing an existing tag needs `artifactregistry.tags.delete`
> (repoAdmin), which the least-privilege `artifactregistry.writer` role lacks. Nothing deploys `:latest` from CI.
