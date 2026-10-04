#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 04 — Build the Next.js app image, push to Artifact Registry, deploy to Cloud Run.
#   ./deploy/gcp/04_deploy_app_cloudrun.sh
#
# NEXT_PUBLIC_* are baked into the browser bundle at BUILD time (AGENTS.md #2),
# so they are passed as --build-arg here, not just runtime env. Changing them
# later requires a rebuild, not just a new revision.
#
# Runtime secrets (service-role key, OpenAI key) come from Secret Manager and are
# mounted into the service — never baked into the image.
#
# Required env (export before running, or edit here):
#   SUPABASE_DOMAIN     e.g. 34-120-55-10.nip.io   (from script 01)
#   ANON_KEY            the prod anon key (matches VM docker/.env)
# Optional env:
#   ALLOWED_EMAILS      comma/space-separated login allow-list (exact emails).
#                       Runtime env on Cloud Run (NOT a build arg, NOT docker/.env
#                       — the app runs on Cloud Run). Leave UNSET to disable the
#                       allow-list (anyone with a valid Google login gets in).
#                       Change later without a rebuild:
#                         gcloud run services update "$APP_SERVICE" --region "$GCP_REGION" \
#                           --update-env-vars ALLOWED_EMAILS="a@x.com,b@y.com"
#   STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET  Strava import (see README). Export
#                       BOTH to enable it. The CLIENT_ID is passed as a plain env
#                       var (not sensitive); the CLIENT_SECRET goes via Secret
#                       Manager (secret STRAVA_CLIENT_SECRET). Omit both to leave
#                       Strava import disabled in prod.
# YouTube key is NOT needed (feature unimplemented) — omitted.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
# config.sh loads deploy/gcp/.deploy.env (GCP_PROJECT, SUPABASE_DOMAIN, ANON_KEY,
# NEXT_PUBLIC_APP_URL, ALLOWED_EMAILS, STRAVA_CLIENT_ID/SECRET, …) and requires
# GCP_PROJECT. Shell exports still override the file. Copy the template first:
#   cp deploy/gcp/.deploy.env.example deploy/gcp/.deploy.env   # then fill it in
source ./config.sh

: "${SUPABASE_DOMAIN:?set SUPABASE_DOMAIN (in deploy/gcp/.deploy.env or export it)}"
: "${ANON_KEY:?set ANON_KEY (in deploy/gcp/.deploy.env or export it)}"
SUPABASE_URL="https://${SUPABASE_DOMAIN}"

echo "[04] Ensuring Artifact Registry repo '$AR_REPO'…"
gcloud artifacts repositories describe "$AR_REPO" --location "$GCP_REGION" >/dev/null 2>&1 || \
gcloud artifacts repositories create "$AR_REPO" \
  --repository-format=docker --location="$GCP_REGION" \
  --description="SportAI images"

echo "[04] Ensuring Secret Manager secrets exist (create empty if missing)…"
# Cloud Run's default runtime service account — must be able to READ each mounted
# secret, or the revision fails with "Permission denied on secret ...".
PROJECT_NUMBER="$(gcloud projects describe "$GCP_PROJECT" --format='value(projectNumber)')"
RUN_SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"

ensure_secret () {
  local name="$1"
  gcloud secrets describe "$name" >/dev/null 2>&1 || {
    echo "   creating secret $name (add a version with a value before deploy)"
    gcloud secrets create "$name" --replication-policy=automatic
  }
  # Idempotently grant the Cloud Run SA read access (new secrets have no grant,
  # which is what breaks the revision — e.g. a freshly created STRAVA_CLIENT_SECRET).
  gcloud secrets add-iam-policy-binding "$name" \
    --member="serviceAccount:${RUN_SA}" \
    --role="roles/secretmanager.secretAccessor" >/dev/null 2>&1 || true
}
ensure_secret OPENAI_API_KEY
ensure_secret SUPABASE_SERVICE_ROLE_KEY
# ensure_secret USDA_API_KEY   # optional; uncomment if you use it

# Strava import is optional. Enable it by exporting BOTH STRAVA_CLIENT_ID and
# STRAVA_CLIENT_SECRET before running. The secret is stored in Secret Manager;
# if the secret already exists we add a new version with the provided value.
STRAVA_ENABLED=0
if [[ -n "${STRAVA_CLIENT_ID:-}" && -n "${STRAVA_CLIENT_SECRET:-}" ]]; then
  STRAVA_ENABLED=1
  ensure_secret STRAVA_CLIENT_SECRET
  printf '%s' "$STRAVA_CLIENT_SECRET" | gcloud secrets versions add STRAVA_CLIENT_SECRET --data-file=- >/dev/null
  echo "   Strava import ENABLED (CLIENT_ID as env, CLIENT_SECRET in Secret Manager)"
elif [[ -n "${STRAVA_CLIENT_ID:-}" || -n "${STRAVA_CLIENT_SECRET:-}" ]]; then
  echo "   WARNING: only one of STRAVA_CLIENT_ID / STRAVA_CLIENT_SECRET set — Strava stays DISABLED (need both)."
fi

