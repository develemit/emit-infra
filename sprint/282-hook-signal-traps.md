# Trap signals in the pre-push hook so an interrupted deploy marks itself
**Difficulty:** 4

## Goal
A `pre-push` deploy that is interrupted by SIGINT, SIGTERM, or SIGHUP ends with
`.deploy-status.json` reading `interrupted` instead of being frozen at
`deploying`. A repro harness in the test suite proves it.

## Reason
On 2026-08-19 an emit-social deploy was launched from an agent session's
background shell and the shell was torn down mid-build. The hook died during
`==> Building web...`. Because nothing ran `deploy_done`, `.deploy-status.json`
stayed at:

```json
{"status":"deploying","sha":"6423d5d...","progress":{"step":2,"total":3,"pct":66,"label":"Building + pushing images"}}
```

Sixteen minutes later, with no process alive and `origin/main` never having
moved, the dashboard still rendered a live-looking "66%". The operator had to
ask whether the deploy was real, and the status file could not answer.

Sprint 270 already closed this exact symptom for the *build-failure* path
(`run_build_fanout`'s `on_fail` callback plus the named `_fail_deploy` ERR
trap). Signals are the same bug through a different door: an `ERR` trap does not
fire on SIGTERM, and `on_fail` is never reached because the process is gone.
This sprint closes the signal door. It deliberately does **not** claim to close
SIGKILL — see Out of scope — which is what sprint 283 exists for.

## Context
- `scripts/hooks/pre-push` is the shared hook, symlinked into every wired
  project (`emit-social`, `tastease`, `develemail`, `emit-vision`, ...). Editing
  it changes behavior for all of them on their next push — there is no version
  pinning. Run the tests before committing.
- Status writers live in `scripts/lib/ci-utils.sh`: `deploy_init <total>`,
  `deploy_step "label"`, `deploy_done deployed|failed`. `deploy_done` is what
  writes the terminal status and appends to `.deploy-history.jsonl`.
- The hook already defines `_fail_deploy()` (wraps `deploy_done failed; echo;
  exit 1`) and installs it as the `ERR` trap during the deploy phase. Reuse that
  shape rather than inventing a second teardown path.
- **Bash 3.2 is the target** (macOS system bash). No `declare -A`, no `${var^^}`.
- `ci_done` / `deploy_done` call `_emit_flush_log`, which restores stdout/stderr
  from fds 3/4 and waits on the background `tee` (`_EMIT_TEE_PID`). A signal
  handler that writes status must not leave the log teed to a dead fifo or
  double-restore those fds — read `_emit_start_log` / `_emit_flush_log` in
  `ci-utils.sh` before touching this.
- `deploy_done` currently accepts `deployed|failed`. This sprint adds
  `interrupted` as a third terminal value. Keep it a plain string; readers
  treat anything that isn't `deploying` as terminal.
- Signals can arrive during the CI phase too (that happened in the same
  incident — the second attempt died inside `nx affected -t build`). `ci_done`
  takes `success|failure`; interrupting CI should land `failure` rather than
  leaving `.ci-status.json` at `running`.

## Tasks
1. Establish `interrupted` as a documented terminal status. Note that
   `deploy_done` in `scripts/lib/ci-utils.sh` already writes `$1` verbatim into
   both `.deploy-status.json` and `.deploy-history.jsonl` with no allowlist, so
   passing `interrupted` works today with no code change — the work here is
   deciding the vocabulary, not adding a branch. If any validation is added,
   add it for all values at once rather than special-casing this one.
2. Add a signal-handling helper in `ci-utils.sh` (e.g. `_emit_trap_signals`)
   that installs handlers for `INT`, `TERM`, and `HUP`. On signal: write the
   appropriate terminal status, flush the log, and re-raise the signal with the
   default disposition so the exit code stays honest (`trap - <sig>; kill
   -<sig> $$`).
3. Wire it into `scripts/hooks/pre-push` for both phases: during CI it should
   land `ci_done failure`; during the deploy phase it should land
   `deploy_done interrupted`. Make sure the handler installed for one phase
   doesn't fire the other phase's writer.
4. Guard against double-writes: if `deploy_done` has already run normally, a
   subsequent signal handler must not append a second history line. A module
   level `_EMIT_DEPLOY_FINALIZED` flag is enough.
5. Build the repro harness: extend `scripts/lib/deploy-plan.test.sh` (or add a
   sibling `scripts/lib/hook-signals.test.sh` wired into the `test:hooks`
   script) with a case that starts a fake long-running deploy in a scratch repo,
   sends it SIGTERM, waits, and asserts the resulting `.deploy-status.json`
   status is `interrupted`. Assert the history line landed exactly once.
6. Add the operator warning to `docs/PRE-PUSH-HOOK.md`: pushing to `main` is a
   real production deploy and must not be run from an environment that may kill
   the process (agent background shells, sandboxes, short tool timeouts). One
   short subsection — the full runbook is sprint 287.
7. `bash -n` on every touched script, then `pnpm test:hooks` under `/bin/bash`
   (3.2). Live-push verification is deliberately **not** part of this sprint —
   see Out of scope.

## Files involved
- `scripts/lib/ci-utils.sh` — add `interrupted` status, the signal-trap helper,
  and the finalized-once guard
