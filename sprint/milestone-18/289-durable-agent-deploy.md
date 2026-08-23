# Give agent-driven deploys a detached path that outlives the session
**Difficulty:** 3

## Goal
A repo-tracked `scripts/deploy-detached.sh` launches a production deploy that
survives its caller being killed, then polls until the deploy reaches a terminal
state. A thin `/deploy` skill wraps it so "deploy emit-social" from the
dashboard works again.

## Reason
The operator's primary workflow is prompting a Claude session from the
develemit-hq dashboard to push to `main`, which triggers a production deploy —
relied on heavily while away from a terminal. Sprint 288's gate
(`scripts/hooks/pre-push:161`) blocks that workflow outright: it exits 1 when
`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, or `CI` is set, and a dashboard session
sets `CLAUDECODE=1`.

Simply handing back a blanket override would be wrong. The 2026-08-19 incident
was **not** "agent shells are flaky" — it was that the deploy was tied to a tool
call's lifetime and died mid-build when that lifetime ended. That risk is live:
the agent Bash tool has a 600s timeout, and a three-service emulated
`linux/amd64` build can exceed it. So the fix has to make agent deploys
*survive* teardown, not merely permit them.

Detaching the whole `git push` does exactly that: CI, build, deploy, and the
push itself all continue after the caller is gone.

## Context

### Why detach the whole push, not just the deploy phase
The hook runs the deploy **before** `git push` completes — that is why the
2026-08-19 incident left `.deploy-status.json` at `deploying` while
`origin/main` never moved. That ordering is a feature: prod and `main` move
together. Detaching only the deploy phase would mean a killed hook leaves prod
*ahead of* `origin/main` — a worse inconsistency than "nothing happened".
Detaching the entire `git push` preserves the coupling. **Do not restructure the
hook here.**

### Durability cannot be auto-detected — do not try
Measured on this machine (macOS, bash 3.2.57):
- Bash does **not** expose an inherited ignored `SIGHUP`. Even with an explicit
  `trap '' HUP` in the parent, the child's `trap -p HUP` returns empty.
- `setsid` is **absent** on macOS.
- `nohup cmd &` leaves `pgid` unchanged, so process-group inspection doesn't
  discriminate either.

So the durable path must *declare* itself with an env var. Sprint 290 makes that
declaration honest; this sprint uses the existing
`EMIT_ALLOW_UNATTENDED_DEPLOY=1`, which already works today with no hook change.

### Existing pieces to use, not duplicate
- `packages/core/src/deploy-status.ts` exports `classifyRunState` (sprint 284) —
  `'idle' | 'running' | 'orphaned' | 'unknown'`. The CLI surfaces it:
  `node apps/cli/dist/index.js status <name>` prints a "Local pipeline" section.
- `emit-infra reconcile --write` (sprint 286) clears an orphaned record.
- The `/verify-deploy` skill (`~/.claude/commands/verify-deploy.md`) already does
  post-deploy verification thoroughly — build identity, container/slot health,
  smoke tests, telemetry. **Hand off to it; do not reimplement verification.**
- Status file shapes: in-flight has `status: deploying` plus a
  `writer{pid,host,heartbeatAt}` block (sprint 283); terminal drops `progress`
  and `writer` and adds `completedAt`.

### Skill files are not version controlled
`~/.claude/commands/` is **not** a git repo. Anything written there can't be
committed and won't survive a machine rebuild. So all real logic lives in
`scripts/deploy-detached.sh` (tracked, tested); the skill is a thin wrapper that
calls it. Keep the skill under ~60 lines.

### Conventions
- **Bash 3.2.57** is the target. No `declare -A`, no `${var^^}`.
- New test suites get their own file and are chained into `test:hooks` in
  `package.json` — precedent: `hook-signals.test.sh`, `deploy-liveness.test.sh`,
  `deploy-unattended-gate.test.sh`. Project guideline is ≤300 lines per file.
- `scripts/lib/deploy-plan.sh` holds shared helpers; source it rather than
  re-implementing `resolve_last_deployed_sha` or the marker list.

## Tasks
1. Write `scripts/deploy-detached.sh`. Preflight before launching: refuse if the
   working tree is dirty, if `HEAD` is not on `main`, if there is nothing to
   push, or if a deploy is already classified `running` for this project. On an
   `orphaned` record, tell the operator to run `emit-infra reconcile --write`
   and exit non-zero rather than stomping it.
2. Launch the detached push. Redirect to a predictable, resumable log path
   (e.g. `/tmp/emit-deploy-<project>-<shortsha>.log`) and print that path
   immediately so a later session can pick up watching it:
   `nohup env EMIT_ALLOW_UNATTENDED_DEPLOY=1 git push origin main > "$LOG" 2>&1 &`
3. Poll `.deploy-status.json` until it reaches a terminal status, with a bounded
   ceiling (default generous — a 3-service emulated build runs many minutes) and
   a `--timeout` override. On timeout, do **not** kill the deploy: report that it
   is still running, print the log path, and exit with a distinct code.
4. Support `--no-wait` so a caller can launch and return immediately, and
   `--watch` to attach to an already-running deploy using only the log path and
   status file (no relaunch).
5. Print a terminal summary: final status, duration, services built, and the log
   path. On failure, print the last ~20 lines of the log rather than the whole
   thing.
6. Add `scripts/lib/deploy-detached.test.sh` and chain it into `test:hooks`.
   Follow `deploy-unattended-gate.test.sh`'s harness: a scratch repo with a bare
   remote and the real hook symlinked in.
7. **The critical test: kill the launcher and prove the push still completes.**
   Start the detached push, kill the launching shell, then assert the push still
   lands on the bare remote and a terminal record is written. This is the
   behavior the whole sprint exists for — without this case the sprint is
   unverified.
8. Write `~/.claude/commands/deploy.md` as a thin wrapper: run
   `scripts/deploy-detached.sh`, report the outcome, and on success suggest
   `/verify-deploy`. Note in the sprint's Completed section that this file is
   untracked and why.
9. `bash -n` on every touched script, then `pnpm test:hooks` under `/bin/bash`
   (3.2).

## Files involved
- new file: `scripts/deploy-detached.sh` — preflight, detached launch, bounded
  poll, summary
- new file: `scripts/lib/deploy-detached.test.sh` — harness + the kill-the-
  launcher survival case
- `package.json` — chain the new suite into `test:hooks`
- new file: `~/.claude/commands/deploy.md` — thin skill wrapper (untracked; see
  Context)

## Acceptance criteria
- [x] A deploy launched via `scripts/deploy-detached.sh` completes even after the
      launching shell is killed
- [x] The script prints the log path immediately, before the deploy finishes, so
      a torn-down session can be resumed with `--watch`
- [x] Polling ends on a terminal status; a timeout reports "still running" and
      leaves the deploy alive rather than killing it
- [x] Preflight refuses a dirty tree, a non-`main` HEAD, nothing-to-push, and an
      already-`running` deploy; an `orphaned` record points at
      `emit-infra reconcile --write`
- [x] Test coverage in `scripts/lib/deploy-detached.test.sh`, including the
      kill-the-launcher survival case from task 7, run by `pnpm test:hooks`
- [x] `pnpm test:hooks` green under bash 3.2; `bash -n` clean on all touched
      scripts

## Completed

**Date:** 2026-08-20

### Summary
Added `scripts/deploy-detached.sh`: preflight (dirty tree / non-main HEAD /
nothing-to-push / already-`running` or `orphaned` via `classifyRunState`),
then a detached launch (`nohup bash -c '... git push origin main; echo $? >
rc' &`), then bounded polling. Two deliberate deviations from the task list's
literal wording, both explained inline in the script:

