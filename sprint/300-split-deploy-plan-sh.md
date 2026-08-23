# Split scripts/lib/deploy-plan.sh into focused modules
**Difficulty:** 3

> _Planned from sprint-297's Task 1 ("run /plan-sprint first"), 2026-08-23. First
> of a three-part sequence (300 → 301 → 302); lowest-risk file first._

## Goal
`scripts/lib/deploy-plan.sh` (329 lines) is split into 3-4 focused files under
`scripts/lib/`, each under ~200 lines, with every consumer's sourcing updated
and `pnpm test:hooks` still green under bash 3.2. No behavior changes.

## Reason
Sprint 297 identified `deploy-plan.sh` as one of three shell libs that have
grown past the ~300-line guideline. This is the lowest-risk of the three to
split: it's pure-ish decision logic (no shared mutable module state, no
signal/heartbeat coupling), so extraction is close to mechanical. Landing this
first also proves out the pattern (new lib file + `_LOADED` guard + sourcing
update + test) before the harder `ci-utils.sh` split in sprint 301.

## Context
Read the file first: `scripts/lib/deploy-plan.sh`. It has a `_EMIT_DEPLOY_PLAN_LOADED`
guard at the top (keep that pattern in whichever file becomes the "core" —
new extracted files need their own guards, e.g. `_EMIT_DEPLOY_PATH_FILTER_LOADED`).

Natural clusters (confirmed by reading the current file, 2026-08-23):
- **path-filter**: `deploy_ignore_specs`, `only_ignored_paths_changed`, and
  the `EMIT_DEFAULT_DEPLOY_IGNORE_PATHS` array. Has load-bearing comments
  about SIGPIPE/pipe-buffer hazards (sprint 292) — preserve verbatim.
- **smart-build**: `nx_available`, `nx_projects`, `_list_has`,
  `_trigger_paths_changed`, `service_needs_build`, and the
  `EMIT_DEFAULT_BUILD_TRIGGER_PATHS` array.
- **launch detection**: `resolve_last_deployed_sha`, `detect_dry_run_push`,
  `detect_unattended_shell`, `has_controlling_terminal`, `deploy_launch_mode`,
  `deploy_warn_deprecated_override`, and `EMIT_UNATTENDED_SHELL_MARKERS`. This
  cluster has the sprint-267/282/290 incident context in its comments —
  preserve verbatim.
- **build execution**: `run_build_fanout`, `push_payload_summary` — these
  don't obviously belong to any of the above three; either give them their
  own small file (e.g. `deploy-exec.sh`) or leave them as the remainder in
  `deploy-plan.sh` itself. Your call at execution time — whichever keeps every
  file coherent and under ~200 lines.

None of these clusters share mutable state — every function takes its inputs
as arguments and either echoes or returns a status. That's what makes this
split lower-risk than `ci-utils.sh`.

**Consumers to update:**
- `scripts/hooks/pre-push` — sources `deploy-plan.sh` directly (line ~20)
- `scripts/deploy-detached.sh` — check for direct or indirect sourcing
- `scripts/lib/deploy-plan.test.sh`, `scripts/lib/deploy-path-filter.test.sh`,
  `scripts/lib/deploy-unattended-gate.test.sh` — these source `deploy-plan.sh`
  (or the new split files) directly to test the functions in isolation; check
  each and update sourcing to match wherever functions land

**Bash 3.2.57 is the target.** No `declare -A`, no `${var^^}`.

## Tasks
1. Decide final file boundaries for the four clusters above (3-4 new files
   total, or 3 new + the original file as a thin remainder).
2. Extract each cluster to its own `scripts/lib/*.sh` file with a `_LOADED`
   guard following the existing pattern.
3. Update sourcing in every consumer listed in Context above.
4. Run `bash -n` on every touched script.
5. Run `pnpm test:hooks` under `/bin/bash` (3.2) — assertion count must not
   drop from its current value (check with a baseline run before you start).

## Files involved
- `scripts/lib/deploy-plan.sh` — split into focused modules (or reduced to a
  remainder file)
- new files: `scripts/lib/*.sh` — one per extracted cluster
- `scripts/hooks/pre-push`, `scripts/deploy-detached.sh` — sourcing updates
- `scripts/lib/deploy-plan.test.sh`, `scripts/lib/deploy-path-filter.test.sh`,
  `scripts/lib/deploy-unattended-gate.test.sh` — sourcing updates

## Acceptance criteria
- [ ] `scripts/lib/deploy-plan.sh` and every new extracted file are under
      ~200 lines (target) or ~300 (hard guideline)
- [ ] `pnpm test:hooks` passes under bash 3.2 with the same or higher
      assertion count as the pre-split baseline
- [ ] `bash -n` is clean on every touched script
- [ ] Every consumer (`pre-push`, `deploy-detached.sh`, the three test
      suites named above) sources the correct new file(s) and no longer
      references a moved function via a stale path

## Out of scope
- `scripts/lib/ci-utils.sh` and `scripts/hooks/pre-push` — sprints 301 and 302
- Any behavior change. This is a pure module reorganization.