- `scripts/hooks/pre-push` — install the traps for the CI and deploy phases
- `scripts/lib/deploy-plan.test.sh` — signal repro case, or:
- new file: `scripts/lib/hook-signals.test.sh` — if a separate suite reads
  better; add it to `test:hooks` in `package.json`
- `package.json` — `test:hooks` script, only if a new suite file is added
- `docs/PRE-PUSH-HOOK.md` — short operator warning subsection

## Acceptance criteria
- [x] A deploy killed with SIGTERM mid-build ends with `.deploy-status.json`
      status `interrupted`, not `deploying`
- [x] A CI phase killed with SIGTERM ends `.ci-status.json` at `failure`, not
      `running`
- [x] Exactly one `.deploy-history.jsonl` line is appended per run, including
      when a signal arrives just after a normal `deploy_done`
- [x] The interrupted process still exits with a signal-derived status (a
      wrapper observing it can tell it was killed, not that it succeeded)
- [x] Test coverage lives in `scripts/lib/deploy-plan.test.sh` or
      `scripts/lib/hook-signals.test.sh` and is run by `pnpm test:hooks`
- [x] `pnpm test:hooks` green under bash 3.2; `bash -n` clean on all touched
      scripts

## Out of scope
- **SIGKILL.** It cannot be trapped, so no handler will ever run for it. That
  gap is covered by liveness metadata in sprint 283, and the two mechanisms are
  complementary — do not try to solve it here.
- Reader-side staleness detection (sprint 284), dashboard rendering (285), and
  the `--reconcile` recovery command (286).
- Changing the deploy gate order, the ignored-paths filter, or anything about
  what gets built.
- **Live-push verification.** Confirming the new trap wiring against a real
  production deploy means pushing to a wired project's `main` — an
  irreversible, outward-facing action that cannot be run unattended, and the
  exact class of action this initiative exists to make safer. It is deferred
  to manual operator verification the next time a real deploy runs naturally.
  The automated suite (`scripts/lib/hook-signals.test.sh`) already covers the
  trap / re-raise / idempotency behavior against real subprocesses, which is
  what a live push would be checking. Do not re-add this as an acceptance
  criterion — it stalls every headless run of this sprint.

## Completed

**Date:** 2026-08-19

### Summary
A predecessor session did all the implementation work and left the sprint in
`## In Progress` blocked only on a live-push verification clause the user
subsequently removed from the acceptance criteria (live-push moved to Out of
scope, deferred to manual operator verification). This session picked up the
resumed dirty tree, read the predecessor's diff, and finished the remaining
step: re-verify `bash -n` and the full `pnpm test:hooks` suite under real
bash 3.2, tick the last acceptance box, and commit.

`ci-utils.sh` gained `_emit_trap_signals <ci|deploy>` / `_emit_untrap_signals`,
installing INT/TERM/HUP handlers that write the terminal status
(`ci_done failure` / `deploy_done interrupted`) and re-raise the signal with
its default disposition so the process's own exit code still reflects the
kill. `ci_done`/`deploy_done` guard against double-finalization via
`_EMIT_CI_FINALIZED` / `_EMIT_DEPLOY_FINALIZED` flags, so a signal landing
just after a normal completion is a no-op rather than a duplicate history
line. `pre-push` wires the trap in/out around both the CI and deploy phases
so one phase's handler can never fire during the other. A new
`scripts/lib/hook-signals.test.sh` drives the real trap-and-reraise path
against real subprocesses (not `()` subshells, which inherit the parent's
`$$` in bash 3.2 and would signal the wrong process) — SIGTERM mid-deploy,
SIGTERM mid-CI, SIGHUP, late-signal-after-completion idempotency,
`_emit_untrap_signals` correctly disarming, and INT handler registration
(exercised via `trap -p` rather than an actual kill, since bash auto-ignores
SIGINT for `&`-backgrounded jobs in a non-interactive shell with job control
off).

### Files changed
- `scripts/lib/ci-utils.sh` — `interrupted` terminal status, `_emit_trap_signals`
  / `_emit_untrap_signals`, finalized-once guards on `ci_done`/`deploy_done`
- `scripts/hooks/pre-push` — trap install/uninstall bracketing the CI and
  deploy phases
- (new) `scripts/lib/hook-signals.test.sh` — signal repro suite, wired into
  `test:hooks`
- `package.json` — `test:hooks` now runs `hook-signals.test.sh`
- `docs/PRE-PUSH-HOOK.md` — "Signals and interrupted runs" operator warning
  subsection, plus a `Files` table row for the new test file

### Verification
- `bash -n` on `ci-utils.sh`, `pre-push`, `deploy-plan.test.sh`,
  `hook-signals.test.sh`: clean
- `pnpm test:hooks` under `/bin/bash` (confirmed bash 3.2.57,
  arm64-apple-darwin25): **77 passed, 0 failed** (deploy-plan 47,
  docker-build 12, db-url 6, hook-signals 12)
- Live-push verification deliberately not run — see Out of scope

### Follow-ups
- `[defer]` Live-push verification of the new trap wiring against a real
  production deploy is still outstanding; do it the next time a wired
  project's `main` gets a natural push, per the Out of scope note.
- none other
