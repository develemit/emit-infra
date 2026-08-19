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
   (3.2), then one real push on a wired project to confirm no regression.

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
- [ ] A deploy killed with SIGTERM mid-build ends with `.deploy-status.json`
      status `interrupted`, not `deploying`
- [ ] A CI phase killed with SIGTERM ends `.ci-status.json` at `failure`, not
      `running`
- [ ] Exactly one `.deploy-history.jsonl` line is appended per run, including
      when a signal arrives just after a normal `deploy_done`
- [ ] The interrupted process still exits with a signal-derived status (a
      wrapper observing it can tell it was killed, not that it succeeded)
- [ ] Test coverage lives in `scripts/lib/deploy-plan.test.sh` or
      `scripts/lib/hook-signals.test.sh` and is run by `pnpm test:hooks`
- [ ] `pnpm test:hooks` green under bash 3.2; `bash -n` clean on all touched
      scripts; one real push verified end to end

## Out of scope
- **SIGKILL.** It cannot be trapped, so no handler will ever run for it. That
  gap is covered by liveness metadata in sprint 283, and the two mechanisms are
  complementary — do not try to solve it here.
- Reader-side staleness detection (sprint 284), dashboard rendering (285), and
  the `--reconcile` recovery command (286).
- Changing the deploy gate order, the ignored-paths filter, or anything about
  what gets built.
