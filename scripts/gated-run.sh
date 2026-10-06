#!/usr/bin/env bash
# gated-run.sh — run a heavy verification command (test suite, build,
# `nx affected`, typecheck of a whole workspace) inside a machine-wide
# "suite" slot: the same budget check-all.sh queues on, so projects whose
# verify step doesn't go through check-all.sh still take turns instead of
# stacking. Born 2026-10-02: 8-10 sprint loops verifying at once pushed load
# past 3×cores and the loops quit with `machine_busy`.
#
# Usage:
#   scripts/gated-run.sh <command...>
#   scripts/gated-run.sh "pnpm test && pnpm typecheck"
#
# The command runs via `bash -c "$*"`, so a quoted compound command works.
# Exits with the command's exit code. Never blocks healthy work for good: no
# slot within GATED_RUN_TIMEOUT (900s) → runs anyway with a note. Missing gate
# script → runs ungated. Nested calls (and check-all.sh under this wrapper)
# see RESOURCE_GATE_SUITE_HELD and don't queue for a second slot.
set -uo pipefail

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GATE="${GATED_RUN_GATE:-$SELF_DIR/resource-gate.sh}"
SUITE_SLOTS="${CHECK_ALL_SUITE_SLOTS:-3}"
TIMEOUT="${GATED_RUN_TIMEOUT:-900}"

if [[ $# -eq 0 ]]; then
  sed -n '2,17p' "${BASH_SOURCE[0]}" >&2
  exit 2
fi

export VITEST_MAX_WORKERS="${VITEST_MAX_WORKERS:-3}"

SLOT=""
release_slot() {
  [[ -n "$SLOT" ]] && GATE_OWNER_PID=$$ "$GATE" release "$SLOT" >/dev/null 2>&1
  SLOT=""
}
trap release_slot EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ -z "${RESOURCE_GATE_SUITE_HELD:-}" && -x "$GATE" ]]; then
  echo "gated-run: queuing for a suite slot ($SUITE_SLOTS machine-wide)…" >&2
  if SLOT=$(GATE_OWNER_PID=$$ "$GATE" acquire suite --slots "$SUITE_SLOTS" --timeout "$TIMEOUT" 2>/dev/null); then
    echo "gated-run: got $(basename "$SLOT")" >&2
  else
    SLOT=""
    echo "gated-run: no suite slot after ${TIMEOUT}s — proceeding without one" >&2
  fi
fi

RESOURCE_GATE_SUITE_HELD=1 bash -c "$*"
