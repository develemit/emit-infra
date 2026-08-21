#!/usr/bin/env bash
# Regression tests for sprint 292: only_ignored_paths_changed used to pipe
# `git diff --name-only | grep -q .`, which killed git with SIGPIPE (exit
# 141) on large output. Under `set -o pipefail` (real pre-push semantics)
# that read as "only ignored paths changed" and silently skipped the deploy
# — more likely the *bigger* the push was. See scripts/lib/deploy-plan.test.sh
# for the function's non-pipefail-specific behavior; these tests exist to run
# under real pipefail, which is the only context the bug appeared in.
# Run: bash scripts/lib/deploy-path-filter.test.sh
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

cd "$WORK"
git init -q .
git config user.email t@t.t && git config user.name t
mkdir -p apps/web sprint docs
echo a > apps/web/index.ts && echo a > sprint/1.md && echo a > docs/d.md
git add -A && git commit -qm base
BASE=$(git rev-parse HEAD)
DEFAULTS=("${EMIT_DEFAULT_DEPLOY_IGNORE_PATHS[@]}")

# ── the incident: a diff that exceeds the OS pipe buffer must still deploy ────
# Generate an all-app-code range whose `git diff --name-only` output is
# comfortably over both macOS's (~16KB) and Linux's (~64KB) default pipe
# buffer, so the test is platform-independent. Empty files keep this fast.
echo "SIGPIPE-under-pipefail regression (the 2026-08-21 incident)"

mkdir -p apps/web/generated
for i in $(seq 1 3000); do
  : > "apps/web/generated/file-$(printf '%05d' "$i")-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.ts"
done
git add -A && git commit -qm big-app-change
BIG_BYTES=$(git diff --name-only "$BASE"..HEAD | wc -c | tr -d ' ')
echo "  (diff size: ${BIG_BYTES} bytes)"
[[ "$BIG_BYTES" -gt 65536 ]] || { no "fixture diff is big enough to exceed any default pipe buffer"; }

# Must run in a fresh `bash -c` with `set -o pipefail` actually active — the
# bug only reproduces under real pipefail semantics, which this test file's
# own `set -uo pipefail` above (no `-e`) does not exercise the same way
# scripts/hooks/pre-push (set -euo pipefail) does.
check_false "16KB+ diff deploys (not skips) under real pipefail" \
  bash -c 'cd "$1" && set -euo pipefail && source "$2" && only_ignored_paths_changed "$3" "${@:4}"' \
  bash "$WORK" "$LIB" "$BASE" "${DEFAULTS[@]}"

git reset -q --hard "$BASE"
rm -rf apps/web/generated

# ── diff failure must deploy, never skip ──────────────────────────────────────
echo "git diff failure"

SHIM=$(mktemp -d)
GIT_REAL=$(command -v git)
cat > "$SHIM/git" <<EOF
#!/usr/bin/env bash
if [[ "\$1" == "diff" ]]; then
  echo "fake git diff failure" >&2
  exit 128
fi
exec "$GIT_REAL" "\$@"
EOF
chmod +x "$SHIM/git"
check_false "git diff error inside the filter still deploys (never skips)" \
  bash -c 'PATH="$1:$PATH"; cd "$2" && set -euo pipefail && source "$3" && only_ignored_paths_changed "$4" "${@:5}"' \
  bash "$SHIM" "$WORK" "$LIB" "$BASE" "${DEFAULTS[@]}"
rm -rf "$SHIM"

# ── empty/whitespace pattern can't silently become "exclude everything" ──────
# `:(exclude,glob)` with nothing after it is not a no-op: git treats the empty
# glob as matching every path, so this is a real hazard, not just cheap
# defense-in-depth.
echo "empty spec element"

check "deploy_ignore_specs drops a blank pattern" \
  "$(deploy_ignore_specs '' '  ' 'docs/**')" ':(exclude,glob)docs/**'
echo b > apps/web/index.ts && git add -A && git commit -qm code-change
check_false "blank pattern among real patterns doesn't mask a real code change" \
  only_ignored_paths_changed "$BASE" "" "  " "${DEFAULTS[@]}"
git reset -q --hard "$BASE"

# ── positive controls under real pipefail (the optimization still works) ─────
echo "positive controls (under real pipefail, small diffs)"

echo b > docs/d2.md && git add -A && git commit -qm docs-only
check_true "docs-only range still skips under real pipefail" \
  bash -c 'cd "$1" && set -euo pipefail && source "$2" && only_ignored_paths_changed "$3" "${@:4}"' \
  bash "$WORK" "$LIB" "$BASE" "${DEFAULTS[@]}"

git reset -q --hard "$BASE"
echo b > apps/web/index.ts && git add -A && git commit -qm app-code
check_false "apps/-touching range always deploys under real pipefail" \
  bash -c 'cd "$1" && set -euo pipefail && source "$2" && only_ignored_paths_changed "$3" "${@:4}"' \
  bash "$WORK" "$LIB" "$BASE" "${DEFAULTS[@]}"

# ── code shape: no pipe into grep ─────────────────────────────────────────────
echo "code shape"

FN_BODY=$(awk '/^only_ignored_paths_changed\(\)/{flag=1} flag{print} /^}/{if(flag){exit}}' "$LIB")
case "$FN_BODY" in
  *'| grep'*) no "only_ignored_paths_changed contains no pipe into grep (found one)" ;;
  *) ok "only_ignored_paths_changed contains no pipe into grep" ;;
esac

echo
echo "$PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
