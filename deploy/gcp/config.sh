#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Shared config for the SportAI GCP deploy scripts. Edit values, then source it:
#   source deploy/gcp/config.sh
# All scripts source this. Nothing here is secret (secrets live in Secret Manager
# and in docker/.env on the VM, never committed).
# ─────────────────────────────────────────────────────────────────────────────

# --- GCP project / location ---
export GCP_PROJECT="${GCP_PROJECT:-sportai-prod}" 
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
