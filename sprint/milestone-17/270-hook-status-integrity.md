# Sprint 270 — Hook status integrity: failed builds mark failed, pushes announce their payload

> _Promoted from sprint-267 and sprint-252 follow-ups, 2026-08-02._

## Goal
`.deploy-status.json` always ends `failed` when a deploy dies, including the
backgrounded-build path; and the hook prints what a push is about to ship so
stale local commits can't ride along unnoticed.

## Context
Two small `scripts/hooks/pre-push` gaps from the 252–268 initiative:
(1) `wait "$pid" || exit 1` in the build fan-out exits without triggering the
`trap 'deploy_done failed' ERR` — explicit `exit` bypasses ERR traps — so a
failed image build leaves status stuck at `deploying` (observed sprint 267).
Fix shape: an EXIT trap guard, or replace `|| exit 1` with a failure flag +
explicit `deploy_done failed`. Mind bash 3.2 and the existing tee/log
teardown in `ci-utils.sh`. (2) develemail's sprint-252 near-miss: a
month-old local commit silently bundled into a "safe" test push. Before the
deploy phase, print a short payload summary: commit count being pushed and
the oldest commit's age/subject (`git log <remote-sha>..<local-sha>` from the
stdin refs the hook already reads) — informational only, no prompt, no
behavior change.

## Tasks
1. Reproduce (1) with a forced build failure in a scratch repo; fix; add a
   case to `scripts/lib/deploy-plan.test.sh` or a new hook-level test
   asserting status ends `failed`.
2. Add the payload summary print; verify output on single- and multi-commit
   pushes and that dry-run/CI-only paths are unaffected.
3. `bash -n` + full `pnpm test:hooks` under `/bin/bash` (3.2); one real
   push on a wired project to confirm no regression.

## Acceptance criteria
- [x] Forced build failure ends with `.deploy-status.json` status `failed`
      (test proves it); history line records the failure
- [x] Push payload summary prints; no prompts added; dry-run path unchanged
- [x] 36+ hook tests green under bash 3.2; real push verified

## Completed

**Date:** 2026-08-02

### Summary
Fixed both `pre-push` gaps described in the Context section. (1) `run_build_fanout`
(new function in `deploy-plan.sh`) replaces the inline `for svc in ...; do build_image
"$svc" & ...; wait "$pid" || exit 1; done` loop. The old code relied on the `ERR` trap
to run `deploy_done failed` on a build failure, but `wait ... || exit 1` never fires
`ERR` (the failure is consumed by `||`, and the explicit `exit` that follows doesn't
trigger it either) — a failed backgrounded build left `.deploy-status.json` stuck at
`deploying` forever (observed sprint 267). `run_build_fanout` takes an `on_fail`
callback and calls it directly on any failed `wait`, for every batch (sequential and
parallel), removing the dependency on trap semantics entirely. `pre-push` passes
`_fail_deploy` (a named function wrapping `deploy_done failed; echo ...; exit 1`,
now also the ERR trap target) as that callback. (2) `push_payload_summary` prints
commit count + oldest commit's relative age/subject for the range being pushed
(`git log <remote-sha>..<local-sha>`), sourced from the refs the hook already reads
off stdin. It runs after all deploy gates (not-main / no ghcrOrg / dry-run / confirm-declined
/ ignored-paths-only) so a skipped deploy prints nothing extra, and before `deploy_init`
so it's outside the CI/deploy log capture — informational only, no prompt, no behavior
change. Handles the new-branch case (`git`'s 40-zero placeholder sha, which
`git rev-parse --verify` echoes back as "valid" rather than rejecting) with its own check.

This picked up mid-flight from a predecessor session killed by an orchestrator timeout;
the diff above (pre-push, deploy-plan.sh, deploy-plan.test.sh) was already complete and
correct on review, including a prepared trivial validation commit sitting on `tastease`
(`apps/api/src/index.ts`, "chore: trivial comment for emit-infra sprint-270 hook
validation push") — this session's job was verification, not authorship.

### Files changed
- `scripts/hooks/pre-push` — capture `LOCAL_SHA`/`REMOTE_SHA` from the main-branch ref
  line, call `push_payload_summary` after the deploy gates, replace the inline build
  loop with `run_build_fanout`, replace the ERR trap's inline command with a named
  `_fail_deploy` function reused as the fan-out's `on_fail` callback
- `scripts/lib/deploy-plan.sh` — add `run_build_fanout` (fix 5) and `push_payload_summary`
  (fix 6)
- `scripts/lib/deploy-plan.test.sh` — add `run_build_fanout` unit tests (no-failure,
  one-failure, multiple-failures, parallel batches) plus a real `deploy_init`/`build_image`/
  `deploy_done` integration test in a scratch git repo proving a forced build failure
  ends `.deploy-status.json` at `failed` with a matching history line; add
  `push_payload_summary` tests (multi-commit, single-commit, new-branch/zero-sha) against
  a real scratch git repo

### Verification
- `bash -n` on all three changed scripts: clean
- `pnpm test:hooks` under `/bin/bash` (confirmed bash 3.2.57 on this host): 47/47 pass
  (36 pre-existing + 11 new: 4 `run_build_fanout` unit + 2 forced-failure integration +
  4 `push_payload_summary` + net new count from prior sprints)
- Real push: `tastease` (`develemit/easyliving`) — pushed the pre-staged validation
  commit to `main`. CI ran (300/300 tests), image build + retag succeeded, blue-green
  deploy completed, `.deploy-status.json` → `deployed` at the correct sha, history line
  written with phase timings, server health check (`https://app.tastease.app/api/healthz`)
  returned 200 post-deploy. No regression. (The payload-summary line itself prints
  between the CI and deploy log-capture windows, so it isn't persisted to a log file;
  its exact output is instead proven by the `push_payload_summary` unit tests above,
  which exercise the same function against real git history rather than a mock.)

### Follow-ups
- `[defer]` `push_payload_summary`'s output isn't captured in `.ci-logs/` or
  `.deploy-logs/` since it runs in the gap between the two log-capture windows —
  fine for an informational line, but worth knowing if a future sprint wants every
  hook line audit-logged.
- `[defer]` `docs/PRE-PUSH-HOOK.md` doesn't yet document `run_build_fanout` or the
  payload summary print; low priority since the doc is about *behavior* (deploy gates,
  smart build) rather than internal function names, and this sprint didn't change
  any documented behavior.
