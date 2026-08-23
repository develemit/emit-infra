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

## Acceptance criteria — transferred to sprints 300, 301, 302

This sprint produced the sequenced breakdown its Task 1 called for; the actual
extraction happens in the child sprints. Every criterion below was verified as
carried by a child sprint before this file was closed, most with tighter
thresholds than stated here. They are listed as plain bullets, not checkboxes,
because they are not this sprint's to satisfy.

- Every touched file under ~300 lines → 300 (~300), 301 (~250), 302 (~250 for
  `pre-push`, ~150 per extracted file)
- `pnpm test:hooks` green under bash 3.2 with no reduction in assertion count →
  all three
- `bash -n` clean on every touched script → all three
- `pre-push` gate ordering invariant verified, inline comments preserved → 302
- One real push on a wired project, **or** explicit deferral to the next natural
  deploy → 302 (carries the deferral clause verbatim, so it does not stall a
  headless run — see sprint 282)

## Out of scope
- Changing any behavior. This is a pure module reorganization; behavior changes
  belong in their own sprints.
- `docs/DEPLOY-FLOOR.md`, held deliberately as a chronological log.
- `docs/PRE-PUSH-HOOK.md`, which sprint 294 covers.

## Completed — superseded by sprints 300, 301, 302

This sprint is closed as **superseded**, not as work done. Its Task 1 was "run
`/plan-sprint` first and break this into a sequence", and that is what it
delivered:

| child sprint | file | why it is separate |
|---|---|---|
| `300-split-deploy-plan-sh` | `scripts/lib/deploy-plan.sh` (329) | no shared mutable state between clusters — mechanical, lowest risk, run first |
| `301-split-ci-utils-sh` | `scripts/lib/ci-utils.sh` (368) | shared `_EMIT_*` state across writers, heartbeat and signal handlers — the hard one |
| `302-split-pre-push-hook` | `scripts/hooks/pre-push` (307) | fleet blast radius; gate-ordering invariant stays inline and untouched |

**Authoring note for future sprints:** Task 1 here said "Run `/plan-sprint`
first", but that skill requires interactive confirmation before writing files
and so cannot run in a headless `/start-sprint` session. The executing child
correctly recognised this, produced the equivalent breakdown directly, and
declined to attempt the three-file extraction in one pass. Do not put an
interactive-only command in a sprint task — it is the same class of mistake as
making a live production push a blocking acceptance criterion (sprints 282,
288).

## Progress (2026-08-23)

### Done so far
- Completed Task 1 as written: broke this sprint into a sequenced plan rather
  than attempting all three files in one session. Wrote three self-contained
  child sprints to `sprint/`, each scoped to one file, lowest-risk first:
  - `sprint/300-split-deploy-plan-sh.md` — `scripts/lib/deploy-plan.sh` (no
    shared mutable state between clusters; mechanical extraction)
  - `sprint/301-split-ci-utils-sh.md` — `scripts/lib/ci-utils.sh` (shared
    `_EMIT_*` module state across writers/heartbeat/signals — the hard part
    this sprint's own Context section flagged)
  - `sprint/302-split-pre-push-hook.md` — `scripts/hooks/pre-push`, extracting
    only the config-loading and CI-phase clusters; the deploy-gate ordering
    invariant stays inline and untouched, per this sprint's explicit warning
    about fleet blast radius
- Confirmed current line counts match this sprint's table (368/329/307) and
  read all three files plus their six consuming test suites to ground each
  child sprint's Context section in the actual current code, not just the
  cluster hints this sprint's Context section sketched.
- Did **not** attempt any of Tasks 2-5 (the actual extraction) in this
  session — this sprint's own Context section explicitly warns "a single
  session that tries to do all three files at once is how the fleet's push
  path gets broken," and `/plan-sprint`'s normal flow requires interactive
  user confirmation before writing files, which an autonomous `/start-sprint`
  run can't provide. Producing the breakdown directly (matching
  `/plan-sprint`'s file format and using the seams this sprint's Context
  section already specified) was the closest headless-safe equivalent.

### Blocked on
- Nothing technical — sprints 300/301/302 are ready to run. This sprint's own
  acceptance criteria (actual line-count reduction, `pnpm test:hooks` green,
  gate-ordering verification) can only be satisfied by executing those three
  child sprints, so none of the checkboxes above are met yet.

### Pickup notes
- Run `/start-sprint` three more times to work through 300 → 301 → 302 in
  order (300 has no dependency on this one beyond context; 301 and 302 each
  declare a dependency on the prior sprint landing first).
- Once all three are complete, come back to this sprint file and either (a)
  check off its acceptance criteria referencing the child sprints' commits,
  or (b) treat this file as superseded by 300/301/302 and close it with a
  short pointer — whichever the user prefers when reviewing this pass.
- The user should review `sprint/300-*.md`, `sprint/301-*.md`, and
  `sprint/302-*.md` before running them — they're new, uncommitted files.
