#!/usr/bin/env bash
# health-check-all.sh — Run health-check.sh for each PORT:PATH pair in sequence.
#
# Usage:
#   ./health-check-all.sh PORT:PATH [PORT:PATH ...]
#
# Example:
#   ./health-check-all.sh 4300:/ 4301:/readyz 4302:/healthz
#
# Each pair is checked with 20 retries and 5s backoff. Exits non-zero as soon
# as any check fails.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ "$#" -eq 0 ]; then
  echo "Usage: $(basename "$0") PORT:PATH [PORT:PATH ...]"
  exit 1
fi

for pair in "$@"; do
  port="${pair%%:*}"
  path="${pair#*:}"
  echo "==> Checking port ${port} at ${path}..."
  "${SCRIPT_DIR}/health-check.sh" "$port" 20 "$path" 5
done
