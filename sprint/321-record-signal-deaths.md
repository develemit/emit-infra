# Record a death record when the supervisor is signalled, not just when it crashes
**Difficulty:** 3

## Goal
`scripts/serve-supervised.sh` writes a `.server-deaths.jsonl` record when it exits
on SIGTERM/SIGINT, distinguishing an intentional stop from a crash by `reason`,
so a supervised server that gets signalled leaves forensic evidence instead of
vanishing silently.

## Reason
On 2026-09-07 the emit-infra API (port 7001) was down from ~02:41 until it was
noticed mid-morning. The supervisor logged `received SIGTERM — forwarding to
child, exiting without restart` and exited cleanly — by design, since Ctrl-C must
not read as a crash. But that design has a hole: **nothing was recorded**. No
death record, so sprint 313's dashboard death list showed nothing; the last entry
there was from 2026-08-27. Reconstructing the outage meant grepping a 10 MB
launchd log for the one line that mattered, and the sender of the signal was
never identified because no context was captured at the time.

The current behavior conflates two very different events: "the user stopped this
on purpose" and "something killed my server and I have no idea what." Both exit
without restarting — that part is correct and stays. What must change is that
both become *visible*. A record with `reason: "signalled"` costs nothing when the
stop was intentional and is the entire investigation when it wasn't.

## Context
- `scripts/serve-supervised.sh` — the supervisor. `_svsup_handle_signal()` (~line 88)
  sets `SHUTTING_DOWN=1`, echoes the "received SIG…" line, kills the child tree,
  and returns. The main loop then breaks at one of the three `[[ $SHUTTING_DOWN -eq 1 ]]`
  guards (lines ~172, ~191, ~216) and falls through to `echo "→ [$NAME] supervisor
  exiting cleanly"` — **skipping the `_svsup_append_death` call entirely**, because
  that call sits after the `break` at line ~216.
- `scripts/lib/serve-supervised-lib.sh` — `_svsup_append_death <deaths-file> <name>
  <reason> <exit> <sig> <uptime> <restarts> <pid> <host> <log-file>` shells into
  python3 to append one JSON object per line. It already captures the last 40 lines
  of the supervisor log as `lastOutput`. Existing `reason` values in the wild:
  `"health-timeout"` and `"exited"`.
- Record consumers: `apps/api/src/routes/history.ts:111`
  (`GET /projects/:name/server-deaths`) and `apps/dashboard/src/lib/api-history.ts:88`.
  `history.ts:51` notes the record shape is owned by the supervisor and the route
  just reads it — so a new `reason` value flows through without an API change, but
  check the dashboard renders an unknown reason without breaking.
- Tests live in `scripts/lib/serve-supervised.test.sh`, run via `pnpm test:hooks`.
  Note the comment at `serve-supervised.sh:96` — bash makes SIGINT ignored-by-default
  for `&`-launched jobs from a non-interactive shell, so tests assert the INT trap is
  *wired* rather than exercising a real `kill -INT`. Follow that existing pattern:
  test the TERM path end-to-end, assert INT wiring statically.
- This project has no `check:affected` script; its suite is `pnpm test:hooks`,
  `pnpm test`, `pnpm typecheck`, `pnpm lint`.

## Tasks
1. In `_svsup_handle_signal()`, capture what is knowable at signal time into globals:
   the signal name, and a best-effort snapshot of the process tree / parent chain
   (e.g. `ps -o ppid=,command= -p $PPID`) to help identify a stray sender later.
   Keep it cheap and failure-tolerant — a signal handler must not block or error.
2. Change the shutdown path so a signalled exit still appends a death record before
   `supervisor exiting cleanly`. Use `reason="signalled"` and populate the `signal`
   field with the signal name (`TERM`/`INT`). Uptime is measured the same way the
   normal path does it (`$(date +%s) - start_epoch`).
3. Do **not** change restart behavior: a signalled supervisor still exits without
   restarting, and `restart_count` is untouched. This sprint adds a record, nothing else.
4. Make sure the record is written exactly once regardless of which of the three
   `SHUTTING_DOWN` guards breaks the loop, and that a signal arriving before the
   first child spawns (no `start_epoch`) doesn't produce a malformed record.
5. Add the captured parent-chain snapshot to the record as a new optional field
   (e.g. `signalContext`), and confirm `_svsup_append_death`'s python writer emits
   valid JSON when that field contains quotes or newlines.
6. Add tests to `scripts/lib/serve-supervised.test.sh`: a TERM'd supervisor writes
   one record with `reason: "signalled"` and the right signal name; the record is
   valid JSON; a health-timeout death still writes `reason: "health-timeout"`
   (no regression); no duplicate records.
7. Verify the dashboard's death list tolerates the new reason — read
   `apps/dashboard/src/lib/api-history.ts` and its consumer; if it switches on
   reason strings, add the case.

## Files involved
- `scripts/serve-supervised.sh` — signal handler captures context; shutdown path appends a death record
- `scripts/lib/serve-supervised-lib.sh` — `_svsup_append_death` gains the optional `signalContext` field
- `scripts/lib/serve-supervised.test.sh` — new coverage for the signalled path
- `apps/dashboard/src/lib/api-history.ts` — only if it enumerates reason values
- `docs/DEV-SERVER-SUPERVISOR.md` — document the `signalled` reason and what it means

## Acceptance criteria
- [ ] `kill -TERM` on a running supervisor appends exactly one `.server-deaths.jsonl` record with `reason: "signalled"` and `signal: "TERM"`
- [ ] The supervisor still exits without restarting after a signal (unchanged behavior)
- [ ] A health-timeout death still writes `reason: "health-timeout"` — no regression
- [ ] Every record remains valid JSON, including when `signalContext` contains quotes or newlines
- [ ] New tests in `scripts/lib/serve-supervised.test.sh` cover the signalled path, the no-duplicate case, and the health-timeout regression
- [ ] `pnpm test:hooks` passes
- [ ] `pnpm typecheck` and `pnpm lint` pass if any TypeScript was touched

## Out of scope
- Changing whether a signalled supervisor restarts — that is sprint 322's problem, solved outside the supervisor
- Identifying the specific sender of the 2026-09-07 SIGTERM (the logs no longer retain it)
- The SIGKILL orphan-port problem — sprint 325
- Any change to how `health-timeout` or `exited` deaths are detected
