#!/usr/bin/env bash
# Tests for scripts/lib/db-url.sh. Run: bash scripts/lib/db-url.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/db-url.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

# Mock node: echoes back its args instead of running the real CLI. These
# tests only check what db-url.sh hands off — the CLI itself is covered by
# apps/cli/src/commands/db-url.test.ts, and neither Docker nor a built dist/
# is available in this shell test.
MOCK_RC=0
node() {
  echo "ARGS:$*"
  return "$MOCK_RC"
}

EMIT_INFRA_DIR="/fake/emit-infra"

echo "emit_db_url"

OUT=$(emit_db_url)
check "invokes db-url on the dist entrypoint" "$OUT" "ARGS:/fake/emit-infra/apps/cli/dist/index.js db-url"

OUT=$(emit_db_url --service db)
check "forwards extra args" "$OUT" "ARGS:/fake/emit-infra/apps/cli/dist/index.js db-url --service db"

echo "emit_db_url_assert_identity"

OUT=$(emit_db_url_assert_identity)
check "adds --assert-identity" "$OUT" "ARGS:/fake/emit-infra/apps/cli/dist/index.js db-url --assert-identity"

OUT=$(emit_db_url_assert_identity --service db)
check "adds --assert-identity and forwards extra args" \
  "$OUT" "ARGS:/fake/emit-infra/apps/cli/dist/index.js db-url --assert-identity --service db"

echo "exit code propagation"

MOCK_RC=1
emit_db_url >/dev/null 2>&1
RC=$?
check "non-zero exit propagates" "$RC" "1"
MOCK_RC=0

echo "EMIT_INFRA_DIR defaulting"

unset EMIT_INFRA_DIR
HOME="/fake/home"
OUT=$(emit_db_url)
check "falls back to \$HOME/projects/emit-infra when unset" "$OUT" "ARGS:/fake/home/projects/emit-infra/apps/cli/dist/index.js db-url"

echo
echo "db-url: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
