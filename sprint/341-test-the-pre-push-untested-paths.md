# Put the pre-push hook's untested paths under test
**Difficulty:** 4

## Goal
The two deploy-path behaviours that currently have no automated coverage — the
re-tag loop and the secret-scan wiring — are exercised by fixture-driven tests,
and the hook keeps shrinking toward orchestration over logic.

## Goal is narrow on purpose
This is not "test the whole hook". It is "close the two gaps sprints 339 and
340 left open, using the extraction pattern this repo already follows".

## Reason
`scripts/hooks/pre-push` is the single most consequential script in the fleet —
it builds images, runs the arch guard, writes deploy records and triggers
Ansible — and **none of the 17 `scripts/lib/*.test.sh` suites covers it**
(verified 2026-09-18). Two specific behaviours shipped in the last week with no
test at all:

- Sprint 339 added per-image progress to the re-tag loop and closed with
  `[defer]` "no automated test exercises the pre-push re-tag loop directly …
  covered by syntax check and code inspection only".
- Sprint 340 wired `emit_scan_log_for_secrets` into `ci_done`
  (`ci-utils.sh:144`) and `deploy_done` (`:232`) so a token reappearing in a
  captured log fails the run. That wiring — the part that makes the guard
  actually fire — is inspected, not tested. The scan function itself has tests;
  the thing that calls it does not.

Both are exactly the shape of bug that stays invisible until a real deploy: a
silent no-op. That is the failure mode this whole run has been chasing.

## Context

### The hook is already mostly extraction
`scripts/hooks/pre-push` is 277 lines and sources six libs:
`ci-utils.sh`, `deploy-plan.sh`, `docker-build.sh`, `image-arch-check.sh`,
`pre-push-config.sh`, `pre-push-ci-phase.sh`. Only `_fail_deploy` (line ~148) is
defined inline. So the established direction is: move logic into a lib function,
test the lib. Continue that; don't build a harness that executes the whole hook
(it would need git, docker, ssh and Ansible stubbed at once).

### Gap 1 — the re-tag loop
`pre-push` lines ~239-245: when `TO_RETAG` is non-empty it sets a phase, then
loops calling `retag_image "$svc"` and (since sprint 339)
`deploy_image_progress` per service. Extract that loop into a lib function
(e.g. `run_retag_fanout` in `deploy-plan.sh`, beside `run_build_fanout`) taking
the service list, so it can be driven with `retag_image` and
`deploy_image_progress` stubbed — the same way `deploy-plan.test.sh` already
stubs `build_image`.

### Gap 2 — the secret-scan wiring
`scripts/lib/ci-utils.sh` — `ci_done()` at line 122 and `deploy_done()` at 204,
each calling `emit_scan_log_for_secrets "<log file>"` after `_emit_flush_log`
and returning the scan's exit code as their own. `ci-utils.sh` is sourceable, so
a test can source it, point the log path at a fixture containing a **fake**
token, call the function, and assert a non-zero return — plus the clean-log case
returning zero. Never put a real token in a fixture; use an obviously-fake
literal that still matches the `gh[oprsu]_` / `github_pat_` shapes.

### Conventions
Shell libs in `scripts/lib/<name>.sh` with sibling `<name>.test.sh`, registered
in the root `package.json`'s `test:hooks`. Existing suites stub externals by
defining shell functions that shadow the real command — read
`scripts/lib/deploy-plan.test.sh` for the idiom before writing. There is **no
`check:affected`** in this repo; the suite is `pnpm test:hooks` plus
`pnpm test`, `pnpm typecheck`, `pnpm lint`.

Keep behaviour identical — this sprint moves code and tests it, it does not
change what the hook does. `bash -n scripts/hooks/pre-push` must still pass.

## Tasks
1. Extract the re-tag loop from `pre-push` into a lib function beside
   `run_build_fanout`, preserving the progress emission sprint 339 added.
2. Cover it in `scripts/lib/deploy-plan.test.sh`: each declared service is
   re-tagged exactly once, in order, with progress emitted per service and the
   correct total; an empty list is a no-op.
3. Add tests for the secret-scan wiring in `scripts/lib/ci-utils.test.sh`
   (create it if absent, register it in `test:hooks`): `deploy_done` and
   `ci_done` each return non-zero when their captured log contains a
   fake-but-matching token, and zero when it doesn't.
4. Confirm the extraction changed nothing: `bash -n scripts/hooks/pre-push`
   passes and the hook still sources everything it needs.
5. If any other inline logic in the hook is trivially extractable while you're
   there, note it as a follow-up rather than doing it — keep this sprint to the
   two named gaps.

## Files involved
- `scripts/hooks/pre-push` — re-tag loop moves out to a lib function
- `scripts/lib/deploy-plan.sh` — gains the re-tag fan-out
- `scripts/lib/deploy-plan.test.sh` — re-tag loop coverage
- new file (likely): `scripts/lib/ci-utils.test.sh` — secret-scan wiring coverage
- `package.json` — register any new test file in `test:hooks`

## Acceptance criteria
- [x] The re-tag loop lives in a lib function and is covered in
      `scripts/lib/deploy-plan.test.sh`: ordering, per-service progress, correct
      total, and the empty-list no-op
- [x] `deploy_done` returns non-zero when its log contains a fake token and zero
      when clean — covered in `scripts/lib/ci-utils.test.sh`
- [x] `ci_done` has the same coverage
- [x] No real token appears in any fixture, commit message or test file
- [x] `bash -n scripts/hooks/pre-push` passes and the hook's behaviour is
      unchanged (no new phases, steps or output ordering)
- [x] Any new test file is registered in `test:hooks`
- [x] `pnpm test:hooks`, `pnpm test`, `pnpm typecheck` and `pnpm lint` pass
      (this repo has no `check:affected`)

## Out of scope
- A harness that executes `scripts/hooks/pre-push` end to end.
- Testing the build fan-out or arch guard (already covered).
- Changing any hook behaviour, phase or output.

## Completed

**Date:** 2026-09-18

### Summary
Extracted the pre-push re-tag loop into `run_retag_fanout` in `deploy-plan.sh` (beside `run_build_fanout`), keeping the sprint 339 progress emission and using the same `declare -F` guard. The hook now calls it in one line. Added ordering/total/empty-list coverage to `deploy-plan.test.sh`, and a new `ci-utils.test.sh` proving `ci_done` and `deploy_done` return non-zero for a log containing a fake `gho_` token and zero for a clean one. The new suite is registered in `test:hooks`.

The only behavioural nuance: the hook previously called `deploy_image_progress` unconditionally; the lib now guards it. In the hook ci-utils is always sourced, so output is identical.

### Files changed
- `scripts/hooks/pre-push` — re-tag loop replaced by `run_retag_fanout`
- `scripts/lib/deploy-plan.sh` — new `run_retag_fanout`
- `scripts/lib/deploy-plan.test.sh` — re-tag fan-out tests
- (new) `scripts/lib/ci-utils.test.sh` — secret-scan wiring tests
- `package.json` — registered `ci-utils.test.sh` in `test:hooks`

### Verification
- `bash -n scripts/hooks/pre-push`: passes
- `pnpm test:hooks`: all suites pass (deploy-plan 62/62, ci-utils 4/4)
- `pnpm test`, `pnpm typecheck`, `pnpm lint`: pass (Nx; no check:affected in this repo)
- Fake token is built at runtime from `x` repeats; no real token anywhere.

### Follow-ups
- `[defer]` Other inline logic remains in `scripts/hooks/pre-push` (e.g. the pre-deploy commands python/JSON loop) and is untested; candidate for the same extraction.
