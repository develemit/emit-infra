#!/usr/bin/env bash
# Tests for scripts/check-all.sh and scripts/lib/check-all-lib.sh.
# Run: bash scripts/lib/check-all.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER="$LIB_DIR/../check-all.sh"
source "$LIB_DIR/check-all-lib.sh"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }
contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else no "$1 (output missing '$3'): $2"; fi; }

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

echo "bash -n is clean on both files"
if bash -n "$RUNNER" && bash -n "$LIB_DIR/check-all-lib.sh"; then
  ok "bash -n clean"
else
  no "bash -n clean"
fi

# ── config readers ───────────────────────────────────────────────────────────
FULL="$WORK/full.json"
cat > "$FULL" <<'JSON'
{"ci": {"prePush": ["format", "lint", "typecheck", "test", "build"],
  "checkAll": {
    "preflight": ["pnpm generate:contracts", "pnpm lint:migrations"],
    "targets": ["lint", "test"],
    "format": "pnpm run format:check",
    "e2e": "bash tools/e2e-smoke.sh",
    "exclude": ["workspace", "docs"],
    "parallel": 4
  }}}
JSON

echo "explicit checkAll config wins"
check "targets" "$(_ca_targets "$FULL")" "lint test"
check "parallel" "$(_ca_parallel "$FULL")" "4"
check "format command" "$(_ca_format_cmd "$FULL")" "pnpm run format:check"
check "e2e command" "$(_ca_e2e_cmd "$FULL")" "bash tools/e2e-smoke.sh"
check "exclude args" "$(_ca_exclude_args "$FULL")" "--exclude=workspace --exclude=docs"
check "preflight lines" "$(_ca_preflight "$FULL" | tr '\n' '|')" "pnpm generate:contracts|pnpm lint:migrations|"

PREPUSH_ONLY="$WORK/prepush.json"
echo '{"ci": {"prePush": ["format", "lint", "typecheck", "test", "build", "e2e"]}}' > "$PREPUSH_ONLY"
echo "no checkAll block falls back to prePush"
check "targets strip format AND e2e from prePush" "$(_ca_targets "$PREPUSH_ONLY")" "lint typecheck test build"
EXPLICIT_E2E="$WORK/explicit-e2e.json"
echo '{"ci": {"checkAll": {"targets": ["lint", "e2e", "test"]}}}' > "$EXPLICIT_E2E"
check "e2e stripped even from explicit targets" "$(_ca_targets "$EXPLICIT_E2E")" "lint test"
check "format in prePush implies pnpm format" "$(_ca_format_cmd "$PREPUSH_ONLY")" "pnpm format"
check "parallel defaults to 2" "$(_ca_parallel "$PREPUSH_ONLY")" "2"
check "no preflight" "$(_ca_preflight "$PREPUSH_ONLY")" ""
check "no exclude args" "$(_ca_exclude_args "$PREPUSH_ONLY")" ""

NOFORMAT="$WORK/noformat.json"
echo '{"ci": {"prePush": ["lint", "test"], "checkAll": {"format": false}}}' > "$NOFORMAT"
echo "format: false disables the format phase"
check "format disabled" "$(_ca_format_cmd "$NOFORMAT")" ""

EMPTY="$WORK/empty.json"
echo '{}' > "$EMPTY"
echo "empty config gets the standard four"
check "default targets" "$(_ca_targets "$EMPTY")" "lint typecheck test build"

BROKEN="$WORK/broken.json"
echo 'not json' > "$BROKEN"
echo "unparseable config degrades to defaults, not a crash"
check "targets on broken json" "$(_ca_targets "$BROKEN")" "lint typecheck test build"
check "parallel on broken json" "$(_ca_parallel "$BROKEN")" "2"

# ── runner behavior (dry-run inside a fixture repo) ──────────────────────────
REPO="$WORK/repo"
mkdir -p "$REPO"
git -C "$REPO" init -q -b main
cp "$FULL" "$REPO/.emit-infra.json"

run_dry() { (cd "$REPO" && CHECK_ALL_DRY_RUN=1 bash "$RUNNER" "$@" 2>&1); }

echo "dry-run full mode"
OUT="$(run_dry full)"; RC=$?
check "exits 0" "$RC" "0"
contains "announces budget" "$OUT" "vitest_workers=3"
contains "runs preflight first" "$OUT" "→ pnpm generate:contracts"
contains "runs configured format" "$OUT" "→ pnpm run format:check"
contains "one combined nx invocation" "$OUT" "nx run-many -t lint,test --parallel=4 --exclude=workspace --exclude=docs"
if [[ "$OUT" != *"tools/e2e-smoke.sh"* ]]; then ok "full mode skips e2e"; else no "full mode skips e2e: $OUT"; fi

echo "dry-run e2e mode appends the e2e phase"
OUT="$(run_dry e2e)"
contains "runs e2e command" "$OUT" "→ bash tools/e2e-smoke.sh"

echo "dry-run affected mode"
OUT="$(run_dry affected)"
contains "falls back without origin/main" "$OUT" "origin/main unresolvable"
contains "fallback still runs the targets" "$OUT" "nx run-many -t lint,test"

echo "affected mode uses --base without --head when origin/main exists"
git -C "$REPO" commit -q --allow-empty -m seed
git -C "$REPO" update-ref refs/remotes/origin/main HEAD
OUT="$(run_dry affected)"
contains "uses affected with base" "$OUT" "nx affected -t lint,test --base=origin/main"
if [[ "$OUT" != *"--head"* ]]; then ok "never passes --head"; else no "never passes --head: $OUT"; fi

echo "mode validation"
OUT="$( (cd "$REPO" && bash "$RUNNER" bogus 2>&1) )"; RC=$?
check "unknown mode exits 1" "$RC" "1"
contains "names the bad mode" "$OUT" "unknown mode 'bogus'"

echo "missing config is a hard error, not a silent pass"
BARE="$WORK/bare"
mkdir -p "$BARE" && git -C "$BARE" init -q -b main
OUT="$( (cd "$BARE" && CHECK_ALL_DRY_RUN=1 bash "$RUNNER" full 2>&1) )"; RC=$?
check "exits 1 without .emit-infra.json" "$RC" "1"

echo "VITEST_MAX_WORKERS is respected when preset"
OUT="$( (cd "$REPO" && VITEST_MAX_WORKERS=7 CHECK_ALL_DRY_RUN=1 bash "$RUNNER" full 2>&1) )"
contains "caller override wins" "$OUT" "vitest_workers=7"

echo
echo "check-all: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
