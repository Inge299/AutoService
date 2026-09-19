#!/usr/bin/env bash
# Downloads and verifies one off-host backup, then restores its database into a disposable PostgreSQL container.
set -euo pipefail
umask 077

backup_id="${1:?Usage: restore-drill-autoservice.sh <backup-id>}"
backup_prefix="${BACKUP_S3_PREFIX:-autoservice}"
require() { [[ -n "${!1:-}" ]] || { echo "Missing required variable: $1" >&2; exit 2; }; }
for variable in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY; do require "$variable"; done

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/autoservice-restore.XXXXXX")"
container="autoservice-restore-drill-$(date +%s)"
cleanup() { docker rm -f "$container" >/dev/null 2>&1 || true; rm -rf "$stage_dir"; }
trap cleanup EXIT

echo "Downloading backup $backup_id"
docker run --rm -v "$stage_dir:/restore" \
  -e "BACKUP_S3_ENDPOINT=$BACKUP_S3_ENDPOINT" -e "BACKUP_S3_ACCESS_KEY=$BACKUP_S3_ACCESS_KEY" \
  -e "BACKUP_S3_SECRET_KEY=$BACKUP_S3_SECRET_KEY" -e "BACKUP_S3_BUCKET=$BACKUP_S3_BUCKET" \
  -e "BACKUP_S3_PREFIX=$backup_prefix" -e "BACKUP_ID=$backup_id" \
  quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z /bin/sh -ceu '
  mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY"
  mc mirror "backup/$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/$BACKUP_ID" /restore
'

[[ -f "$stage_dir/postgres.dump" && -f "$stage_dir/manifest.sha256" ]] || { echo "Backup is incomplete" >&2; exit 1; }
(cd "$stage_dir" && sha256sum -c manifest.sha256)

echo "Restoring the database into an isolated container"
docker run -d --rm --name "$container" -e POSTGRES_DB=autoservice -e POSTGRES_USER=autoservice -e POSTGRES_PASSWORD=restore-check postgres:17-alpine >/dev/null
for _ in $(seq 1 30); do
  if docker exec "$container" pg_isready -U autoservice -d autoservice >/dev/null; then break; fi
  sleep 1
done
docker exec "$container" pg_isready -U autoservice -d autoservice >/dev/null
docker exec -i "$container" pg_restore -U autoservice -d autoservice --exit-on-error < "$stage_dir/postgres.dump"
docker exec "$container" psql -U autoservice -d autoservice -Atc "SELECT count(*) FROM _prisma_migrations" | grep -Eq '^[1-9][0-9]*$'
docker exec "$container" psql -U autoservice -d autoservice -Atc "SELECT count(*) FROM media_assets" >/dev/null

echo "Restore drill passed: checksums, migrations, and database catalogue are readable."
