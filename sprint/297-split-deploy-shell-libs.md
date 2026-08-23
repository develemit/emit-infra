# Split the oversized deploy shell libraries
**Difficulty:** 4

> _Promoted from backlog: sprint-290 and sprint-292 follow-ups, 2026-08-21._
> _This item may benefit from `/plan-sprint "split the deploy shell libraries"` to break it into a sequence before running._

## Goal
`scripts/lib/deploy-plan.sh`, `scripts/lib/ci-utils.sh`, and
`scripts/hooks/pre-push` are each under the ~300-line guideline, with sourcing
updated across every consumer and the full hook test suite still green.

## Reason
All three files are over the guideline and have grown steadily, sprint over
sprint:

| file | lines | guideline |
|---|---|---|
| `scripts/lib/ci-utils.sh` | 368 | ~300 |
| `scripts/lib/deploy-plan.sh` | 329 | ~300 |
| `scripts/hooks/pre-push` | 307 | ~300 |

Two sprints (290, 292) filed this and both declined to act, for good reasons
each time: the split touches sourcing in `pre-push`, `deploy-detached.sh`, and
several test files, and neither sprint's scope was a module reorg.

The cost is real. `pre-push` carries load-bearing line-ordering constraints
documented inline — the deploy gate must sit after the ignored-paths filter and
before `_fail_deploy` is defined — and that kind of constraint gets harder to
see, and easier to break, as the file grows. Sprint 292's silent-skip bug lived
in one of these files for months.

## Why this needs planning before execution
This is flagged difficulty 4 and carries fleet blast radius:

- `scripts/hooks/pre-push` is symlinked into **every wired project** via
  `core.hooksPath=.githooks` with **no version pinning**. A broken source path
  breaks every project's next push simultaneously.
- The load-bearing ordering in `pre-push` (gate after ignored-paths filter,
  before `_fail_deploy`/`deploy_init`) must survive the move. Getting this wrong
  reintroduces the exact bug sprints 282 and 288 fixed: a refusal that writes a
  status record, or an ERR trap firing with `_EMIT_STARTED_EPOCH` unset.
- `ci-utils.sh`'s ci/deploy functions are **tightly coupled through shared
  state** — writer liveness, the heartbeat refresher, signal handlers, and the
  finalize-once guards all read and write module-level `_EMIT_*` variables. A
  naive split by function name will break that coupling silently, because bash
  has no import errors: a missing variable is just empty under `set -u`... or
  worse, not empty.
- Six test suites source these files. Every one needs its sourcing updated.

Run `/plan-sprint` on this before executing. A single session that tries to do
all three files at once is how the fleet's push path gets broken.

## Context
- Suggested seam for `deploy-plan.sh` (from the sprint-292 follow-up): separate
  the **path-filter** helpers (`deploy_ignore_specs`,
  `only_ignored_paths_changed`) from the **smart-build** helpers
  (`nx_available`, `nx_projects`, `_list_has`, `_trigger_paths_changed`,
  `service_needs_build`). `resolve_last_deployed_sha` and
  `detect_dry_run_push`/`detect_unattended_shell` are a third cluster.
- `ci-utils.sh` clusters roughly as: log capture (`_emit_start_log`,
  `_emit_flush_log`, `_emit_rotate_logs`), atomic writes and history
  (`_emit_write_atomic`, `_emit_truncate_history`), phase tracking, the ci
  writers, the deploy writers, and the signal/heartbeat machinery. The shared
  `_EMIT_*` state is what makes this hard.
- Consumers to update: `scripts/hooks/pre-push`, `scripts/deploy-detached.sh`,
  and the suites `deploy-plan.test.sh`, `hook-signals.test.sh`,
  `deploy-liveness.test.sh`, `deploy-unattended-gate.test.sh`,
  `deploy-path-filter.test.sh`, `deploy-detached.test.sh`.
- Each lib already uses a `_LOADED` guard (e.g. `_EMIT_DEPLOY_PLAN_LOADED`) so
  double-sourcing is safe — keep that pattern in any new file.
- **Bash 3.2.57** is the target. No `declare -A`, no `${var^^}`.
- `docs/PRE-PUSH-HOOK.md` documents these internals; sprint 294 may be splitting
  that doc concurrently — check its state before editing.

## Tasks
1. **Run `/plan-sprint` first** and break this into a sequence — most likely one
   file per sprint, lowest-risk first (`deploy-plan.sh` before `ci-utils.sh`
   before `pre-push`).
2. For each file: identify clusters, extract to new `scripts/lib/*.sh` with the
   `_LOADED` guard, update every consumer's sourcing.
3. After each extraction, run `pnpm test:hooks` under `/bin/bash` (3.2) and
   `bash -n` on every touched script before moving to the next.
4. Preserve `pre-push`'s inline ordering comments verbatim when moving code —
   they are the only record of why the sequence matters.
5. Verify the gate ordering invariant explicitly after any `pre-push` change:
   ignored-paths filter → unattended gate → `_fail_deploy` definition →
   `deploy_init`.

## Files involved
- `scripts/lib/deploy-plan.sh`, `scripts/lib/ci-utils.sh`,
  `scripts/hooks/pre-push` — the files being split
- new files: `scripts/lib/*.sh` — one per extracted cluster
- `scripts/deploy-detached.sh` and the six test suites listed in Context —
  sourcing updates

## Acceptance criteria
- [ ] Every touched file is under ~300 lines, or the exception is justified inline
- [ ] `pnpm test:hooks` green under bash 3.2 with no reduction in assertion count
- [ ] `bash -n` clean on every touched script
- [ ] The `pre-push` gate ordering invariant is verified explicitly and the
      inline comments explaining it survived the move
- [ ] One real push on a wired project confirms the hook still works end to end,
      **or** that verification is explicitly deferred to the next natural deploy
      (do not make a live production push a blocking criterion — it stalls
      headless runs; see sprint 282)

## Out of scope
- Changing any behavior. This is a pure module reorganization; behavior changes
  belong in their own sprints.
- `docs/DEPLOY-FLOOR.md`, held deliberately as a chronological log.
- `docs/PRE-PUSH-HOOK.md`, which sprint 294 covers.
