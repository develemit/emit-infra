#!/usr/bin/env bash
# check-all.sh — fleet-shared verification runner. One copy of the check:all
# pattern every repo used to fork into tools/check-all.sh, plus the two things
# the forks never had: a machine-wide concurrency budget and gate-slot
# queueing, so several projects can verify at once without stacking load.
#
# Usage (from a project's package.json shim):
#   check-all.sh [full|affected|e2e]
#
#   full      preflight -> format -> one `nx run-many` over the configured
#             targets (default). No e2e.
#   affected  same, but `nx affected --base=origin/main` — deliberately no
#             --head: verification runs before the sprint commit, and
#             --head=HEAD hides uncommitted work entirely (measured: a
#             one-package edit reports zero affected projects with it).
#             Falls back to full when origin/main is unresolvable.
#   e2e       full, then the e2e command serially afterwards holding an e2e
#             gate slot — e2e boots dev servers and loses races against the
#             other stages when they overlap (martialops learned this the
#             hard way; the serialization is kept fleet-wide).
#
# Concurrency budget (the overload fix, measured 2026-09-04 on a 16-core
# M4 Max: an uncapped suite alone peaked at 60.8-68.0 load1 — over the
# resource gate's 3x-cores critical line — and produced contention-timeout
# test failures; capped runs peaked at 0.95-1.6x with zero failures):
#   VITEST_MAX_WORKERS  exported (default 3) — vitest 4 reads it directly,
#                       overriding config, so no per-repo vitest changes.
#   nx --parallel       from ci.checkAll.parallel (default 2).
#   suite gate slot     at most CHECK_ALL_SUITE_SLOTS (3) projects run their
#                       heavy phase at once machine-wide; later arrivals queue.
#
# Per-repo config: .emit-infra.json ci.checkAll — see check-all-lib.sh.
set -euo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SELF_DIR/lib/check-all-lib.sh"

MODE="${1:-full}"
case "$MODE" in full|affected|e2e) ;; *)
  echo "check-all: unknown mode '$MODE' (expected full|affected|e2e)" >&2; exit 1 ;;
esac

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  echo "check-all: not inside a git repository" >&2; exit 1; }
cd "$ROOT"
CONFIG="$ROOT/.emit-infra.json"
[[ -f "$CONFIG" ]] || {
  echo "check-all: no .emit-infra.json in $ROOT — this runner is configured per-repo; see emit-infra/scripts/lib/check-all-lib.sh" >&2
  exit 1; }

TARGETS="$(_ca_targets "$CONFIG")"
PARALLEL="$(_ca_parallel "$CONFIG")"
EXCLUDE_ARGS="$(_ca_exclude_args "$CONFIG")"
FORMAT_CMD="$(_ca_format_cmd "$CONFIG")"
export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-3}"

GATE="$SELF_DIR/resource-gate.sh"
SUITE_SLOTS="${CHECK_ALL_SUITE_SLOTS:-3}"
SLOT=""
release_slot() {
  [[ -n "$SLOT" && -x "$GATE" ]] && GATE_OWNER_PID=$$ "$GATE" release "$SLOT" || true
  SLOT=""
}
trap release_slot EXIT

# Run a phase command, honoring the dry-run test seam.
run_cmd() {
  echo "→ $*"
  [[ "${CHECK_ALL_DRY_RUN:-0}" = "1" ]] && return 0
  bash -c "$*"
}

# Queue for a suite slot. Missing gate script (other machine) → skip silently.
# Timeout or critical → proceed with a note: the budget is politeness, and the
# gate must never turn a healthy verification into a blocked one.
acquire_slot() {
  local tag="$1" timeout="${2:-900}"
  [[ -x "$GATE" ]] || return 0
  # suite gets the budgeted slot count; other tags (e2e) keep the gate default.
  local slot_args=()
  [[ "$tag" == "suite" ]] && slot_args=(--slots "$SUITE_SLOTS")
  if SLOT=$(GATE_OWNER_PID=$$ "$GATE" acquire "$tag" ${slot_args[@]+"${slot_args[@]}"} --timeout "$timeout"); then
    return 0
  fi
  SLOT=""
  echo "check-all: no '$tag' slot after ${timeout}s — proceeding without one"
}

echo "check-all: mode=$MODE targets=[$TARGETS] parallel=$PARALLEL vitest_workers=$VITEST_MAX_WORKERS"

while IFS= read -r pre; do
  [[ -n "$pre" ]] && run_cmd "$pre"
done < <(_ca_preflight "$CONFIG")

[[ -n "$FORMAT_CMD" ]] && run_cmd "$FORMAT_CMD"

acquire_slot suite
NX_TARGETS="${TARGETS// /,}"
if [[ "$MODE" == "affected" ]] && git rev-parse --verify --quiet origin/main >/dev/null; then
  run_cmd "pnpm exec nx affected -t $NX_TARGETS --base=origin/main --parallel=$PARALLEL $EXCLUDE_ARGS --outputStyle=stream"
else
  [[ "$MODE" == "affected" ]] && echo "check-all: origin/main unresolvable — falling back to full run-many"
  run_cmd "pnpm exec nx run-many -t $NX_TARGETS --parallel=$PARALLEL $EXCLUDE_ARGS --outputStyle=stream"
fi
release_slot

if [[ "$MODE" == "e2e" ]]; then
  E2E_CMD="$(_ca_e2e_cmd "$CONFIG")"
  acquire_slot e2e
  run_cmd "$E2E_CMD"
  release_slot
fi

echo "✓ check-all ($MODE) passed"
