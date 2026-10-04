#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 01 — Provision GCP infra for the Supabase VM.
#   • enables required APIs
#   • reserves a static external IP
#   • creates the Compute Engine VM (e2-medium, europe-west1)
#   • firewall: allow 80/443 from anywhere, 22 from SSH_SOURCE_RANGE only
#
# Idempotent-ish: skips resources that already exist. Run once.
#   ./deploy/gcp/01_provision_vm.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

echo "[01] Setting active project → $GCP_PROJECT"
gcloud config set project "$GCP_PROJECT"

echo "[01] Enabling APIs (compute, artifactregistry, run, secretmanager, iam)…"
gcloud services enable \
  compute.googleapis.com \
  artifactregistry.googleapis.com \
  run.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  cloudbuild.googleapis.com

echo "[01] Reserving static IP '$STATIC_IP_NAME' in $GCP_REGION (if absent)…"
if ! gcloud compute addresses describe "$STATIC_IP_NAME" --region "$GCP_REGION" >/dev/null 2>&1; then
  gcloud compute addresses create "$STATIC_IP_NAME" --region "$GCP_REGION"
fi
STATIC_IP=$(gcloud compute addresses describe "$STATIC_IP_NAME" --region "$GCP_REGION" --format='value(address)')
DASHED_IP="${STATIC_IP//./-}"
echo "[01] Static IP = $STATIC_IP"
echo "[01] nip.io host = ${DASHED_IP}.nip.io   ← this is your SUPABASE_DOMAIN"

echo "[01] Firewall: allow HTTP/HTTPS (80,443) from anywhere…"
gcloud compute firewall-rules describe sportai-allow-web >/dev/null 2>&1 || \
gcloud compute firewall-rules create sportai-allow-web \
  --direction=INGRESS --action=ALLOW --rules=tcp:80,tcp:443 \
  --source-ranges=0.0.0.0/0 --target-tags=sportai-supabase

echo "[01] Firewall: allow SSH (22) from $SSH_SOURCE_RANGE only…"
if [ "$SSH_SOURCE_RANGE" = "0.0.0.0/0" ]; then
  echo "  ⚠  SSH_SOURCE_RANGE is open to the world. Set it to <your-ip>/32 in config.sh."
fi
gcloud compute firewall-rules describe sportai-allow-ssh >/dev/null 2>&1 || \
gcloud compute firewall-rules create sportai-allow-ssh \
  --direction=INGRESS --action=ALLOW --rules=tcp:22 \
  --source-ranges="$SSH_SOURCE_RANGE" --target-tags=sportai-supabase

echo "[01] Creating VM '$VM_NAME' ($VM_MACHINE_TYPE)…"
if ! gcloud compute instances describe "$VM_NAME" --zone "$GCP_ZONE" >/dev/null 2>&1; then
  gcloud compute instances create "$VM_NAME" \
    --zone="$GCP_ZONE" \
    --machine-type="$VM_MACHINE_TYPE" \
    --image-family="$VM_IMAGE_FAMILY" \
    --image-project="$VM_IMAGE_PROJECT" \
    --boot-disk-size="$VM_DISK_SIZE" \
    --address="$STATIC_IP" \
    --tags=sportai-supabase
else
  echo "  VM already exists — skipping."
fi

echo
echo "[01] DONE."
echo "     Next: ./deploy/gcp/02_vm_bootstrap.sh   (installs Docker on the VM)"
echo "     Remember your SUPABASE_DOMAIN = ${DASHED_IP}.nip.io"
