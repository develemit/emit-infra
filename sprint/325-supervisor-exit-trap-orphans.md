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
- [ ] After `kill -9` of a supervisor, the next start reclaims the orphaned port and the server comes up without manual intervention
- [ ] A port held by a process whose command line does not match the supervised command is never killed — the supervisor logs and refuses
- [ ] The EXIT trap kills the child tree on abnormal exit and does not double-kill on a normal TERM shutdown
- [ ] Existing signal behavior from sprint 321 is unchanged (a TERM still records `reason: "signalled"` and exits without restarting)
- [ ] New cases in `scripts/lib/serve-supervised.test.sh` cover reclaim, refusal, and both EXIT-trap paths
- [ ] `pnpm test:hooks` passes

## Out of scope
- Restructuring the `caffeinate → pnpm → nx → bash` chain so launchd manages `tsx` directly (the other half of the sprint 314 note — larger, and this fix is independent of it)
- Applying the fix to develemit-hq's plist; the change is in the shared script, and rolling it out there is a follow-up
- OOM-proofing the dev servers themselves
- Anything touching the fleet's production supervisors
