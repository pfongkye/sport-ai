#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# 05c — Storage FILES only (Part B), split out because Docker Desktop on macOS
# doesn't reliably share /var/folders mktemp dirs back to the host, so the tar
# written inside the alpine container wasn't visible to the host-side check.
# This uses a temp dir under $HOME (shared by Docker Desktop by default).
#
# DB rows (storage.objects) are already migrated by 05b — this only copies the
# actual files and remaps the on-disk user-UID folder.
#
#   ./deploy/gcp/05c_migrate_storage_files.sh
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail
cd "$(dirname "$0")"
source ./config.sh

LOCAL_UID="${LOCAL_UID:-72603a45-fd7c-44e5-a86c-b5e27d885a13}"
PROD_UID="${PROD_UID:-da04b5c1-fbc4-457b-89b1-9c14e20e6e44}"
LOCAL_STORAGE_VOLUME="${LOCAL_STORAGE_VOLUME:-docker_storage-data}"

# Temp dir under HOME so Docker Desktop (macOS) shares it with the host reliably.
WORK="$(mktemp -d "$HOME/.sportai-migrate.XXXXXX")"
STORAGE_TAR="$WORK/storage-data.tar"
trap 'rm -rf "$WORK"' EXIT

echo "[05c] Archiving local storage volume '$LOCAL_STORAGE_VOLUME' → $STORAGE_TAR"
docker run --rm -v "$LOCAL_STORAGE_VOLUME":/data:ro -v "$WORK":/backup alpine \
  sh -c 'cd /data && tar cf /backup/storage-data.tar . '

# Verify on the HOST this time.
if [ ! -s "$STORAGE_TAR" ]; then
  echo "  ✗ archive still not visible on host at $STORAGE_TAR" >&2
  echo "    Check Docker Desktop → Settings → Resources → File Sharing includes \$HOME." >&2
  exit 1
fi
echo "  archive size: $(du -h "$STORAGE_TAR" | cut -f1)"

echo "[05c] Copying archive to VM…"
gcloud compute scp "$STORAGE_TAR" "$VM_NAME:/tmp/storage-data.tar" --zone "$GCP_ZONE"

echo "[05c] Unpacking + remapping user folder on VM…"
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
    for d in $(find /data -type d -name "$L"); do
      nd=$(printf "%s" "$d" | sed "s#$L#$P#")
      mkdir -p "$(dirname "$nd")"
      cp -a "$d/." "$nd/" 2>/dev/null || true
    done
    chown -R 1000:1000 /data
    echo "[vm] files under prod UID:"; find /data -type f -path "*$P*" | wc -l
  '
sudo docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml start storage
rm -f /tmp/storage-data.tar
echo '[vm] storage files restored (paths remapped to prod UID).'
REMOTE

echo
echo "[05c] DONE. Open an activity in prod and confirm its file/map loads."
