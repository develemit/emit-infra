#!/usr/bin/env bash
# Tests for scripts/lib/deploy-plan.sh. Run: bash scripts/lib/deploy-plan.test.sh
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-plan.sh"
source "$LIB"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }
check_true()  { if "${@:2}"; then ok "$1"; else no "$1 (expected true)"; fi; }
check_false() { if "${@:2}"; then no "$1 (expected false)"; else ok "$1"; fi; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ── fixture repo ──────────────────────────────────────────────────────────────
cd "$WORK"
git init -q .
git config user.email t@t.t && git config user.name t
mkdir -p apps/web apps/api packages/ui sprint docs
echo a > apps/web/index.ts && echo a > apps/api/index.ts && echo a > packages/ui/i.ts
echo a > README.md && echo a > sprint/1.md && echo a > docs/d.md && echo a > pnpm-lock.yaml
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)

echo "resolve_last_deployed_sha"

check "no files -> empty" "$(resolve_last_deployed_sha "$WORK")" ""

printf '{"status":"deployed","sha":"aaa111"}\n' > .deploy-status.json
check "status deployed -> its sha" "$(resolve_last_deployed_sha "$WORK")" "aaa111"

# The bug: an interrupted deploy leaves status "deploying" and used to yield ''.
printf '{"status":"deploying","sha":"bbb222"}\n' > .deploy-status.json
check "status deploying, no history -> empty" "$(resolve_last_deployed_sha "$WORK")" ""

{
  printf '{"status":"deployed","sha":"old000"}\n'
  printf '{"status":"deployed","sha":"good999"}\n'
  printf '{"status":"failed","sha":"bad888"}\n'
} > .deploy-history.jsonl
check "status deploying -> newest deployed from history" \
  "$(resolve_last_deployed_sha "$WORK")" "good999"

printf '{"status":"deployed","sha":"ccc333"}\n' > .deploy-status.json
check "status file wins over history" "$(resolve_last_deployed_sha "$WORK")" "ccc333"

printf '{"status":"deploying","sha":"x"}\n' > .deploy-status.json
{ printf 'not json\n'; printf '{"status":"deployed","sha":"survivor"}\n'; } > .deploy-history.jsonl
check "corrupt history lines skipped" "$(resolve_last_deployed_sha "$WORK")" "survivor"

: > .deploy-history.jsonl
printf '{"status":"failed","sha":"f"}\n' > .deploy-history.jsonl
check "no successful deploy on record -> empty (full rebuild)" \
  "$(resolve_last_deployed_sha "$WORK")" ""

# sprint 269: a CLI deploy (packages/core/src/deploy-records.ts) writes the
# same shape ci-utils.sh's deploy_done does, so the reader can't tell them
# apart — this is a fixture line shaped like deployRecordDone's output.
: > .deploy-status.json
printf '{"status":"deployed","sha":"cli9876","branch":"main","startedAt":"2026-08-02T00:00:00Z","completedAt":"2026-08-02T00:00:12Z","durationSec":12,"servicesBuilt":[],"phases":{"deploy":12},"message":"cli deploy"}\n' \
  > .deploy-history.jsonl
check "CLI-written history line resolves like a hook-written one" \
  "$(resolve_last_deployed_sha "$WORK")" "cli9876"

rm -f .deploy-status.json .deploy-history.jsonl

echo "deploy_ignore_specs / only_ignored_paths_changed"

check "glob magic applied" "$(deploy_ignore_specs 'docs/**')" ':(exclude,glob)docs/**'

DEFAULTS=("${EMIT_DEFAULT_DEPLOY_IGNORE_PATHS[@]}")

echo b > sprint/2.md && git add -A && git commit -qm sprint-only
check_true "sprint-only commit is ignorable" only_ignored_paths_changed "$BASE" "${DEFAULTS[@]}"

echo b > docs/d2.md && git add -A && git commit -qm docs
check_true "sprint+docs still ignorable" only_ignored_paths_changed "$BASE" "${DEFAULTS[@]}"

echo b > README.md && git add -A && git commit -qm root-md
check_true "root *.md ignorable" only_ignored_paths_changed "$BASE" "${DEFAULTS[@]}"

echo b > apps/web/index.ts && git add -A && git commit -qm code
check_false "code change is not ignorable" only_ignored_paths_changed "$BASE" "${DEFAULTS[@]}"

# '*.md' must be root-only, so a nested markdown file outside docs/ still deploys.
CODE=$(git rev-parse HEAD)
mkdir -p apps/web/notes && echo b > apps/web/notes/n.md && git add -A && git commit -qm nested-md
check_false "nested *.md is not covered by root *.md" \
  only_ignored_paths_changed "$CODE" "${DEFAULTS[@]}"

