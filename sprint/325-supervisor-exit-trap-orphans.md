# Kill orphaned children when the supervisor dies without running its traps
**Difficulty:** 4

## Goal
A `SIGKILL`ed or OOM-killed `serve-supervised.sh` does not leave its child holding
the dev server's port, so the replacement supervisor starts cleanly instead of
failing forever on an address/lock conflict.

## Reason
Filed from sprint 314 and verified live on develemit-hq (backlog.md, 2026-08-26):
`SIGKILL` bypasses the TERM/INT traps, so `serve-supervised.sh` dies without
killing its child tree. The orphaned `tsx`/`next` process reparents to pid 1 and
keeps holding port 9000 plus Next's dev-mode lock — and then **every restart
attempt by the replacement supervisor fails** with "Another next dev server is
already running" until someone kills the orphan by hand.

This belongs with the rest of this initiative because it is the same end state
from a different cause: the dev server is down and does not come back on its own.
It also directly undercuts sprint 322 — a watchdog that kickstarts the stack into
a port still held by an orphan just produces a restart loop, so the recovery path
is only trustworthy once this is fixed.

## Context
- `scripts/serve-supervised.sh` — traps installed by `_svsup_install_traps()`
  (~line 103) cover INT and TERM only, which is correct for graceful stops.
  `SIGKILL` cannot be trapped **by the dying process** — the fix cannot be a KILL
  trap, so it must be recovery on the *next* start rather than cleanup on death.
- The main loop already has the needed primitive: before spawning, it calls
  `_svsup_wait_port_free "$health_host" "$health_port" 50` and, on failure,
  `_svsup_kill_port_holders` (lines ~246-250) — but only in the *teardown* path
  after a death it observed. A supervisor that starts fresh after being SIGKILLed
  never runs that path, because it has no prior child to tear down.
