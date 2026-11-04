#!/usr/bin/env bash
# Local safety net. A copy on Mia does not protect against losing Mia.
set -euo pipefail
umask 077
root_dir="${AUTOSERVICE_ROOT:-/opt/autoservice}"
backup_root="$root_dir/backups/automatic-local"
env_file="${AUTOSERVICE_ENV_FILE:-$root_dir/.env}"
mkdir -p "$backup_root"
chmod 700 "$backup_root"
exec 9>"$backup_root/.lock"
flock -n 9 || { echo "Local backup already running" >&2; exit 1; }
# Fail before adding data when the filesystem is already close to full.
used="$(df -P "$backup_root" | awk 'NR==2 {gsub(/%/, "", $5); print $5}')"
[[ "$used" =~ ^[0-9]+$ && "$used" -lt 85 ]] || { echo "Local backup refused: disk ${used}%" >&2; exit 1; }
[[ -r "$env_file" ]] || { echo "Production environment file missing" >&2; exit 1; }
backup_id="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d "$backup_root/.pending.XXXXXX")"
trap 'rm -rf "$stage"' EXIT
# Discover only this compose project's persistent services; never touch other projects.
postgres="$(docker ps -q --filter label=com.docker.compose.project=autoservice --filter label=com.docker.compose.service=postgres)"
minio="$(docker ps -q --filter label=com.docker.compose.project=autoservice --filter label=com.docker.compose.service=minio)"
[[ -n "$postgres" && "$postgres" != *$'\n'* && -n "$minio" && "$minio" != *$'\n'* ]] || { echo "Expected one AutoService PostgreSQL and MinIO container" >&2; exit 1; }
docker exec "$postgres" pg_dump -U autoservice -d autoservice -Fc > "$stage/postgres.dump"
# Persisted MinIO layout, including metadata, for the existing MinIO version.
# tar fails if it detects an object changing during the archive; incomplete sets stay hidden.
docker run --rm --network none --volumes-from "$minio:ro" --entrypoint tar \
  postgres:17-alpine -C /data -czf - . > "$stage/minio-data.tar.gz"
install -m 600 "$env_file" "$stage/production.env"
cp "$root_dir/current/docker-compose.deploy.yml" "$stage/docker-compose.deploy.yml"
readlink -f "$root_dir/current" > "$stage/release.txt"
docker inspect --format '{{.Name}} {{.Config.Image}}' "$postgres" "$minio" > "$stage/storage-images.txt"
tar -tzf "$stage/minio-data.tar.gz" >/dev/null
[[ -s "$stage/postgres.dump" ]]
(cd "$stage" && sha256sum postgres.dump minio-data.tar.gz production.env docker-compose.deploy.yml release.txt storage-images.txt > SHA256SUMS && sha256sum -c SHA256SUMS)
mv "$stage" "$backup_root/$backup_id"
trap - EXIT
echo "Local backup verified: $backup_root/$backup_id"
# Retention is limited to this script's timestamp directories, and only after success.
# Existing pre-release/manual backups are outside this directory and remain untouched.
find "$backup_root" -mindepth 1 -maxdepth 1 -type d -name '20??????T??????Z' -mtime +7 -exec rm -rf -- {} +
