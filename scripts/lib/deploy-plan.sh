# deploy-plan.sh — entry point for the shared pre-push deploy phase's decision
# logic. Sources the split-out clusters below and keeps the two build-execution
# helpers that don't obviously belong to any of them.
#
#   run_build_fanout <max_parallel> <on_fail> <svc...>  -> builds services in parallel
#   push_payload_summary <remote_sha> <local_sha>       -> echoes a "shipping N commits" line
#
# See deploy-path-filter.sh, deploy-smart-build.sh, and deploy-launch.sh for
# the rest of the functions historically documented here (split in sprint 300;
# every consumer that used to source this file alone still gets all of them
# transitively).

[[ -n "${_EMIT_DEPLOY_PLAN_LOADED:-}" ]] && return 0
_EMIT_DEPLOY_PLAN_LOADED=1

_EMIT_DEPLOY_PLAN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$_EMIT_DEPLOY_PLAN_DIR/deploy-path-filter.sh"
source "$_EMIT_DEPLOY_PLAN_DIR/deploy-smart-build.sh"
source "$_EMIT_DEPLOY_PLAN_DIR/deploy-launch.sh"

# ── sprint 339: count real build units, including variants ───────────────────
# A service with a tagged build variant (docker-build.sh's BUILD_VARIANTS_JSON,
# e.g. tastease's api -> api-migrate) is really two units of work sharing one
# service name. Counting only services under-reports the denominator a
# progress display needs ("4 images" reading as 4 services when it's 3
# services + 1 variant). BUILD_VARIANTS_JSON is set by pre-push-config.sh;
# default to an empty map so this stays callable standalone (e.g. tests).
_deploy_plan_variant_count() {
  local svc="$1" vj="${BUILD_VARIANTS_JSON:-}"
  [[ -z "$vj" ]] && vj='{}'
  python3 -c "
import json
variants = json.loads('$vj')
print(len(variants.get('$svc', [])))
" 2>/dev/null || echo 0
}

_deploy_plan_unit_count() {
  local total=0 svc
  for svc in "$@"; do
    total=$((total + 1 + $(_deploy_plan_variant_count "$svc")))
  done
  echo "$total"
}

# ── fix 5: build-fan-out failures must always reach on_fail ──────────────────
# `wait "$pid" || exit 1` used to guard the build loop, relying on the ERR
# trap to run `deploy_done failed` on the way out. It doesn't: `wait` sits on
# the left of `||` so its failure never fires the trap, and the explicit
# `exit` that follows doesn't fire it either — a failed backgrounded build
# left .deploy-status.json stuck at "deploying" forever (sprint 267). Calling
# on_fail directly removes the dependency on trap semantics entirely.
#
# Progress (sprint 339) is emitted here, from the main loop, rather than from
# inside build_image: build_image runs backgrounded, so with
# EMIT_BUILD_PARALLEL>1 several copies could be writing "current image"
# concurrently with no ordering. Emitting once per service as it's *started*,
# from the one process driving the loop, gives a position that's accurate for
# both sequential and parallel fan-out. deploy_image_progress is optional
# (guarded, not sourced by this file) so this stays callable without
# ci-utils.sh, e.g. in tests that stub build_image directly.
run_build_fanout() {
  local max_parallel="$1" on_fail="$2"; shift 2
  local pids=() pid svc
  local total_units done_units=0
  total_units=$(_deploy_plan_unit_count "$@")
  for svc in "$@"; do
    if declare -F deploy_image_progress >/dev/null; then
      deploy_image_progress "$svc" "$((done_units + 1))" "$total_units" building
    fi
    build_image "$svc" &
    pids+=($!)
    done_units=$((done_units + 1 + $(_deploy_plan_variant_count "$svc")))
    if [[ ${#pids[@]} -ge $max_parallel ]]; then
      for pid in "${pids[@]}"; do wait "$pid" || "$on_fail"; done
      pids=()
    fi
  done
  for pid in ${pids[@]+"${pids[@]}"}; do wait "$pid" || "$on_fail"; done
}

# ── fix 6: surface what a push to main is about to ship ──────────────────────
# A month-old local commit rode along silently in a "safe" test push
# (develemail, sprint 252 near-miss). Print commit count + oldest commit's
# age/subject from the range git already handed the hook on stdin —
# informational only, never gates or prompts.
push_payload_summary() {
  local remote_sha="$1" local_sha="$2"
  # git's pre-push protocol sends 40 zeros for "no such ref on the remote yet"
  # (new branch). `git rev-parse --verify` treats that as syntactically valid
  # and echoes it straight back rather than failing, so it needs its own check.
  if [[ -z "$remote_sha" ]] || [[ "$remote_sha" =~ ^0+$ ]] || \
     ! git rev-parse --quiet --verify "$remote_sha" >/dev/null 2>&1; then
    echo "→ shipping ${local_sha:0:7} (new branch; no remote history to compare)"
    return 0
  fi
  local count oldest
  count=$(git rev-list --count "$remote_sha..$local_sha")
  # `git log --reverse` buffers the whole range before emitting, so piping it
  # into `head -1` closes the pipe while git is still writing — SIGPIPE, exit
  # 141, and with pipefail that fails the whole pre-push hook. It only bites on
  # large pushes (reproduced at 98 commits, clean at 2), which is why it sat
  # latent. Dropping --reverse and taking the last line is the same commit.
  oldest=$(git log --format='%ar — %s' "$remote_sha..$local_sha" | tail -1)
  echo "→ shipping $count commit(s); oldest: $oldest"
}
