#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 05 — Migrate test data from the LOCAL Docker stack to the VM.
#   Part A: Postgres data (auth + storage + public schemas, incl. pgvector)
#   Part B: Storage files (the storage-data volume: activities/nutrition/audio)
#
#   ./deploy/gcp/05_migrate_data.sh
#
# Run this from your LOCAL machine with the local Docker stack UP. The VM stack
# must already be up with migrations applied (script 03) — we load DATA only,
# schema is created by the migrations.
#
# Encryption key: migrated user_settings.ai_api_key_enc only decrypts if the VM's
# app.encryption_key matches the dev one (set SUPABASE_ENCRYPTION_KEY the same in
# the VM .env before running 03). Otherwise users re-enter their AI keys.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-sportai-db}"
# Compose prefixes volumes with the project dir name → "docker_storage-data".
LOCAL_STORAGE_VOLUME="${LOCAL_STORAGE_VOLUME:-docker_storage-data}"
WORK="$(mktemp -d)"
DUMP="$WORK/sportai_data.sql"
STORAGE_TAR="$WORK/storage-data.tar"
trap 'rm -rf "$WORK"' EXIT

echo "[05] Reading local DB password from docker/.env…"
LOCAL_PGPW=$(grep '^POSTGRES_PASSWORD=' "$REPO_ROOT/docker/.env" | cut -d= -f2-)

# ── Part A: Postgres data-only dump ──────────────────────────────────────────
# --data-only + --disable-triggers so FKs (e.g. into auth.users) don't block on
# load order. auth.users MUST come across or public.* user_id FKs + RLS break.
# pgvector embeddings are ordinary column data — they dump/restore as text and
# load fine because the VM already ran 001_extensions.sql (creates `vector`).
echo "[05A] Dumping local data (schemas: auth, storage, public)…"
docker exec -e PGPASSWORD="$LOCAL_PGPW" "$LOCAL_DB_CONTAINER" \
  pg_dump -U postgres -d postgres \
  --data-only --disable-triggers \
  --schema=auth --schema=storage --schema=public \
  > "$DUMP"
echo "     dump size: $(du -h "$DUMP" | cut -f1)"

echo "[05A] Copying dump to VM…"
gcloud compute scp "$DUMP" "$VM_NAME:/tmp/sportai_data.sql" --zone "$GCP_ZONE"

echo "[05A] Restoring on VM…"
gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command "bash -s" <<'REMOTE'
set -euo pipefail
cd ~/sportai/docker
set -a; . ./.env; set +a
echo '[vm] Restoring data into Postgres (ON_ERROR_STOP=0 tolerates dup seed rows)…'
sudo docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -i sportai-db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=0 < /tmp/sportai_data.sql
rm -f /tmp/sportai_data.sql
echo '[vm] Postgres data restore complete.'
REMOTE

# ── Part B: Storage files (file backend → storage-data volume) ───────────────
# Storage uses STORAGE_BACKEND=file, so bucket objects live on the storage-data
# volume as files. The storage.objects METADATA rows already came across in Part
# A, so bytes + metadata stay consistent once we copy the files.
echo "[05B] Archiving local storage volume '$LOCAL_STORAGE_VOLUME'…"
if ! docker volume inspect "$LOCAL_STORAGE_VOLUME" >/dev/null 2>&1; then
  echo "     ⚠  volume '$LOCAL_STORAGE_VOLUME' not found — skipping storage files."
  echo "        (set LOCAL_STORAGE_VOLUME=... if your project prefix differs.)"
else
  # Tar the volume contents via a throwaway container (no need for a running stack).
  docker run --rm \
    -v "$LOCAL_STORAGE_VOLUME":/data:ro \
    -v "$WORK":/backup \
    alpine tar cf /backup/storage-data.tar -C /data .
  echo "     archive size: $(du -h "$STORAGE_TAR" | cut -f1)"

  echo "[05B] Copying archive to VM…"
  gcloud compute scp "$STORAGE_TAR" "$VM_NAME:/tmp/storage-data.tar" --zone "$GCP_ZONE"

  echo "[05B] Unpacking into VM storage volume…"
  gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command "bash -s" <<'REMOTE'
set -euo pipefail
# The VM stack uses the same compose project dir (~/sportai/docker) → same
# volume name. Stop storage briefly so it doesn't race the file copy.
cd ~/sportai/docker
VOL=$(sudo docker volume ls --format '{{.Name}}' | grep -E 'storage-data$' | head -n1)
if [ -z "$VOL" ]; then echo '[vm] ERROR: no storage-data volume on VM'; exit 1; fi
echo "[vm] target volume: $VOL"
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml stop storage || true
sudo docker run --rm \
  -v "$VOL":/data \
  -v /tmp:/backup \
  alpine sh -c 'tar xf /backup/storage-data.tar -C /data && chown -R 1000:1000 /data'
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml start storage
rm -f /tmp/storage-data.tar
echo '[vm] Storage files restored.'
REMOTE
fi

echo
echo "[05] DONE — data + files migrated."
echo "     Verify: log in as your test user on the Cloud Run URL and confirm"
echo "     activities, notes, coach chat history (RAG recall) and uploaded files."
echo "     If AI provider keys don't work, the VM app.encryption_key differs from"
echo "     dev — either re-run 03 with the matching key, or re-enter keys in Settings."
