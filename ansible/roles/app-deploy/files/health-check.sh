#!/usr/bin/env bash
set -euo pipefail

PORT="${1:?Usage: health-check.sh PORT [RETRIES] [PATH] [BACKOFF]}"
RETRIES="${2:-10}"
CHECK_PATH="${3:-/}"
BACKOFF="${4:-3}"
TIMEOUT=2

attempt=0
while [ "$attempt" -lt "$RETRIES" ]; do
  attempt=$((attempt + 1))
  status=$(curl -s -o /dev/null -w '%{http_code}' \
    --max-time "$TIMEOUT" \
    "http://127.0.0.1:${PORT}${CHECK_PATH}" 2>/dev/null) || status="000"

  case "$status" in
    2??|3??) echo "Health check passed (HTTP ${status}) on attempt ${attempt}"; exit 0 ;;
    *)       echo "Attempt ${attempt}/${RETRIES}: HTTP ${status}" ;;
  esac

  if [ "$attempt" -lt "$RETRIES" ]; then
    sleep "$BACKOFF"
  fi
done

echo "Health check failed after ${RETRIES} attempts on port ${PORT}"
exit 1
