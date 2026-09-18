#!/usr/bin/env bash
# Tests for scripts/lib/log-secret-scan.sh. Run: bash scripts/lib/log-secret-scan.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/log-secret-scan.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

echo "emit_scan_log_for_secrets"

CLEAN="$WORK/clean.log"
cat > "$CLEAN" <<'EOF'
Pulling ghcr.io/example/api:latest
Login Succeeded
Step 3/8 done
EOF
if emit_scan_log_for_secrets "$CLEAN" 2>/dev/null; then
  ok "passes a clean log"
else
  no "passes a clean log"
fi

# Fixture-only fake token — never a real credential.
FAKE_TOKEN="gho_$(printf 'x%.0s' $(seq 1 36))"

DIRTY_OAUTH="$WORK/dirty-oauth.log"
printf 'Login to GHCR\necho %s | docker login ghcr.io\n' "$FAKE_TOKEN" > "$DIRTY_OAUTH"
if emit_scan_log_for_secrets "$DIRTY_OAUTH" 2>/dev/null; then
  no "fails on a gho_ token"
else
  ok "fails on a gho_ token"
fi

ERR=$(emit_scan_log_for_secrets "$DIRTY_OAUTH" 2>&1 >/dev/null || true)
if [[ "$ERR" == *"SECURITY"* && "$ERR" != *"$FAKE_TOKEN"* ]]; then
  ok "error message warns loudly without echoing the token"
else
  no "error message warns loudly without echoing the token (got: $ERR)"
fi

DIRTY_PAT="$WORK/dirty-pat.log"
printf 'export GITHUB_TOKEN=github_pat_%s\n' "$(printf 'y%.0s' $(seq 1 40))" > "$DIRTY_PAT"
if emit_scan_log_for_secrets "$DIRTY_PAT" 2>/dev/null; then
  no "fails on a github_pat_ token"
else
  ok "fails on a github_pat_ token"
fi

MISSING="$WORK/does-not-exist.log"
if emit_scan_log_for_secrets "$MISSING" 2>/dev/null; then
  ok "passes when the file doesn't exist"
else
  no "passes when the file doesn't exist"
fi

echo
echo "log-secret-scan: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
