#!/usr/bin/env bash
# Tests for scripts/lib/image-arch-check.sh. Run: bash scripts/lib/image-arch-check.test.sh
set -uo pipefail

LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$LIB_DIR/docker-build.sh"
source "$LIB_DIR/image-arch-check.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }
check_contains() { if [[ "$2" == *"$3"* ]]; then ok "$1"; else no "$1 ('$3' not in '$2')"; fi; }
check_not_contains() { if [[ "$2" != *"$3"* ]]; then ok "$1"; else no "$1 ('$3' unexpectedly in '$2')"; fi; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
CALL_LOG="$WORK/calls.log"
reset_calls() { : > "$CALL_LOG"; }

# Mock docker. `run` ignores its own exit code upstream (`|| true`), so its
# only job is stdout content; `image inspect` / `pull` report success only
# for refs the test names in INSPECT_OK_REFS / PULL_OK_REFS.
INSPECT_OK_REFS=""
PULL_OK_REFS=""
docker() {
  echo "docker $*" >> "$CALL_LOG"
  local args=("$@")
  case "${args[0]}" in
    image)
      local ref="${args[2]}"
      case " $INSPECT_OK_REFS " in *" $ref "*) return 0 ;; *) return 1 ;; esac
      ;;
    pull)
      local ref="${args[$((${#args[@]} - 1))]}"
      case " $PULL_OK_REFS " in *" $ref "*) return 0 ;; *) return 1 ;; esac
      ;;
    run)
      local i image="" cmd=""
      for ((i = 0; i < ${#args[@]}; i++)); do
        if [[ "${args[$i]}" == "-c" ]]; then
          image="${args[$((i - 1))]}"
          cmd="${args[$((i + 1))]}"
          break
        fi
      done
      # The dangling-symlink reality: a presence check (`ls .pnpm | grep`)
      # reports the slot as present regardless of whether the module the
      # symlink points at actually loads — exactly the bug that shipped
      # tastease build 1247. This must never emit a sentinel "ok" line.
      if [[ "$cmd" == *'grep -q linux-x64'* ]]; then
        echo "PRESENT"
      elif [[ "$image" == *good* ]]; then
        echo "ok $image module loaded"
      elif [[ "$image" == *broken* ]]; then
        echo 'Could not load the "@esbuild/linux-x64" package. It seems that this package needs the "@esbuild/linux-x64" package instead.'
      else
        echo "ok"
      fi
      return 0
      ;;
    *) return 0 ;;
  esac
}

GHCR_ORG="test"
GHCR_REPO=""
IMAGE_PREFIX=""
BUILD_NUMBER=42

echo "no-op fast path"

IMAGE_ARCH_PROBES_JSON="{}"
reset_calls
OUT=$(run_image_arch_checks web api); RC=$?
check "empty probes: exit 0" "$RC" "0"
check "empty probes: no docker commands invoked" "$(cat "$CALL_LOG")" ""
check_contains "empty probes: says skipping" "$OUT" "skipping"

IMAGE_ARCH_PROBES_JSON='{"other-svc":[{"kind":"tsx"}]}'
reset_calls
OUT=$(run_image_arch_checks web api); RC=$?
check "probes exist but not for built services: exit 0" "$RC" "0"
check "probes exist but not for built services: no docker commands" "$(cat "$CALL_LOG")" ""

echo "image_arch_check_has_any"

IMAGE_ARCH_PROBES_JSON='{"x":[{"kind":"tsx"}]}'
check_false() { if "$@"; then no "$1 (expected false)"; else ok "expected false: $*"; fi; }
check_true() { if "$@"; then ok "expected true: $*"; else no "$1 (expected true)"; fi; }
check_true image_arch_check_has_any x y
check_false image_arch_check_has_any y z

echo "passing tsx probe (build variant tag suffix)"

IMAGE_ARCH_PROBES_JSON='{"api":[{"kind":"tsx","variant":"-migrate"}]}'
GHCR_ORG="good"
INSPECT_OK_REFS="ghcr.io/good/api:42-migrate"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "passing probe: exit 0" "$RC" "0"
check_contains "passing probe: names the image+tag suffix" "$OUT" "ghcr.io/good/api:42-migrate"
check_contains "passing probe: shows success mark" "$OUT" "✓"
check_not_contains "passing probe: resolved locally, no pull" "$(cat "$CALL_LOG")" "pull"

echo "failing tsx probe — the dangling-symlink regression"

GHCR_ORG="broken"
INSPECT_OK_REFS="ghcr.io/broken/api:42-migrate"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "failing probe: nonzero exit" "$RC" "1"
check_contains "failing probe: names the image" "$OUT" "ghcr.io/broken/api:42-migrate"
check_contains "failing probe: names the probe kind" "$OUT" "tsx"
check_contains "failing probe: shows the module's own error" "$OUT" "needs the"

# The regression this sprint exists for: a presence-style check on the exact
# same broken image reports the module as present (dangling symlink), where
# the load-based probe above correctly failed.
PRESENCE_OUT=$(docker run --rm --platform linux/amd64 --entrypoint sh \
  "ghcr.io/broken/api:42-migrate" -c "ls node_modules/.pnpm | grep -q linux-x64 && echo PRESENT")
check "regression proof: presence check wrongly reports the module present" "$PRESENCE_OUT" "PRESENT"

echo "passing next-sharp probe"

IMAGE_ARCH_PROBES_JSON='{"web":[{"kind":"next-sharp"}]}'
GHCR_ORG="good"
INSPECT_OK_REFS="ghcr.io/good/web:42"
reset_calls
OUT=$(run_image_arch_checks web); RC=$?
check "next-sharp: exit 0" "$RC" "0"
check_contains "next-sharp: names the kind" "$OUT" "next-sharp"

echo "sharp probe (diner-decider: required directly, not via next)"

IMAGE_ARCH_PROBES_JSON='{"api":[{"kind":"sharp"}]}'
GHCR_ORG="good"
INSPECT_OK_REFS="ghcr.io/good/api:42"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "sharp: exit 0 on good image" "$RC" "0"
check_contains "sharp: names the kind" "$OUT" "sharp"

GHCR_ORG="broken"
INSPECT_OK_REFS="ghcr.io/broken/api:42"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "sharp: nonzero exit on broken image" "$RC" "1"
check_contains "sharp: shows the module's own error" "$OUT" "Could not load"

echo "prisma probe (martialops api: dlopen the query engine directly, no DB needed)"

IMAGE_ARCH_PROBES_JSON='{"api":[{"kind":"prisma"}]}'
GHCR_ORG="good"
INSPECT_OK_REFS="ghcr.io/good/api:42"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "prisma: exit 0 on good image" "$RC" "0"
check_contains "prisma: names the kind" "$OUT" "prisma"

GHCR_ORG="broken"
INSPECT_OK_REFS="ghcr.io/broken/api:42"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "prisma: nonzero exit on broken image" "$RC" "1"
check_contains "prisma: shows the module's own error" "$OUT" "needs the"

echo "drizzle-kit probe (develemail migrate: --version doesn't exercise esbuild, transformSync does)"

IMAGE_ARCH_PROBES_JSON='{"api":[{"kind":"drizzle-kit","variant":"-migrate"}]}'
GHCR_ORG="good"
INSPECT_OK_REFS="ghcr.io/good/api:42-migrate"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "drizzle-kit: exit 0 on good image" "$RC" "0"
check_contains "drizzle-kit: names the tag suffix" "$OUT" "ghcr.io/good/api:42-migrate"
check_contains "drizzle-kit: names the kind" "$OUT" "drizzle-kit"

GHCR_ORG="broken"
INSPECT_OK_REFS="ghcr.io/broken/api:42-migrate"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "drizzle-kit: nonzero exit on broken image" "$RC" "1"
check_contains "drizzle-kit: shows the module's own error" "$OUT" "needs the"

echo "unknown probe kind"

IMAGE_ARCH_PROBES_JSON='{"weird":[{"kind":"bogus"}]}'
GHCR_ORG="good"
INSPECT_OK_REFS="ghcr.io/good/weird:42"
OUT=$(run_image_arch_checks weird); RC=$?
check "unknown kind: nonzero exit" "$RC" "1"
check_contains "unknown kind: names the bad kind" "$OUT" "unknown probe kind 'bogus'"

echo "image resolution fallback: local miss, registry pull hit"

IMAGE_ARCH_PROBES_JSON='{"api":[{"kind":"tsx"}]}'
GHCR_ORG="good"
INSPECT_OK_REFS=""
PULL_OK_REFS="ghcr.io/good/api:42"
reset_calls
OUT=$(run_image_arch_checks api); RC=$?
check "pull fallback: exit 0" "$RC" "0"
check_contains "pull fallback: pull was invoked" "$(cat "$CALL_LOG")" "pull"
check_contains "pull fallback: platform pinned explicitly" "$(cat "$CALL_LOG")" "--platform linux/amd64"

echo "image resolution total failure"

INSPECT_OK_REFS=""
PULL_OK_REFS=""
OUT=$(run_image_arch_checks api); RC=$?
check "resolution failure: nonzero exit" "$RC" "1"
check_contains "resolution failure: names the unresolved ref" "$OUT" "could not resolve"

echo
echo "image-arch-check: $PASS passed, $FAIL failed"
[[ $FAIL -eq 0 ]]
