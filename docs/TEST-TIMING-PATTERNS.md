# Test timing patterns

How to write a timing-dependent assertion in this repo without it becoming a
flake under load. Read this before adding a new `sleep`, timeout, or
call-count assertion to a test suite — and extend it, don't duplicate it, the
next time a sweep like this one runs.

## The three classes

Every timing-dependent assertion found in a sweep falls into one of three
buckets:

- **race** — a deadline competing with real work (a fixed `sleep` "long
  enough" for a subprocess to be ready, a wall-clock comparison against a
  budget with no margin). These fail under load and must be fixed.
- **ceiling** — a bound that's never actually reached in practice (e.g.
  `sleep 30` as a background placeholder process that gets `kill -9`'d well
  before 30s). Safe to leave; note why it's a ceiling and not a deadline so
  the next sweep doesn't re-flag it.
- **contract** — the count or duration *is* the thing under test (e.g.
  `use-sse-stream.test.ts`'s `toHaveBeenCalledTimes(2)` for delivered SSE
  events). Keep the assertion; make the timing deterministic around it
  instead of relaxing it.

## Two repair patterns for `race` sites

**1. Sentinel handshake.** Replace "sleep long enough for the subprocess to
be ready" with "the subprocess touches a file when it's actually ready; the
poller waits for that file with a generous bounded retry count." Reference
implementation: `_start_fake_phase` / `_wait_phase_ready` / `_wait_until` in
`scripts/lib/hook-signals.test.sh` and `scripts/lib/deploy-liveness.test.sh`.
Reuse those helpers rather than writing a third variant — every shell suite
in this repo that needs to wait on a background process should call into
them.

**2. Assert the guarantee, not the incidental count.** If a test only cares
that something eventually happened, `toHaveBeenCalledTimes(1)` overshoots
under load — a slow render tick can retry and the count climbs past 1 for
reasons that have nothing to do with correctness. Use
`toHaveBeenCalled()`/`waitFor(...)` instead. Reference:
`apps/dashboard/src/lib/use-ops-chat.test.ts` (`d90a11e`).

**Counter-example — do not over-apply pattern 2.** The four
`toHaveBeenCalledTimes` assertions in
`apps/dashboard/src/lib/use-sse-stream.test.ts` are deliberately exact: the
delivered-event count *is* the assertion there. Relaxing them would silently
drop coverage. Before relaxing a count assertion, ask whether the count is
the contract or just the easiest thing to assert — if it's the contract,
leave it and fix the timing around it instead (see below).

## Making the timing deterministic instead

- **Vitest fake timers** (`vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync`)
  for pure polling/retry logic with an injected clock dependency — nothing
  real needs to elapse, so the test runs in milliseconds and is immune to
  scheduler noise. Reference: `packages/core/src/db-url-connect.test.ts`'s
  `waitUntilReady` retry-until-timeout case.
- **Sub-second clock instead of `date +%s`** for shell-suite elapsed-time
  assertions. `date +%s` truncates to whole seconds, so any comparison tuned
  against a same-magnitude deadline (e.g. "returns before a 4s fake operation
  finishes") has effectively zero real margin — a few hundred ms of
  unrelated startup overhead crossing a second boundary is enough to flip
  the result. `python3 -c 'import time; print(time.time())'` is already a
  hard dependency of these suites (used for JSON parsing) and gives
  millisecond resolution for free. Reference:
  `scripts/lib/deploy-detached.test.sh`'s `--no-wait` case.
- **Widen the margin, not just the bound.** If tightening the clock isn't
  enough on its own, widen the *thing being raced against* (e.g. the fake
  push duration) by multiple seconds rather than nudging the comparison
  operator by one unit — `-lt 4` → `-lt 5` keeps the zero-margin design and
  only delays the next failure. Pair it with the sub-second clock fix so the
  margin is real, not just relocated.

## Sweep scope and date

**2026-08-23, sprint 303** — repo-wide sweep of every shell suite
(`scripts/lib/*.test.sh`) and vitest suite (`packages/*`, `apps/*`) for
`sleep`, `date +%s`, `Date.now`, `setTimeout`, `toHaveBeenCalledTimes`,
`-lt`/`-gt` against elapsed values, and literal timeout/interval argument
pairs. Two `race` sites were found and fixed
(`db-url-connect.test.ts > waitUntilReady`, `deploy-detached.test.sh`'s
`--no-wait` case — both described above). Every other timing-dependent site
found was already a `ceiling` (background placeholder processes killed
before their sleep matters — `hook-signals.test.sh`, `deploy-liveness.test.sh`)
or a `contract`/non-race (deterministic fixture timestamps built from a
single `Date.now()` read with minutes-to-hours of offset margin, or
`toHaveBeenCalledTimes` assertions against synchronously-mocked dependencies
with no real clock involved — `gate-doctor.test.ts`, `secrets-sync.test.ts`,
`rollback.test.ts`, `provision.test.ts`, `secrets-scaffold.test.ts`,
`use-project-detail.test.ts`, and the `Date.now()`-fixture tests under
`apps/dashboard/src/components/detail/` and `apps/api/src/routes/`). Both
fixes were verified 10/10 consecutive runs under induced load (12
self-terminating CPU burners pinning all 16 cores), run directly rather than
through Nx so no cache was ever in the path.

The next sweep should re-run the same grep list above rather than trusting
this doc's site list to still be exhaustive — new tests get added between
sweeps.
