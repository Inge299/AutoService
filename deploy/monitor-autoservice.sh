#!/usr/bin/env bash
# Fails loudly for systemd/cron and can optionally notify a configured incident webhook.
set -euo pipefail
umask 077

root_dir="${AUTOSERVICE_ROOT:-/opt/autoservice}"
env_file="${AUTOSERVICE_ENV_FILE:-$root_dir/.env}"
api_url="${AUTOSERVICE_API_URL:-http://127.0.0.1:8080}"
web_url="${AUTOSERVICE_WEB_URL:-http://127.0.0.1:3001}"
max_disk_percent="${AUTOSERVICE_MAX_DISK_PERCENT:-85}"
max_dead_jobs="${AUTOSERVICE_MAX_DEAD_JOBS:-0}"
max_5xx="${AUTOSERVICE_MAX_5XX_SINCE_START:-5}"

alert() {
  local message="$1"
  echo "AUTOSERVICE MONITOR: $message" >&2
  if [[ -n "${AUTOSERVICE_ALERT_WEBHOOK:-}" ]]; then
    curl --fail --silent --show-error --max-time 10 -X POST -H 'content-type: application/json' \
      --data "{\"text\":\"AutoService: $message\"}" "$AUTOSERVICE_ALERT_WEBHOOK" >/dev/null
  fi
  exit 1
}

[[ -r "$env_file" ]] || alert "cannot read production environment file"
# shellcheck disable=SC1090
set -a; source "$env_file"; set +a
[[ -n "${INTERNAL_API_KEY:-}" ]] || alert "INTERNAL_API_KEY is absent"

curl --fail --silent --show-error --max-time 10 "$api_url/health/live" >/dev/null || alert "API liveness check failed"
curl --fail --silent --show-error --max-time 10 "$api_url/health/ready" >/dev/null || alert "API readiness check failed"
curl --fail --silent --show-error --max-time 10 "$web_url" >/dev/null || alert "web application check failed"

disk_percent="$(df -P / | awk 'NR == 2 {gsub(/%/, "", $5); print $5}')"
[[ "$disk_percent" =~ ^[0-9]+$ && "$disk_percent" -lt "$max_disk_percent" ]] || alert "disk usage is ${disk_percent:-unknown}%"

metrics_header_file="$(mktemp "${TMPDIR:-/tmp}/autoservice-monitor-header.XXXXXX")"
trap 'rm -f "$metrics_header_file"' EXIT
printf 'header = "x-internal-api-key: %s"\n' "$INTERNAL_API_KEY" > "$metrics_header_file"
metrics="$(curl --config "$metrics_header_file" --fail --silent --show-error --max-time 10 "$api_url/health/metrics")" || alert "metrics check failed"
printf '%s' "$metrics" | MAX_DEAD_JOBS="$max_dead_jobs" MAX_5XX="$max_5xx" node -e '
  const metrics = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  const dead = metrics.backgroundJobs?.DEAD ?? 0;
  const errors = metrics.http?.responses5xx ?? 0;
  if (dead > Number(process.env.MAX_DEAD_JOBS) || errors > Number(process.env.MAX_5XX)) process.exit(1);
' || alert "queue or HTTP error threshold exceeded"

echo "AutoService monitor passed: disk ${disk_percent}%, API, web, storage readiness, queue and HTTP counters are healthy."
