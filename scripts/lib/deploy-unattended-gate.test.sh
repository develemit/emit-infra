#!/usr/bin/env bash
# Tests for the unattended-shell deploy gate (sprint 288): detect_unattended_shell
# / has_controlling_terminal in deploy-plan.sh, and the gate installed in
# scripts/hooks/pre-push between the ignored-paths filter and _fail_deploy.
# Run: bash scripts/lib/deploy-unattended-gate.test.sh
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deploy-plan.sh"
EMIT_INFRA_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }
check_true()  { if "${@:2}"; then ok "$1"; else no "$1 (expected true)"; fi; }
check_false() { if "${@:2}"; then no "$1 (expected false)"; else ok "$1"; fi; }

echo "detect_unattended_shell / has_controlling_terminal"

# Fresh `bash -c` per case: the ambient env this suite itself runs under
# typically has CLAUDECODE=1 set (that's the whole reason this gate exists),
# so each case unsets the markers before setting only what it's testing.
check_false "no markers -> detect_unattended_shell reports none" \
  bash -c 'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI; source "$1"; detect_unattended_shell' \
  bash "$LIB"

check "CLAUDECODE marker reported" \
  "$(bash -c 'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI; export CLAUDECODE=1; source "$1"; detect_unattended_shell' bash "$LIB")" \
  "CLAUDECODE"
check "CI marker reported" \
  "$(bash -c 'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI; export CI=1; source "$1"; detect_unattended_shell' bash "$LIB")" \
  "CI"
check "CLAUDE_CODE_ENTRYPOINT marker reported" \
  "$(bash -c 'unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI; export CLAUDE_CODE_ENTRYPOINT=sdk-cli; source "$1"; detect_unattended_shell' bash "$LIB")" \
  "CLAUDE_CODE_ENTRYPOINT"

# Mirrors the exact guard condition installed in scripts/hooks/pre-push.
_WOULD_BLOCK='[[ "${EMIT_ALLOW_UNATTENDED_DEPLOY:-0}" != "1" ]] && detect_unattended_shell >/dev/null'
check_true "would block: CLAUDECODE=1, no override" \
  bash -c "unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI EMIT_ALLOW_UNATTENDED_DEPLOY; export CLAUDECODE=1; source \"\$1\"; $_WOULD_BLOCK" bash "$LIB"
check_false "not blocked: EMIT_ALLOW_UNATTENDED_DEPLOY=1 overrides CLAUDECODE=1" \
  bash -c "unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI; export CLAUDECODE=1 EMIT_ALLOW_UNATTENDED_DEPLOY=1; source \"\$1\"; $_WOULD_BLOCK" bash "$LIB"
check_false "not blocked: no markers set at all" \
  bash -c "unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI EMIT_ALLOW_UNATTENDED_DEPLOY; source \"\$1\"; $_WOULD_BLOCK" bash "$LIB"
check_true "EMIT_FORCE_DEPLOY=1 alone does not affect the would-block check" \
  bash -c "unset CLAUDECODE CLAUDE_CODE_ENTRYPOINT CI EMIT_ALLOW_UNATTENDED_DEPLOY; export CLAUDECODE=1 EMIT_FORCE_DEPLOY=1; source \"\$1\"; $_WOULD_BLOCK" bash "$LIB"

# Smoke test only — whether this test suite itself has a controlling terminal
# depends on how it's invoked (headless agent shell vs. an interactive dev
# terminal), so assert the function completes cleanly with a valid boolean
# rather than a specific value.
source "$LIB"
has_controlling_terminal; HCT_RC=$?
check "has_controlling_terminal returns 0 or 1, doesn't hang" \
  "$([[ $HCT_RC -eq 0 || $HCT_RC -eq 1 ]] && echo ok)" "ok"

echo "real pre-push hook end-to-end"

# Drives the real scripts/hooks/pre-push (symlinked, matching how
# `emit-infra hooks install` wires it into every project) rather than a fake
# stub, so the gate's *placement* — after the ignored-paths filter, before
# the ERR trap/deploy_init that would otherwise write a status record — is
# under test, not just the detection functions above. Every case below either
# short-circuits before GHCR/docker (dry-run, ignored-paths) or is blocked by
# the new gate itself (env marker set): neither path reaches real deploy
# machinery, so no image build, GHCR auth, or `emit-infra deploy` ever runs.
GATE_WORK=$(mktemp -d)
trap 'rm -rf "$GATE_WORK"' EXIT
GATE_REMOTE="$GATE_WORK/remote.git"
GATE_REPO="$GATE_WORK/repo"
git init -q --bare "$GATE_REMOTE"
git init -q "$GATE_REPO"
(
  cd "$GATE_REPO"
  git config user.email t@t.t && git config user.name t
  cat > .emit-infra.json <<'JSON'
{"name":"gate-test","ci":{"ghcrOrg":"dummy-org","prePush":[]}}
JSON
  # Real wired projects gitignore every machine-written status/log path;
  # without that, an untracked one (e.g. .ci-logs/, written by the CI phase
  # any of these pushes runs) would ride along in the "sprint-note" commit's
  # `git add -A` below and defeat the ignored-paths-gate regression case.
  printf '.deploy-status.json\n.deploy-history.jsonl\n.ci-status.json\n.ci-history.jsonl\n.ci-logs/\n.deploy-logs/\n' > .gitignore
  mkdir -p .githooks
  ln -s "$EMIT_INFRA_ROOT/scripts/hooks/pre-push" .githooks/pre-push
  # Committed as part of "base", not left untracked — an untracked hook
  # symlink would otherwise ride along in the "sprint-note" commit's
  # `git add -A` below and defeat the same regression case.
  git add -A && git commit -qm base
  git config core.hooksPath .githooks
  git remote add origin "$GATE_REMOTE"
) >/dev/null 2>&1

