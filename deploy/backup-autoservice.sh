#!/usr/bin/env bash
# Creates a consistent PostgreSQL + media backup and uploads it to a separate S3-compatible storage.
set -euo pipefail
umask 077

root_dir="${AUTOSERVICE_ROOT:-/opt/autoservice}"
project="${AUTOSERVICE_COMPOSE_PROJECT:-autoservice}"
env_file="${AUTOSERVICE_ENV_FILE:-$root_dir/.env}"
compose_file="${AUTOSERVICE_COMPOSE_FILE:-$root_dir/current/docker-compose.deploy.yml}"
backup_prefix="${BACKUP_S3_PREFIX:-autoservice}"

require() { [[ -n "${!1:-}" ]] || { echo "Missing required variable: $1" >&2; exit 2; }; }
for variable in BACKUP_S3_ENDPOINT BACKUP_S3_BUCKET BACKUP_S3_ACCESS_KEY BACKUP_S3_SECRET_KEY; do require "$variable"; done
[[ -r "$env_file" ]] || { echo "Cannot read $env_file" >&2; exit 2; }

# shellcheck disable=SC1090
set -a; source "$env_file"; set +a
for variable in POSTGRES_PASSWORD MINIO_ROOT_USER MINIO_ROOT_PASSWORD; do require "$variable"; done
case "$BACKUP_S3_ENDPOINT" in *localhost*|*127.0.0.1*|*minio:*) echo "BACKUP_S3_ENDPOINT must point to separate storage" >&2; exit 2;; esac

stage_dir="$(mktemp -d "${TMPDIR:-/tmp}/autoservice-backup.XXXXXX")"
backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
cleanup() { rm -rf "$stage_dir"; }
trap cleanup EXIT

compose=(docker compose -p "$project" --env-file "$env_file" -f "$compose_file")
echo "Creating PostgreSQL dump $backup_id"
"${compose[@]}" exec -T postgres pg_dump -U autoservice -d autoservice -Fc > "$stage_dir/postgres.dump"

echo "Copying media from the private bucket"
docker run --rm --network "${project}_default" -v "$stage_dir:/backup" \
  -e "MINIO_ROOT_USER=$MINIO_ROOT_USER" -e "MINIO_ROOT_PASSWORD=$MINIO_ROOT_PASSWORD" \
  quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z /bin/sh -ceu '
    mc alias set source http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
    mc mirror --overwrite source/autoservice-media /backup/media
  '

cat > "$stage_dir/metadata.json" <<EOF
{"backupId":"$backup_id","createdAt":"$(date -u +%FT%TZ)","schema":"postgresql+minio","version":"$(git -C "$root_dir/current" rev-parse HEAD 2>/dev/null || echo unknown)"}
EOF
(cd "$stage_dir" && find . -type f -print0 | sort -z | xargs -0 sha256sum > manifest.sha256)

echo "Uploading encrypted-transport backup to off-host storage"
docker run --rm -v "$stage_dir:/backup:ro" \
  -e "BACKUP_S3_ENDPOINT=$BACKUP_S3_ENDPOINT" -e "BACKUP_S3_ACCESS_KEY=$BACKUP_S3_ACCESS_KEY" \
  -e "BACKUP_S3_SECRET_KEY=$BACKUP_S3_SECRET_KEY" -e "BACKUP_S3_BUCKET=$BACKUP_S3_BUCKET" \
  -e "BACKUP_S3_PREFIX=$backup_prefix" -e "BACKUP_ID=$backup_id" \
  quay.io/minio/mc:RELEASE.2025-08-13T08-35-41Z /bin/sh -ceu '
    mc alias set backup "$BACKUP_S3_ENDPOINT" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY"
    mc mb --ignore-existing "backup/$BACKUP_S3_BUCKET"
    mc mirror --overwrite /backup "backup/$BACKUP_S3_BUCKET/$BACKUP_S3_PREFIX/$BACKUP_ID"
  '

echo "Backup uploaded: $backup_prefix/$backup_id"
