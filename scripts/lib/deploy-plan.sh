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

# ── fix 5: build-fan-out failures must always reach on_fail ──────────────────
# `wait "$pid" || exit 1` used to guard the build loop, relying on the ERR
# trap to run `deploy_done failed` on the way out. It doesn't: `wait` sits on
# the left of `||` so its failure never fires the trap, and the explicit
# `exit` that follows doesn't fire it either — a failed backgrounded build
# left .deploy-status.json stuck at "deploying" forever (sprint 267). Calling
# on_fail directly removes the dependency on trap semantics entirely.
run_build_fanout() {
  local max_parallel="$1" on_fail="$2"; shift 2
  local pids=() pid svc
  for svc in "$@"; do
    build_image "$svc" &
    pids+=($!)
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
