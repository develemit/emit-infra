# Repo-wide sweep for fixed-timing test assertions
**Difficulty:** 3

> _Promoted from backlog: the 2026-08-22 and 2026-08-23 infra findings plus the sprint-296 follow-up, 2026-08-22._

## Goal
Every test assertion in this repo that races a wall-clock deadline against real
work is either rewritten to be deterministic or given a margin that survives a
fully loaded machine — and the sweep is recorded so the next one starts from a
list, not from an incident.

## Reason
This is the **fourth** fixed-timing flake filed this month, and the pattern is
now clear enough to fix as a class rather than one incident at a time:

| # | Site | Status |
|---|------|--------|
| 1 | `scripts/lib/hook-signals.test.sh` — 5× `sleep 0.5` racing a subprocess | fixed (`f69168b`, sentinel-file handshake) |
| 2 | `apps/dashboard/src/lib/use-ops-chat.test.ts` — `toHaveBeenCalledTimes(1)` overshooting under load | fixed (`d90a11e`) |
| 3 | `packages/core/src/db-url-connect.test.ts > waitUntilReady` | **open** |
| 4 | `scripts/lib/deploy-detached.test.sh:213` | **open** |

Sprint 296 fixed a fifth of the same shape (`init-deploy.test.ts`'s cold-compile
race). Each was found by a *different* sprint's spot-check, at a cost of a full
investigation each time. A single pass over the suites is cheaper than five more
of those, and it converts an intermittent red into a known, bounded list.

Nx has independently corroborated one of them: `core:test` was flagged as a
"flaky task" in two separate `pnpm test` runs during sprint 296's verification.

## Context

### The two open sites, with their exact failure mechanics

**`packages/core/src/db-url-connect.test.ts:15-21`** — "retries until the
timeout, then throws with the last error":
```ts
const query = vi.fn().mockRejectedValue(new Error('connection refused'))
await expect(waitUntilReady(fakePool(query), 30, 10)).rejects.toThrow(...)
expect(query.mock.calls.length).toBeGreaterThan(1)
```
A 30ms budget with a 10ms interval leaves room for ~3 attempts on an idle
machine. Under a parallel `nx run-many -t test`, a single event-loop turn can
easily exceed 30ms, so the *first* attempt is also the last and
`calls.length > 1` fails. The 30/10 numbers are the whole problem: they are
small enough to be swamped by scheduler noise. Note the sibling test at line 23
(`succeeds after transient failures`) asserts `calls === 3` against a 1000ms
budget — much more margin, but the same class.

**`scripts/lib/deploy-detached.test.sh:207-216`**:
```bash
NOWAIT_ELAPSED=$(( $(date +%s) - NOWAIT_START ))
if [[ $NOWAIT_ELAPSED -lt 4 ]]; then
```
This asserts `--no-wait` returns before a 4s fake push finishes, using
second-granularity `date +%s` with **zero margin**. The `--no-wait` path itself
spawns node (`classify-run-state.mjs`, sprint 289), so under the full
`test:hooks` chain its own startup pushes elapsed to exactly 4 and the
comparison fails. 4/4 passes in isolation, which is why it reads as a mystery
flake rather than a design flaw.

### Other timing-sensitive sites already known to exist
Do not assume this list is complete — the sweep is the point — but these are
the ones already visible:
- `scripts/lib/deploy-liveness.test.sh:97` — `sleep 2.1` with the comment
  "ISO-8601 timestamps here are second-resolution". Sleeping just past a
  second boundary is the same zero-margin shape.
- `scripts/lib/deploy-liveness.test.sh:133` — a comment describing the
  refresher's `6x(kill -0 + sleep 5)` polling loop before its first refresh;
  anything asserting against that window inherits the loop's granularity.
- `scripts/lib/deploy-liveness.test.sh:163`, `scripts/lib/hook-signals.test.sh:61`
  — `sleep 30` in fake background phases. These are *ceilings*, not deadlines
  (the process is killed before the sleep matters), so they are almost
  certainly fine — confirm rather than "fix" them.

