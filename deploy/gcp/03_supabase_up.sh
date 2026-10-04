#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 03 — Start the hardened Supabase stack on the VM, run migrations, set the
#      database encryption key. Runs ON the VM over SSH.
#   ./deploy/gcp/03_supabase_up.sh
#
# Prerequisite: ~/sportai/docker/.env exists on the VM with prod secrets
# (see 02 output). This script reads the encryption key from that .env
# (SUPABASE_ENCRYPTION_KEY) and applies it as the DB-level app.encryption_key.
#
# ── Encryption key note ──
# app.encryption_key is the symmetric key used by encrypt_api_key/decrypt_api_key
# (pgcrypto) to protect users' BYO AI provider keys at rest (user_settings
# .ai_api_key_enc). To decrypt MIGRATED test data it MUST equal the dev value.
# For a clean prod with no migrated secrets, use a fresh key (users re-enter AI
# keys). This script just applies whatever SUPABASE_ENCRYPTION_KEY is in .env.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command "bash -s" <<'REMOTE'
set -euo pipefail
cd ~/sportai/docker

if [ ! -f .env ]; then
  echo 'ERROR: ~/sportai/docker/.env missing. Copy it up first (see step 02).' >&2
  exit 1
fi

echo '[vm] Starting hardened prod stack (Studio/meta excluded, no public DB port)…'
sudo docker compose --env-file .env \
  -f docker-compose.yml -f docker-compose.prod.yml up -d

echo '[vm] Waiting for Postgres to be healthy…'
for i in $(seq 1 30); do
  if sudo docker exec sportai-db pg_isready -U postgres -h localhost >/dev/null 2>&1; then
    echo '[vm] Postgres ready.'; break
  fi
  sleep 3
done

echo '[vm] Applying migrations 001–010…'
for f in ~/sportai/supabase/migrations/*.sql; do
  echo "   → $(basename "$f")"
  sudo docker exec -i sportai-db psql -U postgres -d postgres < "$f"
done

echo '[vm] Setting app.encryption_key (from SUPABASE_ENCRYPTION_KEY in .env)…'
ENC_KEY=$(grep '^SUPABASE_ENCRYPTION_KEY=' .env | cut -d= -f2-)
if [ -z "$ENC_KEY" ] || [ "$ENC_KEY" = "CHANGE_ME_app_encryption_key" ]; then
  echo '   ⚠  SUPABASE_ENCRYPTION_KEY not set in .env — skipping. Encrypted AI keys will not decrypt.'
else
  # must use supabase_admin over TCP (postgres user cannot set DB params)
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
  sudo docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -i sportai-db \
    psql -h 127.0.0.1 -U supabase_admin -d postgres \
    -c "ALTER DATABASE postgres SET app.encryption_key TO '$ENC_KEY';"
  echo '   ✓ encryption key set.'
fi

echo '[vm] Stack status:'
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml ps
REMOTE

echo
echo "[03] DONE. Verify TLS came up (Caddy needs ~30s for the first cert):"
echo "     curl -I https://<your-dashed-ip>.nip.io/auth/v1/health"
echo "     Next: ./deploy/gcp/04_deploy_app_cloudrun.sh"