echo "[04] Building + pushing image via Cloud Build (amd64/linux for Cloud Run)…"
# Build on Cloud Build so the image is amd64/linux regardless of your laptop's
# architecture (Apple Silicon builds arm64 locally, which Cloud Run rejects).
# Context is the repo root so both app/ and docker/ are available; the config
# uses docker/Dockerfile with build context app/.
gcloud builds submit "$REPO_ROOT" \
  --config "$REPO_ROOT/deploy/gcp/cloudbuild.yaml" \
  --substitutions=_IMAGE="$APP_IMAGE:latest",_NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL",_NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
  || {
    echo "   (Cloud Build failed — falling back to local docker build for linux/amd64)"
    echo "   NOTE: requires Docker buildx (bundled with Docker Desktop)."
    gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" -q
    docker buildx build --platform linux/amd64 \
      -f "$REPO_ROOT/docker/Dockerfile" --target runner \
      --build-arg NEXT_PUBLIC_SUPABASE_URL="$SUPABASE_URL" \
      --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
      -t "$APP_IMAGE:latest" --push "$REPO_ROOT/app"
  }

echo "[04] Deploying to Cloud Run '$APP_SERVICE'…"
# NOTE: SUPABASE_INTERNAL_URL is intentionally NOT set — the app is off the
# Docker network, so server-side calls fall back to the public NEXT_PUBLIC url.
#
# ALLOWED_EMAILS can itself contain commas, which clash with --set-env-vars'
# default comma delimiter. We therefore use gcloud's custom-delimiter syntax
# ("^<DELIM>^KEY=val<DELIM>KEY=val") so commas inside the value are preserved.
# The delimiter is a SINGLE char between carets; we use '|' since it can't appear
# in emails/URLs. ALLOWED_EMAILS is only appended when set (unset = disabled).
ENV_VARS="NEXT_PUBLIC_SUPABASE_URL=${SUPABASE_URL}|NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}"
# NEXT_PUBLIC_APP_URL is the app's own public origin, used for proxy-safe auth
# redirects AND the Strava OAuth redirect URI. --set-env-vars replaces the FULL
# env set, so it must be included here or every redeploy drops it. Defaults to the
# existing Cloud Run URL if not exported.
APP_URL="${NEXT_PUBLIC_APP_URL:-$(gcloud run services describe "$APP_SERVICE" --region "$GCP_REGION" --format='value(status.url)' 2>/dev/null || true)}"
if [[ -n "$APP_URL" ]]; then
  ENV_VARS="${ENV_VARS}|NEXT_PUBLIC_APP_URL=${APP_URL}"
  echo "     NEXT_PUBLIC_APP_URL=${APP_URL}"
else
  echo "     NOTE: NEXT_PUBLIC_APP_URL not set and no existing service URL found; set it after first deploy."
fi
if [[ -n "${ALLOWED_EMAILS:-}" ]]; then
  # Normalise any spaces in the list to nothing so only commas separate emails.
  ALLOWED_EMAILS_CLEAN="${ALLOWED_EMAILS// /}"
  ENV_VARS="${ENV_VARS}|ALLOWED_EMAILS=${ALLOWED_EMAILS_CLEAN}"
  echo "     allow-list ENABLED (ALLOWED_EMAILS set)"
else
  echo "     allow-list DISABLED (ALLOWED_EMAILS unset — anyone with Google login can sign in)"
fi
if [[ "$STRAVA_ENABLED" == "1" ]]; then
  ENV_VARS="${ENV_VARS}|STRAVA_CLIENT_ID=${STRAVA_CLIENT_ID}"
fi

# Secrets mounted into the service. The Strava client secret is appended only
# when Strava is enabled.
RUN_SECRETS="OPENAI_API_KEY=OPENAI_API_KEY:latest,SUPABASE_SERVICE_ROLE_KEY=SUPABASE_SERVICE_ROLE_KEY:latest"
if [[ "$STRAVA_ENABLED" == "1" ]]; then
  RUN_SECRETS="${RUN_SECRETS},STRAVA_CLIENT_SECRET=STRAVA_CLIENT_SECRET:latest"
fi

gcloud run deploy "$APP_SERVICE" \
  --image "$APP_IMAGE:latest" \
  --region "$GCP_REGION" \
  --platform managed \
  --allow-unauthenticated \
  --port 3000 \
  --cpu 1 --memory 512Mi \
  --min-instances 0 --max-instances 4 \
  --set-env-vars "^|^${ENV_VARS}" \
  --set-secrets "$RUN_SECRETS"

RUN_URL=$(gcloud run services describe "$APP_SERVICE" --region "$GCP_REGION" --format='value(status.url)')
echo
echo "[04] App deployed: $RUN_URL"
echo "     NEXT_PUBLIC_APP_URL should equal this. Re-run with it set if needed:"
echo "       gcloud run services update $APP_SERVICE --region $GCP_REGION --update-env-vars NEXT_PUBLIC_APP_URL=$RUN_URL"
echo
echo "[04] IMPORTANT follow-ups on the VM's docker/.env, then 'up -d auth':"
echo "     • SITE_URL=$RUN_URL"
echo "     • ADDITIONAL_REDIRECT_URLS=$RUN_URL/**"
echo "     Google OAuth redirect URI to whitelist: ${SUPABASE_URL}/auth/v1/callback"
if [[ "$STRAVA_ENABLED" == "1" ]]; then
  echo
  echo "[04] Strava: set the API app's 'Authorization Callback Domain' to the Cloud Run host"
  echo "     (domain only, no scheme/path): ${RUN_URL#https://}"
  echo "     (the callback route is ${RUN_URL}/api/integrations/strava/callback)"
fi
