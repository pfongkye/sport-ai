#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 02 — Bootstrap the VM: install Docker + compose plugin, clone the repo.
# Runs commands ON the VM over SSH (gcloud compute ssh). Idempotent.
#   ./deploy/gcp/02_vm_bootstrap.sh
#
# Set REPO_URL to your GitHub remote (https or git@). Defaults to origin.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

REPO_URL="${REPO_URL:-$(git -C "$REPO_ROOT" remote get-url origin 2>/dev/null || echo '')}"
if [ -z "$REPO_URL" ]; then
  echo "ERROR: set REPO_URL=... (your GitHub repo) — could not read git origin." >&2
  exit 1
fi
echo "[02] Repo: $REPO_URL"

# Everything below runs on the VM.
gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command "bash -s" <<REMOTE
set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo '[vm] Installing Docker…'
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker \$USER
else
  echo '[vm] Docker already installed.'
fi

# compose plugin ships with get.docker.com; verify
sudo docker compose version >/dev/null 2>&1 || { echo '[vm] compose plugin missing'; exit 1; }

if [ ! -d ~/sportai ]; then
  echo '[vm] Cloning repo…'
  git clone "$REPO_URL" ~/sportai
else
  echo '[vm] Repo present — pulling latest…'
  git -C ~/sportai pull --ff-only || true
fi

echo '[vm] Bootstrap done. docker version:'
sudo docker --version
REMOTE

echo
echo "[02] DONE."
echo "     Next:"
echo "       1) Copy your prod env to the VM as ~/sportai/docker/.env"
echo "          (start from docker/.env.prod.example — fill FRESH secrets)."
echo "          e.g.  gcloud compute scp ./docker/.env $VM_NAME:~/sportai/docker/.env --zone $GCP_ZONE"
echo "       2) ./deploy/gcp/03_supabase_up.sh   (starts the stack + migrations)"
