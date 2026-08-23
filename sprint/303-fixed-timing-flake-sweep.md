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
