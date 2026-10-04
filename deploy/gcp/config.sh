#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Shared config for the SportAI GCP deploy scripts. Sourced by every script.
# Nothing here is secret (secrets live in Secret Manager and in docker/.env on
# the VM, never committed). This file is COMMITTED and must NOT contain any one
# deployer's project id — each deployer sets GCP_PROJECT in their own gitignored
# deploy/gcp/.deploy.env (or exports it), so anyone can stand up their OWN
# instance without inheriting someone else's project.
# ─────────────────────────────────────────────────────────────────────────────

# Load the per-deployer env file FIRST so GCP_PROJECT (and friends) are available
# here. Shell exports still win (only unset keys are taken from the file).
_CFG_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
_DEPLOY_ENV="${DEPLOY_ENV:-$_CFG_DIR/.deploy.env}"
if [[ -f "$_DEPLOY_ENV" ]]; then
  set -a
  while IFS='=' read -r _k _v; do
    [[ "$_k" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$_k" ]] && continue
    _k="${_k// /}"
    _v="${_v%\"}"; _v="${_v#\"}"; _v="${_v%\'}"; _v="${_v#\'}"
    if [[ -z "${!_k:-}" ]]; then printf -v "$_k" '%s' "$_v"; export "$_k"; fi
  done < "$_DEPLOY_ENV"
  set +a
fi

# --- GCP project / location ---
# REQUIRED, no default — a wrong default silently deploys to the wrong project.
# Set GCP_PROJECT in deploy/gcp/.deploy.env (see .deploy.env.example) or export it.
if [[ -z "${GCP_PROJECT:-}" ]]; then
  echo "ERROR: GCP_PROJECT is not set." >&2
  echo "  Set it in deploy/gcp/.deploy.env (copy from .deploy.env.example) or:" >&2
  echo "    export GCP_PROJECT=your-gcp-project-id" >&2
  return 1 2>/dev/null || exit 1
fi
export GCP_PROJECT
export GCP_REGION="${GCP_REGION:-europe-west1}"
export GCP_ZONE="${GCP_ZONE:-europe-west1-b}"

# --- Compute Engine VM (Supabase stack) ---
export VM_NAME="${VM_NAME:-sportai-supabase}"
export VM_MACHINE_TYPE="${VM_MACHINE_TYPE:-e2-medium}"  # cheapest sensible for ~9 containers
export VM_DISK_SIZE="${VM_DISK_SIZE:-30GB}"
export VM_IMAGE_FAMILY="${VM_IMAGE_FAMILY:-ubuntu-2204-lts}"
export VM_IMAGE_PROJECT="${VM_IMAGE_PROJECT:-ubuntu-os-cloud}"
export STATIC_IP_NAME="${STATIC_IP_NAME:-sportai-supabase-ip}"

# --- SSH source range for the firewall (lock this to YOUR ip/32) ---
# Find yours with: curl -s ifconfig.me
#export SSH_SOURCE_RANGE="${SSH_SOURCE_RANGE:-0.0.0.0/0}"  # CHANGE to <your-ip>/32
export SSH_SOURCE_RANGE="90.50.35.185/32"  # CHANGE to <your-ip>/32

# --- Artifact Registry + Cloud Run (Next.js app) ---
export AR_REPO="${AR_REPO:-sportai}"
export APP_SERVICE="${APP_SERVICE:-sportai-app}"
export APP_IMAGE="${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${AR_REPO}/${APP_SERVICE}"

# --- Repo paths ---
export REPO_ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"

echo "[config] project=$GCP_PROJECT region=$GCP_REGION vm=$VM_NAME ($VM_MACHINE_TYPE)"