_gate_push() {
  # $1.. = NAME=VAL env pairs for the push; git args come after `--`.
  local -a envs=()
  while [[ "$1" != "--" ]]; do envs+=("$1"); shift; done
  shift
  ( cd "$GATE_REPO" && env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CI \
      -u EMIT_ALLOW_UNATTENDED_DEPLOY -u EMIT_FORCE_DEPLOY \
      EMIT_INFRA_DIR="$EMIT_INFRA_ROOT" "${envs[@]}" git push origin "$@" 2>&1 )
}

BLOCK_CLAUDECODE_OUT=$(_gate_push CLAUDECODE=1 -- HEAD:refs/heads/main)
BLOCK_CLAUDECODE_RC=$?
check "push blocked (non-zero exit) when CLAUDECODE=1" \
  "$([[ $BLOCK_CLAUDECODE_RC -ne 0 ]] && echo blocked)" "blocked"
case "$BLOCK_CLAUDECODE_OUT" in
  *"EMIT_ALLOW_UNATTENDED_DEPLOY"*) ok "block message names the override env var" ;;
  *) no "block message names the override env var (got: $BLOCK_CLAUDECODE_OUT)" ;;
esac
check_false ".deploy-status.json created on blocked push" test -e "$GATE_REPO/.deploy-status.json"
check_false ".deploy-history.jsonl created on blocked push" test -e "$GATE_REPO/.deploy-history.jsonl"
check "CI phase still completes on a blocked deploy push" \
  "$(python3 -c "import json; print(json.load(open('$GATE_REPO/.ci-status.json'))['status'])" 2>/dev/null)" \
  "success"

BLOCK_CI_OUT=$(_gate_push CI=1 -- HEAD:refs/heads/main)
BLOCK_CI_RC=$?
check "push blocked (non-zero exit) when CI=1" \
  "$([[ $BLOCK_CI_RC -ne 0 ]] && echo blocked)" "blocked"

BLOCK_FORCE_OUT=$(_gate_push CLAUDECODE=1 EMIT_FORCE_DEPLOY=1 -- HEAD:refs/heads/main)
BLOCK_FORCE_RC=$?
check "EMIT_FORCE_DEPLOY=1 alone does not bypass the gate" \
  "$([[ $BLOCK_FORCE_RC -ne 0 ]] && echo blocked)" "blocked"

# ordering regression (task 8): earlier exit-0 gates must still short-circuit
# before this one, even with an env marker set.
DRYRUN_OUT=$(_gate_push CLAUDECODE=1 -- --dry-run HEAD:refs/heads/main)
DRYRUN_RC=$?
check "dry-run push exits 0 even with CLAUDECODE=1 (short-circuits before gate)" "$DRYRUN_RC" "0"
case "$DRYRUN_OUT" in
  *"EMIT_ALLOW_UNATTENDED_DEPLOY"*) no "dry-run push reached the unattended-shell gate" ;;
  *) ok "dry-run push did not reach the unattended-shell gate" ;;
esac

LAST_DEPLOYED_SHA=$(cd "$GATE_REPO" && git rev-parse HEAD)
printf '{"status":"deployed","sha":"%s"}\n' "$LAST_DEPLOYED_SHA" > "$GATE_REPO/.deploy-status.json"
( cd "$GATE_REPO" && mkdir -p sprint && echo x > sprint/note.md && git add -A && git commit -qm sprint-note )
IGNORED_OUT=$(_gate_push CLAUDECODE=1 -- HEAD:refs/heads/main)
IGNORED_RC=$?
check "ignored-paths-only push exits 0 even with CLAUDECODE=1" "$IGNORED_RC" "0"
case "$IGNORED_OUT" in
  *"EMIT_ALLOW_UNATTENDED_DEPLOY"*) no "ignored-paths push reached the unattended-shell gate" ;;
  *) ok "ignored-paths push did not reach the unattended-shell gate" ;;
esac

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