1. **Polling waits on the push's own exit code, not directly on
   `.deploy-status.json`.** A `.deploy-status.json` record alone can't
   distinguish "still in CI" from "push rejected before deploy ever started"
   from "deploy skipped because only ignored paths changed" — all three
   leave no new record for the launched sha. The nohup'd wrapper writes its
   exit code to a sibling `.rc` file when the whole push finishes, which is
   the actual terminal signal `poll_for_result` waits on; `.deploy-status.json`
   and `.deploy-history.jsonl` are then read only to build the summary
   (final status, services built).
2. **`classifyRunState` is reused via a small Node CLI wrapper**
   (`scripts/lib/classify-run-state.mjs`) rather than reimplemented in the
   inline-python style the rest of `deploy-plan.sh` uses. The sprint file
   was explicit that this is the one place that must not duplicate the
   heartbeat/pid staleness rule (sprint 284's doc comment), and the classifier
   only exists as TS in `packages/core`.

`scripts/deploy-detached.sh` sources `deploy-plan.sh` but doesn't run `main()`
when sourced (guarded on `BASH_SOURCE[0] == $0`), specifically so
`deploy-detached.test.sh` can source it and unit-test `preflight`,
`print_summary`, `poll_for_result`, and `watch_main` directly against
fabricated fixtures instead of paying for a real git-hook round trip per
case. Found and fixed a real bug this way before it shipped: the script
originally had `PROJECT_DIR="$(pwd)"` as an unconditional top-level
assignment, which silently clobbered a caller-set `PROJECT_DIR` on `source`
— changed to `: "${PROJECT_DIR:=}"` with `main()` applying the cwd default
itself.

Task 7's kill-the-launcher case is the one true end-to-end integration test:
a scratch repo + bare remote + the real `scripts/hooks/pre-push` symlinked
in (same harness as `deploy-unattended-gate.test.sh`), with a `git` shim on
`PATH` that sleeps a few seconds before an actual `push` so there's a real
in-flight window to kill mid-poll, without needing real GHCR/docker (the
fixture's `ci.ghcrOrg` is empty, so the deploy phase skips instantly once the
push itself completes — CI still runs for real and its terminal record is
what the test asserts on). First attempt at this test was flaky: a fixed
`sleep 1.5` before killing the launcher sometimes fired before preflight's
Node cold-start (`classify-run-state.mjs`'s dynamic import) finished, killing
the launcher before it ever backgrounded the push — fixed by polling
`launcher.out` for the "launched detached deploy" marker instead of a fixed
sleep.

`~/.claude/commands/deploy.md` is written but **not tracked by git** —
`~/.claude/commands/` isn't a git repo, so it can't be committed and won't
survive a machine rebuild (per the sprint's own Context section). All real
logic lives in the tracked, tested `scripts/deploy-detached.sh`; the skill
file is a ~40-line wrapper.

### Files changed
- (new) `scripts/deploy-detached.sh` — preflight, detached launch, bounded
  poll, terminal summary; sourceable for unit testing
- (new) `scripts/lib/classify-run-state.mjs` — thin Node CLI wrapper around
  `@emit-infra/core`'s `classifyRunState`, so bash callers get the same
  running/orphaned/idle/unknown verdict as the dashboard and `emit-infra
  status` without a second heuristic
- (new) `scripts/lib/deploy-detached.test.sh` — unit cases (sourced) plus
  the real end-to-end kill-the-launcher survival case
- `package.json` — chained the new suite into `test:hooks`
- (untracked, not committed) `~/.claude/commands/deploy.md` — thin `/deploy`
  skill wrapper

### Verification
- `bash scripts/lib/deploy-detached.test.sh` under `/bin/bash` (3.2.57):
  24/24 pass, run 3x back-to-back with no flakes after the marker-sync fix
- `pnpm test:hooks` (all seven suites, `/bin/bash` 3.2.57): 134/134 pass
  total (47 deploy-plan + 12 docker-build + 6 db-url + 12 hook-signals + 13
  deploy-liveness + 20 deploy-unattended-gate + 24 new deploy-detached
  suite), 0 failed
- `bash -n` clean on `scripts/deploy-detached.sh`,
  `scripts/lib/deploy-detached.test.sh`, `scripts/lib/deploy-plan.sh`,
  `scripts/hooks/pre-push`
- Manual smoke test against a real scratch repo/remote/hook: preflight
  refusals (dirty, non-main, nothing-to-push, already-running, orphaned),
  `--no-wait`, `--watch` reattachment, and a full launch-to-completion run
  all behaved as expected before being folded into the automated suite

### Follow-ups
- `[defer]` Default `--timeout` is 3600s (1 hour), chosen as "generous" per
  the sprint's own guidance but not validated against a real multi-service
  emulated build's actual wall-clock time. Worth revisiting once a real
  detached deploy has run end to end (sprint 291's verification checklist
  is a natural place to record that number).
- `[defer]` `poll_for_result`'s loop granularity is a flat `sleep 10` between
  checks (matching the heartbeat interval's order of magnitude), so a
  deploy that finishes just after a check can take up to ~10s longer than
  necessary to report. Fine at production timeout scales; not worth tuning
  further absent a complaint.
- `[defer]` `deploy.md`'s untracked status means it doesn't show up in `git
  log` or code review — if it drifts from `deploy-detached.sh`'s actual
  flags/behavior there's no CI to catch it. Sprint 291 is already documenting
  the detached workflow end to end in tracked docs, which gives a second
  place to notice drift.

## Out of scope
- **Changing the gate or its env var.** This sprint uses the existing
  `EMIT_ALLOW_UNATTENDED_DEPLOY=1`, which works today. Renaming it to a positive
  durability assertion is sprint 290.
- **Restructuring the hook to detach its own deploy phase.** See Context — it
  would let prod get ahead of `origin/main`.
- **Reimplementing post-deploy verification.** Hand off to `/verify-deploy`.
- Auto-reconciling an orphaned record. Report it and stop; repair stays a
  deliberate operator action per sprint 286.
- Any dashboard UI work in develemit-hq.