check_false "empty pattern list never skips" only_ignored_paths_changed "$BASE"
check_false "empty base never skips" only_ignored_paths_changed "" "${DEFAULTS[@]}"
check_false "unknown base never skips" only_ignored_paths_changed "deadbee" "${DEFAULTS[@]}"

echo "service_needs_build"

ALL=$'web\napi\nui'
git reset -q --hard "$CODE"
B=$(git rev-parse HEAD)
echo c > packages/ui/i.ts && git add -A && git commit -qm ui-change

# The bug: a packages/ change used to rebuild every service.
check_true  "affected service rebuilds"     service_needs_build web "$B" "$ALL" $'web\nui' ""
check_false "unaffected service re-tags"    service_needs_build api "$B" "$ALL" $'web\nui' ""
check_false "nothing affected -> no build"  service_needs_build api "$B" "$ALL" "" ""

# nx emits a JSON array when stdout isn't a TTY (always, under a git hook) and
# newline-separated names when it is. Stub `pnpm` to cover both plus failure.
_stub_pnpm() { NX_STUB_OUT="$1" NX_STUB_RC="${2:-0}"; }
pnpm() { printf '%s\n' "$NX_STUB_OUT"; return "$NX_STUB_RC"; }

_stub_pnpm '["api","web","@scope/logger"]'
check "nx_projects parses JSON array output" "$(nx_projects | tr '\n' ' ')" "api web @scope/logger "
_stub_pnpm $'api\nweb\n\n@scope/logger'
check "nx_projects parses newline output" "$(nx_projects | tr '\n' ' ')" "api web @scope/logger "
_stub_pnpm '[]'
check "nx_projects handles empty affected set" "$(nx_projects | tr '\n' ' ')" ""
_stub_pnpm '' 1
check "nx_projects preserves failure status" "$(nx_projects >/dev/null 2>&1; echo $?)" "1"
unset -f pnpm

check_true "no base sha -> rebuild" service_needs_build api "" "$ALL" "" ""
check_true "unknown base sha -> rebuild" service_needs_build api "deadbee" "$ALL" "" ""
check_true "service not an nx project -> glob fallback (packages/ touched)" \
  service_needs_build api "$B" $'web\nui' "" ""
check_true "non-nx repo -> glob fallback (packages/ touched)" \
  service_needs_build api "$B" "" "" ""

git reset -q --hard "$B"
B2=$(git rev-parse HEAD)
echo c > pnpm-lock.yaml && git add -A && git commit -qm lock
check_true "pnpm-lock.yaml always rebuilds, even when nx says unaffected" \
  service_needs_build api "$B2" "$ALL" "" ""

git reset -q --hard "$B2"
B3=$(git rev-parse HEAD)
echo FROM > apps/api/Dockerfile && git add -A && git commit -qm dockerfile
check_true "own Dockerfile always rebuilds" service_needs_build api "$B3" "$ALL" "" ""
check_false "other service's Dockerfile does not" service_needs_build web "$B3" "$ALL" "" ""

git reset -q --hard "$B3"
B4=$(git rev-parse HEAD)
mkdir -p deploy && echo x > deploy/api.yml && git add -A && git commit -qm infra
check_true "ci.buildTriggerPaths honored" \
  service_needs_build api "$B4" "$ALL" "" "deploy/"
check_true "buildTriggerPaths %s expands to service name" \
  service_needs_build api "$B4" "$ALL" "" "deploy/%s.yml"
check_false "buildTriggerPaths %s does not match other services" \
  service_needs_build web "$B4" "$ALL" "" "deploy/%s.yml"

echo "run_build_fanout"

FAIL_COUNT=0
_count_fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); }
build_image() { [[ "$1" == bad* ]] && return 1; return 0; }

FAIL_COUNT=0
run_build_fanout 1 _count_fail good1 good2
check "no failures -> on_fail never called" "$FAIL_COUNT" "0"

FAIL_COUNT=0
run_build_fanout 1 _count_fail good1 bad1 good2
check "one failure -> on_fail called once" "$FAIL_COUNT" "1"

FAIL_COUNT=0
run_build_fanout 1 _count_fail bad1 good1 bad2
check "multiple failures -> on_fail called per failure" "$FAIL_COUNT" "2"

FAIL_COUNT=0
run_build_fanout 3 _count_fail good1 bad1 good2 bad2 good3
check "parallel batches (max_parallel>1) still catch every failure" "$FAIL_COUNT" "2"

unset -f build_image _count_fail