### The two repair patterns already proven in this repo
1. **Sentinel handshake** (`hook-signals.test.sh`, `f69168b`): replace "sleep
   long enough for the subprocess to be ready" with "subprocess touches a file
   when ready; poller waits for the file, with a generous bounded retry count".
   The helpers are `_start_fake_phase` / `_wait_phase_ready` / `_wait_until` —
   reuse them rather than writing a third variant.
2. **Assert the guarantee, not the incidental count** (`use-ops-chat.test.ts`,
   `d90a11e`): `toHaveBeenCalledTimes(1)` → `toHaveBeenCalled()` where the
   count was never the contract.

**Counter-example — do not over-apply pattern 2.** The four
`toHaveBeenCalledTimes` assertions in
`apps/dashboard/src/lib/use-sse-stream.test.ts` are deliberately exact: there
the delivered-event count *is* the assertion. Relaxing them silently drops
coverage. When a count is the contract, keep it and fix the timing instead.

### Vitest fake timers
For the `waitUntilReady` case, `vi.useFakeTimers()` is the deterministic
answer — the function under test is pure polling logic with an injected pool,
so nothing real needs to elapse. Prefer that over "make the numbers bigger",
which only moves the flake further out. Bigger numbers are the fallback when
faking timers would require mocking something load-bearing.

## Tasks
1. **Sweep.** Enumerate every timing-dependent assertion across the repo's
   suites — shell (`scripts/lib/*.test.sh`), vitest (`packages/*`, `apps/*`).
   Search at minimum for: `sleep`, `date +%s`, `Date.now`, `setTimeout`,
   `toHaveBeenCalledTimes`, `-lt`/`-gt` against elapsed values, and any literal
   timeout/interval argument pair. Write the list into the sprint's Completed
   section as a table with a verdict per site.
2. **Classify each site** as one of:
   - **race** — a deadline competing with real work; must be fixed.
   - **ceiling** — a bound that is never actually reached (e.g. `sleep 30` in a
     process that gets killed); leave alone, note why.
   - **contract** — the count/duration *is* the thing under test; keep the
     assertion, make the timing deterministic instead.
3. **Fix `db-url-connect.test.ts > waitUntilReady`** using fake timers if
   feasible; otherwise give the budget enough margin that a 10× scheduler stall
   still passes, and say which you chose and why.
4. **Fix `deploy-detached.test.sh:213`.** Second-granularity `date +%s` cannot
   express "well under 4s" — either widen the fake push's duration so the margin
   is multiple seconds, or switch to a sub-second clock. Do not simply relax the
   bound to `-lt 5`; that keeps the zero-margin design and just delays the next
   failure.
5. **Repair any other `race` sites** the sweep turns up, using the two proven
   patterns above.
6. **Verify under load, not idle.** An idle-machine pass proves nothing here —
   every one of these flakes passes 4/4 in isolation. Run the affected suites
   repeatedly with the machine saturated. Precedent from the earlier fixes:
   spawn CPU burners (**self-terminating** ones — a previous run orphaned 16 of
   them), then run the suites ≥10× with `--skip-nx-cache`. Nx caching will
   otherwise serve you a cached green and prove nothing.
7. **Record the sweep** so the next one is incremental: leave a short note in
   `docs/` (or extend an existing testing doc if one fits) naming the two
   patterns, the counter-example, and the date/scope of this sweep.

## Out of scope
- Rewriting suites for reasons other than timing.
- Changing production behaviour of anything under test. If a fix seems to
  require a source change, stop and file it rather than widening the sprint.
