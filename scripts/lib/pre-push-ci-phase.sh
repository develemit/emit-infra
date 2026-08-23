# pre-push-ci-phase.sh — runs the pre-push hook's CI phase (phase 1, before
# any deploy gate).
#
# run_ci is self-contained: it installs its own ERR trap and un-traps on
# success, so it can run before the main-branch check and every deploy gate
# without touching that sequence's ordering invariant (see
# scripts/hooks/pre-push). It reads CI_TARGETS and SHA from the caller's
# scope (set by pre-push-config.sh / pre-push itself) and calls
# ci_init/ci_step/ci_done/_emit_trap_signals/_emit_untrap_signals from
# ci-utils.sh.

[[ -n "${_EMIT_PRE_PUSH_CI_PHASE_LOADED:-}" ]] && return 0
_EMIT_PRE_PUSH_CI_PHASE_LOADED=1

run_ci() {
  trap 'ci_done failure; echo "✗ CI failed"; exit 1' ERR

  local target_count
  target_count=$(echo "$CI_TARGETS" | wc -w | tr -d ' ')
  ci_init "$target_count"
  _emit_trap_signals ci

  for target in $CI_TARGETS; do
    ci_step "$target"
    echo "→ $target"
    if [[ "$target" == "format" ]]; then
      # Formatting is a whole-repo prettier check, not a per-project nx
      # target — `nx affected -t format` finds no matching projects and
      # silently no-ops (confirmed empirically: exits 0, "No tasks were
      # run"), including for root-level files like README.md that don't
      # belong to any nx project. Run the root script directly instead.
      pnpm format
    else
      pnpm nx affected -t "$target" --base=origin/main
    fi
  done

  ci_done success
  echo "✓ CI passed ($SHA)"
  trap - ERR
  _emit_untrap_signals
}