# sprint 270 / sprint 267: `wait "$pid" || exit 1` used to bypass the ERR
# trap's `deploy_done failed` (wait sits left of `||`, and the explicit exit
# that follows doesn't fire ERR either), leaving .deploy-status.json stuck at
# "deploying" on a failed backgrounded build. run_build_fanout must reach
# deploy_done failed by calling on_fail directly, with no trap involved.
CIUTILS="$(cd "$(dirname "$LIB")" && pwd)/ci-utils.sh"
BUILD_WORK=$(mktemp -d)
(
  cd "$BUILD_WORK"
  git init -q .
  git config user.email t@t.t && git config user.name t
  git commit -q --allow-empty -m base
  source "$CIUTILS"
  source "$LIB"
  build_image() { [[ "$1" == "bad" ]] && return 1; return 0; }
  _fail_deploy() { deploy_done failed; exit 1; }
  deploy_init 1
  run_build_fanout 1 _fail_deploy good bad good2
) >/dev/null 2>&1
BUILD_STATUS=$(python3 -c "import json; print(json.load(open('$BUILD_WORK/.deploy-status.json'))['status'])" 2>/dev/null || echo MISSING)
check "forced build failure ends .deploy-status.json failed" "$BUILD_STATUS" "failed"
BUILD_HIST_STATUS=$(python3 -c "import json; print(json.loads(open('$BUILD_WORK/.deploy-history.jsonl').readlines()[-1])['status'])" 2>/dev/null || echo MISSING)
check "history line records the failure" "$BUILD_HIST_STATUS" "failed"
rm -rf "$BUILD_WORK"

echo "push_payload_summary"

PAYLOAD_WORK=$(mktemp -d)
git -C "$PAYLOAD_WORK" init -q .
git -C "$PAYLOAD_WORK" config user.email t@t.t && git -C "$PAYLOAD_WORK" config user.name t
git -C "$PAYLOAD_WORK" commit -q --allow-empty -m base
PAYLOAD_BASE=$(git -C "$PAYLOAD_WORK" rev-parse HEAD)
git -C "$PAYLOAD_WORK" commit -q --allow-empty -m "first change"
PAYLOAD_MID=$(git -C "$PAYLOAD_WORK" rev-parse HEAD)
git -C "$PAYLOAD_WORK" commit -q --allow-empty -m "second change"
PAYLOAD_HEAD=$(git -C "$PAYLOAD_WORK" rev-parse HEAD)

MULTI_OUT=$(cd "$PAYLOAD_WORK" && push_payload_summary "$PAYLOAD_BASE" "$PAYLOAD_HEAD")
case "$MULTI_OUT" in
  *"2 commit(s)"*) ok "multi-commit push reports correct count" ;;
  *) no "multi-commit push reports correct count (got: $MULTI_OUT)" ;;
esac
case "$MULTI_OUT" in
  *"first change"*) ok "oldest commit's subject is reported, not the newest" ;;
  *) no "oldest commit's subject is reported, not the newest (got: $MULTI_OUT)" ;;
esac

SINGLE_OUT=$(cd "$PAYLOAD_WORK" && push_payload_summary "$PAYLOAD_MID" "$PAYLOAD_HEAD")
case "$SINGLE_OUT" in
  *"1 commit(s)"*) ok "single-commit push reports count 1" ;;
  *) no "single-commit push reports count 1 (got: $SINGLE_OUT)" ;;
esac

NEWBRANCH_OUT=$(cd "$PAYLOAD_WORK" && push_payload_summary "0000000000000000000000000000000000000000" "$PAYLOAD_HEAD")
case "$NEWBRANCH_OUT" in
  *"new branch"*) ok "unresolvable remote sha (new branch push) doesn't error" ;;
  *) no "unresolvable remote sha (new branch push) doesn't error (got: $NEWBRANCH_OUT)" ;;
esac
rm -rf "$PAYLOAD_WORK"

echo "detect_dry_run_push"

# Drive the real code path: a git push into a local bare remote, with a hook
# that reports what detect_dry_run_push() decided.
REMOTE="$WORK/remote.git"
git init -q --bare "$REMOTE"
mkdir -p .githooks
cat > .githooks/pre-push <<EOF
#!/usr/bin/env bash
source "$LIB"
if detect_dry_run_push; then echo "HOOK:DRYRUN"; else echo "HOOK:REAL"; fi
EOF
chmod +x .githooks/pre-push
git config core.hooksPath .githooks
git remote add origin "$REMOTE"

REAL=$(git push origin HEAD:refs/heads/main 2>&1 | grep -o 'HOOK:[A-Z]*' | head -1)
check "real push not flagged" "$REAL" "HOOK:REAL"

DRY=$(git push --dry-run origin HEAD:refs/heads/other 2>&1 | grep -o 'HOOK:[A-Z]*' | head -1)
check "--dry-run push flagged" "$DRY" "HOOK:DRYRUN"

DRYN=$(git push -n origin HEAD:refs/heads/other2 2>&1 | grep -o 'HOOK:[A-Z]*' | head -1)
check "-n push flagged" "$DRYN" "HOOK:DRYRUN"

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
