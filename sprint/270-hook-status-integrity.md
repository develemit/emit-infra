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
- [ ] Forced build failure ends with `.deploy-status.json` status `failed`
      (test proves it); history line records the failure
- [ ] Push payload summary prints; no prompts added; dry-run path unchanged
- [ ] 36+ hook tests green under bash 3.2; real push verified