- `scripts/lib/serve-supervised-lib.sh` provides `_svsup_lsof_bin` (lsof is not on
  launchd's PATH), `_svsup_kill_port_holders <host> <port>`, and
  `_svsup_wait_port_free <host> <port> [timeout-ds]`.
- Next.js adds a second resource beyond the port: a dev-mode lock inside `.next/`.
  Freeing the port may not be sufficient for develemit-hq; check whether killing
  the listener also clears the lock, and if not, handle it explicitly. Related
  known hazard: a clobbered `.next` makes every page 500 while `/api/*` stays 200.
- An EXIT trap (`trap ... EXIT`) covers the non-KILL abnormal exits (an unexpected
  `set -e` failure, an unhandled error) and is worth adding as defense in depth,
  but it does **not** run on SIGKILL — do not let it stand in for the startup check.
- Tests: `scripts/lib/serve-supervised.test.sh`, run via `pnpm test:hooks`.
- This project has no `check:affected` script; its suite is `pnpm test:hooks`,
  `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Tasks
1. Add a pre-spawn reclaim step at the top of the main loop: before starting a
   child, check whether `health_host:health_port` is already held. If it is, log a
   clear line naming the holder pid and reclaim it via `_svsup_kill_port_holders`,
   then wait for the port with `_svsup_wait_port_free`.
2. Make the reclaim safe. It must refuse to kill anything that is not plausibly an
   orphan of this supervisor's own command — at minimum verify the holder's command
   line matches the supervised command before killing, and log-and-refuse otherwise.
   Killing an unrelated process that happens to hold the port would be a far worse
   bug than the one being fixed.
3. If the port is held and the holder cannot be safely identified, do not spawn on
   top of it: log loudly and fail fast rather than starting a child that will
   silently lose the port race.
4. Add a best-effort `EXIT` trap that kills the child tree on abnormal (non-signal)
   exits, guarded so it does not double-kill on the normal shutdown path or fire
   during the intentional `exit 1` after `--max-restarts`.
5. Investigate Next's dev-mode lock: determine whether freeing the port clears it,
   and if not, add explicit handling (documented, narrowly scoped to the lock file).
6. Add tests to `scripts/lib/serve-supervised.test.sh`: a pre-held port with a
   matching command line is reclaimed and the child starts; a pre-held port with a
   non-matching command line is refused, logged, and no kill is issued; the EXIT
   trap fires on abnormal exit but not twice on a normal TERM shutdown.
7. Update `docs/DEV-SERVER-SUPERVISOR.md` and strike the sprint 314 item from
   `backlog.md` (line ~167) once the fix lands.

## Files involved
- `scripts/serve-supervised.sh` — pre-spawn port reclaim, guarded EXIT trap
- `scripts/lib/serve-supervised-lib.sh` — extend the port-holder helpers with command-line verification
- `scripts/lib/serve-supervised.test.sh` — coverage for reclaim, refusal, and EXIT-trap cases
- `backlog.md` — strike the sprint 314 orphan item
- `docs/DEV-SERVER-SUPERVISOR.md` — document the reclaim behavior and its safety guard

## Acceptance criteria
- [x] After `kill -9` of a supervisor, the next start reclaims the orphaned port and the server comes up without manual intervention
- [x] A port held by a process whose command line does not match the supervised command is never killed — the supervisor logs and refuses
- [x] The EXIT trap kills the child tree on abnormal exit and does not double-kill on a normal TERM shutdown
- [x] Existing signal behavior from sprint 321 is unchanged (a TERM still records `reason: "signalled"` and exits without restarting)
- [x] New cases in `scripts/lib/serve-supervised.test.sh` cover reclaim, refusal, and both EXIT-trap paths
- [x] `pnpm test:hooks` passes

## Out of scope
- Restructuring the `caffeinate → pnpm → nx → bash` chain so launchd manages `tsx` directly (the other half of the sprint 314 note — larger, and this fix is independent of it)
- Applying the fix to develemit-hq's plist; the change is in the shared script, and rolling it out there is a follow-up
- OOM-proofing the dev servers themselves
- Anything touching the fleet's production supervisors

## Completed

**Date:** 2026-09-07

### Summary
A `SIGKILL`ed supervisor now recovers on its own next start instead of requiring a
manual kill. Before spawning `<command...>`, `serve-supervised.sh`'s main loop
unconditionally calls a new `_svsup_reclaim_port` (in
`scripts/lib/serve-supervised-lib.sh`): it looks up whatever's currently listening
on the health port via `lsof`, fetches each holder's full command line (`ps -ww`,
not the default truncated form — truncation silently breaks this under launchd's
terminal-less PATH the same way it breaks `lsof` resolution elsewhere in this
file), and compares it against the command this instance is about to launch via a
new `_svsup_cmdline_matches_command`. That match is a substring check, not an
exact one, because the process actually holding the port is usually a
*descendant* of the top-level command (`tsx --watch`'s real listener, `next
dev`'s render worker) — its argv is never literally identical to what was passed
after `--`. The interpreter/binary (token 0) always counts as a candidate; later
tokens only count if they're long enough and not a bare flag, so a generic short
flag like `-w` can't produce a false match on its own. A match gets killed and the
port awaited free; a non-match is refused — nothing is killed, a loud line names
the pid and its command line, and the supervisor exits rather than silently
losing the race for the port on a bind it can't win.

The first version of the pre-spawn check gated the reclaim behind a cheap
single-shot `nc`-based "is anything listening" probe (`_svsup_wait_port_free
... 1`) before bothering with the `lsof`-based lookup. That was wrong: a
one-shot connect attempt can flake on a loaded box (the probe itself stalling
long enough to read as "free" when it isn't), which silently skips the reclaim
on exactly the runs where a stale orphan is most likely to already be sitting on
the port. This surfaced directly during verification — an end-to-end test that
literally `kill -9`ed a live supervisor intermittently hung for minutes on the
next start's health-check wait, with the process list showing the *replacement*
supervisor running normally while the original orphan sat unreclaimed and
unrefused. The fix is to always run the authoritative `lsof`-based check (it's
already a fast no-op when nothing is listening) and drop the single-shot
pre-filter entirely — there's nothing it was saving.

As defense in depth, an `EXIT` trap (`_svsup_handle_exit`) kills the child tree
on any exit this script didn't plan for (an unbound variable tripping `set -u`,
a future codepath falling through without reaching one of the three deliberate
exits). It cannot fire on `SIGKILL` — nothing run by the dying process can — so
it's explicitly *not* the fix for the SIGKILL case; the pre-spawn reclaim above
is. It's guarded against double-killing: a no-op once `SHUTTING_DOWN` is set
(the signal handler already tore the tree down itself) and after the normal
`--max-restarts` exit (`CHILD_ACTIVE` is already cleared by then).

Investigated whether Next.js's dev-mode lock (`.next/dev/lock`, gated behind
`experimental.lockDistDir`, confirmed present and populated in develemit-hq's
`.next/dev/lock`) needed separate handling beyond the port. It doesn't: reading
Next's own `build/lockfile.js` and `setup-dev-bundler.js` shows the lock is an
OS-level advisory lock acquired by, and tied to a file descriptor owned by, the
exact same process that binds the dev server port (`pid: process.pid`, acquired
in-process in `startWatcher()`, not in a forked worker). The kernel releases an
advisory lock the instant its holder's file descriptors close, on any
termination including `SIGKILL` — so reclaiming the port (which kills that same
process) always releases the lock in the same instant. Documented this in
`docs/DEV-SERVER-SUPERVISOR.md` rather than adding code for it.

An initial version of the test suite also added a fully end-to-end case that
`kill -9`ed a real supervisor process and verified the next start reclaimed it.
It was pulled after verification: it reused a single hardcoded port across every
test run, so an orphan surviving one run's failure (or an interrupted local
debugging session) leaked into and contaminated the next run — a test-harness
problem, not a production-code one, but one that made the suite itself flaky.
The substance of that criterion (a real orphan process is reclaimed by cmdline
match, and a new child starts and answers healthy) is already fully covered by
the pre-seeded-orphan case, without the shared-port fragility.

### Files changed
- `scripts/lib/serve-supervised-lib.sh` — added `_svsup_pid_cmdline`, `_svsup_cmdline_matches_command`, and `_svsup_reclaim_port`
- `scripts/serve-supervised.sh` — pre-spawn reclaim at the top of the main loop (always via `_svsup_reclaim_port`, no single-shot pre-filter); `_svsup_handle_exit` EXIT-trap backstop, guarded against double-kill
- `scripts/lib/serve-supervised.test.sh` — new cases: cmdline-match reclaim (orphan killed, new child starts healthy), cmdline-mismatch refusal (nothing killed, loud log, supervisor exits non-zero), `_svsup_cmdline_matches_command` unit cases, both EXIT-trap paths (kills on unplanned exit, no-ops when `SHUTTING_DOWN` is set)
- `docs/DEV-SERVER-SUPERVISOR.md` — documented the reclaim flow, the EXIT-trap backstop, and the Next.js dev-lock investigation; renumbered the "What it does" list to insert the new steps; removed a stray duplicated Ctrl-C bullet found while editing this section
- `backlog.md` — struck the sprint 314 orphan item, pointing at this sprint

### Verification
- `pnpm test:hooks`: full — all 13 suites pass (`serve-supervised.test.sh` 40/40, plus `deploy-plan`, `deploy-path-filter`, `docker-build`, `db-url`, `hook-signals`, `deploy-liveness`, `deploy-unattended-gate`, `deploy-detached`, `resource-gate`, `check-all`, `dev-stack-watchdog`, `rotate-launchd-logs`), 291 total assertions, 0 failures. Re-run 4 times consecutively (36–40s each) with no flakes after removing the shared-port end-to-end case.
- `pnpm test`: full — 248/248 pass (unrelated to this sprint's bash-only changes; run per this project's documented full-suite fallback since there's no `check:affected` script)
- `pnpm typecheck` / `pnpm lint`: full — clean (cached; no TS files touched)
- `bash -n`: clean on all three edited shell files
- Manual: confirmed the running dev stack (`emit-infra-api` on :7001, `develemit-hq` on :9000) was undisturbed by test runs throughout

### Follow-ups
- `[defer]` `scripts/serve-supervised.sh` (349 lines), `scripts/lib/serve-supervised.test.sh` (515 lines), and `docs/DEV-SERVER-SUPERVISOR.md` (352 lines) were already over this repo's 300-line guidance before this sprint and grew further with this change. Splitting any of them wasn't in scope here; worth a dedicated pass (e.g. extracting the reclaim/cmdline-match helpers' tests into their own file) next time one of them is touched.
- `[defer]` The out-of-scope item from sprint 314 — rolling this fix out to develemit-hq's plist — remains open; the fix lives in the shared script so develemit-hq picks it up automatically the next time it pulls emit-infra, but nobody has verified that live yet.
- `[defer]` `_svsup_cmdline_matches_command`'s matching heuristic (interpreter token always counts, later tokens count if long enough and not a bare flag) is deliberately permissive rather than exact, since the real holder is usually a descendant with different argv. If this ever produces a wrong refusal in practice (a legitimate respawn whose descendant's cmdline doesn't share any long token with the original command), the fix is to widen the token list, not loosen the length/flag filter.