- The `use-sse-stream.test.ts` exact counts (see counter-example above).
- Test flakes in *other* repos (emit-vision's 5000ms default timeout under load,
  develemail's 9 failing e2e-smoke tests) — those are separately filed.

## Acceptance criteria
- The sweep table exists in the Completed section, with every timing-dependent
  site in the repo classified `race` / `ceiling` / `contract`.
- Both open flakes (`db-url-connect.test.ts > waitUntilReady`,
  `deploy-detached.test.sh:213`) are fixed, and the fix is explained in terms of
  *why the race is gone*, not "it passes now".
- Every `race` site found by the sweep is either fixed or explicitly deferred
  with a reason.
- The affected suites pass ≥10 consecutive runs **under induced load** with
  `--skip-nx-cache`. Record the load method and the pass count.
- No CPU burners left running after verification.
- `pnpm test` and the shell suites are green repo-wide; assertion counts are
  unchanged or higher, never lower.

## Completed

**Date:** 2026-08-23

### Summary
Swept every shell suite (`scripts/lib/*.test.sh`) and every vitest suite
(`packages/*`, `apps/*`) for `sleep`, `date +%s`, `Date.now`, `setTimeout`,
`toHaveBeenCalledTimes`, `-lt`/`-gt` against elapsed values, and literal
timeout/interval pairs. Found exactly the two `race` sites the sprint named
— no additional races turned up — plus a long tail of `ceiling` and
`contract` sites that were already sound or already fixed by prior sprints.

**`db-url-connect.test.ts > waitUntilReady`** (race → fixed): switched the
"retries until the timeout" case to `vi.useFakeTimers()` +
`vi.advanceTimersByTimeAsync(30)`. The function under test is pure polling
logic against an injected `Queryable`, so nothing real needs to elapse —
faking the clock makes every tick deterministic regardless of what else the
machine is doing, rather than hoping a 30ms/10ms budget survives a scheduler
stall. Wrapped in try/finally so a timers leak can't survive an assertion
failure. Runtime dropped from a real 30ms (previously racy) to ~instant.

**`deploy-detached.test.sh`'s `--no-wait` case** (race → fixed): two
independent fixes, per the sprint's guidance not to just relax the bound.
(1) Replaced `date +%s` (whole-second truncation) with
`python3 -c 'import time; print(time.time())'` for millisecond resolution —
python3 is already a hard dependency of these suites for JSON parsing, so no
new tool. (2) Widened the fake push from 4s to 8s and the pass/fail line from
`-lt 4` (seconds) to `-lt 4000` (milliseconds), so the comparison sits
multiple seconds away from realistic launcher overhead (preflight's node
cold-start) instead of immediately adjacent to it. Real observed elapsed
across verification runs: 700–900ms, comfortably inside the new margin.

Both fixes and the sweep's reasoning are also recorded in
`docs/TEST-TIMING-PATTERNS.md` (new) so the next sweep starts from a
documented baseline instead of rediscovering the same two patterns.

### Sweep table

| Site | Verdict | Note |
|---|---|---|
| `packages/core/src/db-url-connect.test.ts` — `waitUntilReady` "retries until the timeout" (30ms/10ms) | **race → fixed** | `vi.useFakeTimers()` + `advanceTimersByTimeAsync`; see Summary |
| `scripts/lib/deploy-detached.test.sh` — `--no-wait` returns before fake push finishes | **race → fixed** | sub-second clock + widened margin; see Summary |
| `packages/core/src/db-url-connect.test.ts` — "succeeds after transient failures" (1000ms budget/5ms poll, `calls === 3`) | contract | ~990ms of real slack around ~10ms of actual work; not a realistic race, left as-is |
| `apps/dashboard/src/lib/use-sse-stream.test.ts` — `toHaveBeenCalledTimes(1\|2)` | contract | delivered-event count *is* the assertion (documented counter-example, out of scope) |
| `apps/dashboard/src/lib/use-ops-chat.test.ts` — `toHaveBeenCalled()` | contract, already fixed | pattern-2 fix from `d90a11e`; confirmed still intact |
| `apps/cli/src/commands/{gate-doctor,secrets-sync,rollback,provision,secrets-scaffold}.test.ts`, `apps/dashboard/src/lib/use-project-detail.test.ts` — various `toHaveBeenCalledTimes(N)` | contract | counts against synchronously-mocked deps (`execa`, `sshExec`, `runTerraform`, `setConfigField`, `getStatus`); no real clock or retry loop involved, count is exact by construction |
| `scripts/lib/hook-signals.test.sh:61`, `scripts/lib/deploy-liveness.test.sh:163` — `sleep 30` in fake background phases | ceiling | placeholder process killed well before 30s; process lifetime, not a deadline |
| `scripts/lib/deploy-liveness.test.sh:97` — `sleep 2.1` before comparing second-resolution heartbeat timestamps | ceiling | 2.1s sleep guarantees crossing ≥2 whole-second boundaries no matter the jitter — real margin, not zero-margin despite reading like one |
| `scripts/lib/deploy-liveness.test.sh:133-152` — real 30s heartbeat timer, polled via `_wait_until` with a 90s ceiling | ceiling | already the sentinel-poll pattern; comment explicitly documents why a fixed sleep would be wrong |
| `scripts/lib/deploy-detached.test.sh:220-224, 241-245, 249-254` — `NOWAIT_DEADLINE`/`READY_DEADLINE`/`DEADLINE` poll loops (20s/15s/25s) | ceiling | bounded polls for an eventual condition (remote head lands, marker file appears), not tight deadlines |
| `apps/dashboard/src/lib/use-backup-polling.test.ts`, `apps/dashboard/src/lib/date-helpers.test.ts`, `apps/api/src/lib/claude-session.test.ts` | deterministic (fake timers) | `vi.useFakeTimers()` mocks `Date` too; `Date.now()` calls inside these tests read the frozen fake clock, not the real one — already correct |
| `apps/dashboard/src/components/detail/{backup-panel,container-row,pipeline-progress-card,incident-panel,health-card}.test.tsx`, `apps/api/src/routes/{incidents-export,fleet}.test.ts` — `Date.now()`-based fixture timestamps (offsets of minutes to a day) | not a race | single `Date.now()` read used to build a static fixture value, no polling loop or comparison against elapsed *test-execution* time; margins are minutes-to-hours, immune to scheduler jitter |

No `race` sites were found beyond the two named in the sprint. No sites were
deferred.

### Files changed
- `packages/core/src/db-url-connect.test.ts` — `waitUntilReady` retry-until-timeout
  case now uses fake timers instead of a real 30ms budget
- `scripts/lib/deploy-detached.test.sh` — `--no-wait` case uses a sub-second
  python3 clock and an 8s fake push with a 4000ms bound instead of `date +%s`
  against a 4s push
- (new) `docs/TEST-TIMING-PATTERNS.md` — the two repair patterns, the
  counter-example, and this sweep's scope/date, for the next sweep to build on

### Verification
- `packages/core/src/db-url-connect.test.ts` under 12 self-terminating CPU
  burners pinning all 16 cores (`bash -c 'end=$(($(date +%s)+N)); while
  [ "$(date +%s)" -lt "$end" ]; do :; done'`, invoked directly via `npx
  vitest run`, no nx cache in the path): 10/10 runs, 8/8 tests passing each
  time
- `scripts/lib/deploy-detached.test.sh` under the same load (invoked directly
  via `bash`, no nx cache in the path): 10/10 runs, 25/25 assertions passing
  each time; `--no-wait` elapsed observed at 700–900ms per run, well inside
  the new 4000ms bound
- All CPU burners self-terminated on their own budget and were also
  explicitly `kill`ed after each batch; `ps aux | grep "date +%s"` empty
  after verification
- `pnpm test:hooks`: 59 assertions passed, 0 failed (34 in the unattended
  gate + 25 in deploy-detached — unchanged from before this sprint)
- `pnpm test --skip-nx-cache`: 42 test files, 356 tests, all passing
  (`db-url-connect.test.ts` 8/8 in 20ms, down from a real ~30ms race)
- `pnpm typecheck`: clean across all 5 projects
- `pnpm lint`: clean across all 5 projects

### Follow-ups
- `[defer]` `scripts/lib/deploy-detached.test.sh`'s `--no-wait` case now
  takes ~8s of wall time (up from ~4s) because of the widened fake push.
  `test:hooks` overall runtime grew accordingly. Worth revisiting if the
  suite's total runtime becomes a nuisance, but correctness over speed was
  the right tradeoff here per the sprint's own guidance.
- `[defer]` sprint 296 saw Nx flag `core:test` as a "flaky task" twice during
  its verification and deferred it. This sprint's `pnpm test --skip-nx-cache`
  run did not reproduce that flag, and `db-url-connect.test.ts` (the file
  most likely to have been the source, given this sprint's fix) passed 10/10
  under induced load. Not fully ruled out, but no evidence of it recurring —
  leaving the sprint-296 follow-up as the tracking item rather than opening a
  new one.
