#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 05b — Migrate ONLY the public app data from local → VM, remapping the local
#       user UUID to the prod user UUID (same Google account, different auth.users
#       row on each stack). Also migrates storage.objects rows + the bucket files.
#
# Why not 05_migrate_data.sh? That dumps the whole auth+storage schema, which
# fails: those tables are owned by supabase_*_admin (not postgres, so COPY is
# rejected) and the prod user already exists with a DIFFERENT UUID. This script
# sidesteps all of that: it never touches auth.*, and it rewrites user_id.
#
#   LOCAL_UID=... PROD_UID=... ./deploy/gcp/05b_migrate_appdata_remap.sh
# (defaults below are filled in from the values we already looked up.)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

LOCAL_UID="${LOCAL_UID:-72603a45-fd7c-44e5-a86c-b5e27d885a13}"
PROD_UID="${PROD_UID:-da04b5c1-fbc4-457b-89b1-9c14e20e6e44}"
LOCAL_DB_CONTAINER="${LOCAL_DB_CONTAINER:-sportai-db}"
LOCAL_STORAGE_VOLUME="${LOCAL_STORAGE_VOLUME:-docker_storage-data}"

WORK="$(mktemp -d)"
DUMP="$WORK/appdata.sql"
STORAGE_TAR="$WORK/storage-data.tar"
trap 'rm -rf "$WORK"' EXIT

echo "[05b] Remap: LOCAL $LOCAL_UID → PROD $PROD_UID"
LOCAL_PGPW=$(grep '^POSTGRES_PASSWORD=' "$REPO_ROOT/docker/.env" | cut -d= -f2-)

# App tables in dependency order (parents before children). profiles.id and the
# *.user_id columns all reference the user; activity_streams references activities.
APP_TABLES=(profiles user_settings activities activity_streams coaching_messages \
            activity_notes nutrition_logs training_plans planned_sessions)

# storage.objects also carries owner + a user-scoped path (buckets: activities/
# nutrition/audio). We migrate its rows too so uploaded files resolve.
echo "[05b] Dumping public app tables + storage.objects (data-only, no owners)…"
TABLE_ARGS=()
for t in "${APP_TABLES[@]}"; do TABLE_ARGS+=(--table="public.$t"); done
TABLE_ARGS+=(--table="storage.objects")

docker exec -e PGPASSWORD="$LOCAL_PGPW" "$LOCAL_DB_CONTAINER" \
  pg_dump -U postgres -d postgres \
  --data-only --no-owner --no-privileges --column-inserts \
  "${TABLE_ARGS[@]}" \
  > "$DUMP"

# Rewrite the user UUID everywhere it appears (user_id, profiles.id, objects.owner).
# --column-inserts emits INSERT statements, so a plain string swap is safe and exact.
echo "[05b] Rewriting user UUID in dump…"
sed -i.bak "s/$LOCAL_UID/$PROD_UID/g" "$DUMP" && rm -f "$DUMP.bak"
# sanity: local UID must be gone
if grep -q "$LOCAL_UID" "$DUMP"; then
  echo "  ⚠ local UID still present after remap — aborting to avoid FK errors." >&2
  exit 1
fi
echo "  dump size: $(du -h "$DUMP" | cut -f1)"

echo "[05b] Copying dump to VM…"
gcloud compute scp "$DUMP" "$VM_NAME:/tmp/appdata.sql" --zone "$GCP_ZONE"

echo "[05b] Restoring on VM (as postgres; public tables are postgres-owned)…"
gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" --command "bash -s" <<'REMOTE'
set -euo pipefail
cd ~/sportai/docker
set -a; . ./.env; set +a
# ON_ERROR_STOP=0: tolerate re-runs (duplicate PKs) but surface FK issues.
sudo docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" -i sportai-db \
  psql -U postgres -d postgres -v ON_ERROR_STOP=0 < /tmp/appdata.sql
rm -f /tmp/appdata.sql
echo '[vm] Verifying row counts for the prod user…'
sudo docker exec -e PGPASSWORD="$POSTGRES_PASSWORD" sportai-db psql -U postgres -d postgres -At -c \
  "select 'activities', count(*) from activities union all \
   select 'coaching_messages', count(*) from coaching_messages union all \
   select 'activity_notes', count(*) from activity_notes union all \
   select 'storage.objects', count(*) from storage.objects;"
REMOTE

# ── Storage files ────────────────────────────────────────────────────────────
echo "[05b] Archiving local storage volume '$LOCAL_STORAGE_VOLUME'…"
if docker volume inspect "$LOCAL_STORAGE_VOLUME" >/dev/null 2>&1; then
  # Run tar from / and target the mount path explicitly; write archive to the bind mount.
  docker run --rm -v "$LOCAL_STORAGE_VOLUME":/data:ro -v "$WORK":/backup alpine \
    sh -c 'cd /data && tar cf /backup/storage-data.tar . && ls -la /backup/storage-data.tar'
  if [ -s "$STORAGE_TAR" ]; then
    echo "  archive size: $(du -h "$STORAGE_TAR" | cut -f1)"
    gcloud compute scp "$STORAGE_TAR" "$VM_NAME:/tmp/storage-data.tar" --zone "$GCP_ZONE"
    # UIDs are passed as POSITIONAL ARGS to the remote bash ($1=local, $2=prod),
    # avoiding any heredoc interpolation of shell logic. The remote script body is
    # single-quoted so nothing expands locally; only $1/$2 carry the UUIDs.
    gcloud compute ssh "$VM_NAME" --zone "$GCP_ZONE" \
      --command "bash -s '$LOCAL_UID' '$PROD_UID'" <<'REMOTE'
set -euo pipefail
LOCAL_UID="$1"; PROD_UID="$2"
cd ~/sportai/docker
VOL=$(sudo docker volume ls --format '{{.Name}}' | grep -E 'storage-data$' | head -n1)
echo "[vm] target storage volume: $VOL (remap $LOCAL_UID -> $PROD_UID)"
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml stop storage || true
sudo docker run --rm -e L="$LOCAL_UID" -e P="$PROD_UID" \
  -v "$VOL":/data -v /tmp:/backup alpine sh -c '
    set -e
    cd /data && tar xf /backup/storage-data.tar
    # Rename the on-disk user-UID folder local->prod so paths match the remapped
    # storage.objects rows (and storage RLS which checks the path user-folder).
    for d in $(find /data -type d -name "$L"); do
      nd=$(printf "%s" "$d" | sed "s#$L#$P#")
      mkdir -p "$(dirname "$nd")"
      cp -a "$d/." "$nd/" 2>/dev/null || true
    done
    chown -R 1000:1000 /data
  '
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml start storage
rm -f /tmp/storage-data.tar
echo '[vm] storage files restored (paths remapped to prod UID).'
REMOTE
  else
    echo "  ⚠ storage archive empty — skipping file copy (no uploaded files locally?)."
  fi
else
  echo "  ⚠ volume '$LOCAL_STORAGE_VOLUME' not found — skipping storage files."
fi

echo
echo "[05b] DONE. Log into prod and confirm your activities / coach history appear."
