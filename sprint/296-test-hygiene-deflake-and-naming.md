# De-flake the init-deploy subprocess test and fix two inverted assertion names
**Difficulty:** 2

> _Promoted from backlog: sprint-269 and sprint-288 follow-ups, 2026-08-21._

## Goal
`init-deploy.test.ts` no longer depends on a cold `npx tsx` compile finishing
inside a timeout, and the two `check_false` assertions in the gate suite read as
what they actually guarantee.

## Reason
Two small test-quality items, both filed as follow-ups and both cheap.

**The flake:** `apps/cli/src/commands/init-deploy.test.ts:138` shells out to
`npx tsx` to run the real CLI entrypoint, then races that subprocess's cold
compilation against a timeout. Sprint 269 bumped the timeout to 30s as a
band-aid and filed this. Fixed timeouts around cold starts are exactly the
failure shape that bit this repo twice already this month — sprints 292's SIGPIPE
regression and the `hook-signals`/`use-ops-chat` flakes all traced to timing
assumptions that hold on an idle machine and break under load.

**The naming:** `scripts/lib/deploy-unattended-gate.test.sh` has two assertions
named as affirmative claims but implemented with `check_false`:
`".deploy-status.json created on blocked push"` and the `.deploy-history.jsonl`
equivalent. The assertions are *correct* — they verify the files are **not**
created — but the passing output states the opposite of the guarantee. A reader
scanning green output sees "created on blocked push" and concludes the gate
writes a record when it must not.

## Context
- `apps/cli/src/commands/init-deploy.test.ts:138` uses
  `execaSync('npx', ['tsx', join(__dirname, '..', 'index.ts'), 'init-deploy', ...])`.
  The comment at line 148 documents the cold-start cost (~3s idle, much worse
  under load).
- Two viable directions, pick one and say why: **pre-warm** (build once, invoke
  the built entrypoint instead of compiling per-test) or **mock** (call the
  command's exported function directly rather than spawning a process at all).
  Mocking is cheaper but tests less; note the tradeoff in the sprint's Completed
  section.
- `apps/cli/dist` already exists as a build artifact — if you pre-warm, prefer
  reusing the normal build rather than inventing a second build path.
- `check_false()` in `scripts/lib/deploy-unattended-gate.test.sh` is
  `if "${@:2}"; then no "$1 (expected false)"; else ok "$1"; fi` — it passes when
  the command fails. Only the two assertion *names* need changing; the
  assertions themselves are right. Do not weaken them.
- The four `toHaveBeenCalledTimes` assertions in
  `apps/dashboard/src/lib/use-sse-stream.test.ts` are **not** in scope: there the
  delivered-event count is the assertion, so relaxing them would drop coverage.

## Tasks
1. Remove the cold-compile race in `init-deploy.test.ts` — pre-warm or mock, your
   call. Record which you chose and why.
2. Drop or sharply reduce the 30s band-aid timeout once the race is gone; a test
   that no longer compiles shouldn't need 30s.
3. Rename the two `check_false` assertions in
   `scripts/lib/deploy-unattended-gate.test.sh` so the passing output states the
   guarantee (e.g. `"no .deploy-status.json created on blocked push"`).
4. Grep both suites for any other assertion whose name reads as the inverse of
   what it checks, and fix those too.
5. Run the affected suites repeatedly **under load** to confirm the flake is
   gone — a single green run proves nothing about a timing race.

## Files involved
- `apps/cli/src/commands/init-deploy.test.ts` — remove the cold-compile race
- `scripts/lib/deploy-unattended-gate.test.sh` — assertion names only

## Acceptance criteria
- [x] `init-deploy.test.ts` no longer spawns a cold `npx tsx` compile in its hot
      path, and its timeout is reduced accordingly
- [x] The blue-green init-deploy case passes 5 consecutive runs under concurrent
      CPU load, not just once idle
- [x] No assertion in `scripts/lib/deploy-unattended-gate.test.sh` is named as
      the inverse of what it verifies; the assertions themselves are unchanged
- [x] `pnpm test:hooks` still reports the same number of passing gate assertions
      as before (renames only, no coverage lost)
- [x] `pnpm test`, `pnpm lint`, `pnpm typecheck` green

## Out of scope
- `use-sse-stream.test.ts`'s exact-count assertions — see Context.
- Any behavior change to `init-deploy` itself or to the unattended gate.
- A broader test-suite audit; these are two named items.

## Completed

**Date:** 2026-08-23

### Summary
Chose **pre-warm** over mocking for the `init-deploy.test.ts` race: a `beforeAll`
now bundles the CLI once via the same `node apps/cli/esbuild.mjs` script `nx run
cli:build` uses (no second build path invented), and the subprocess test invokes
the resulting `dist/index.js` directly with `node` instead of `npx tsx
index.ts`. Pre-warm was picked over mocking because the test's whole point is
exercising the *real* CLI entrypoint end-to-end (arg parsing, service
detection, file scaffolding) — calling the exported action function directly
would have dropped that coverage. The tradeoff: this test now depends on the
CLI bundle being buildable, but `beforeAll` rebuilds it fresh every run (esbuild
bundling this entrypoint takes ~0.1s), so there's no risk of the stale-`dist`
trap noted in project memory. Timeout dropped from 30s to 10s — generous
headroom for a `node` process start plus in-memory work, no compile step left
to race.

Verified the flake is actually gone, not just theoretically: ran the suite 5
consecutive times while all 16 cores were pinned by background `yes` loops —
every run passed in well under a second (320–460ms for all 7 tests combined),
down from a fixed-timeout race that needed 30s of headroom.

For the naming fix, grepped every `check_false`/`check_true`/`case`-based
assertion in `deploy-unattended-gate.test.sh` (34 total). Only two were
actually inverted: the two file-existence checks at what are now lines
171–172, renamed from `".deploy-status.json created on blocked push"` /
`".deploy-history.jsonl created on blocked push"` to `"no ... created on
blocked push"`. Every other `check_false` in the file already phrases its name
as the negative outcome it verifies (`"not blocked: ..."`, `"... reports
none"`, `"... never skips"`), so nothing else needed touching. Confirmed
`deploy-plan.test.sh` and `deploy-path-filter.test.sh` are out of scope per the
sprint's own Files-involved/Out-of-scope sections and left them alone.

### Files changed
- `apps/cli/src/commands/init-deploy.test.ts` — pre-warm the CLI bundle once in
  `beforeAll`, invoke `node dist/index.js` instead of `npx tsx index.ts`, drop
  the 30s timeout to 10s
- `scripts/lib/deploy-unattended-gate.test.sh` — renamed the two inverted
  `check_false` assertion names; assertions themselves unchanged

### Verification
- `init-deploy.test.ts` under `yes`-loop CPU load on all 16 cores, 5 consecutive
  runs: 7/7 passing each time, 320–461ms per run
- `pnpm test:hooks`: gate suite reports 34 passed, 0 failed (same count as
  before the rename); full hooks run 76/76 passed, 0 failed
- `pnpm test`: 42 test files, 356 tests, all passing
- `pnpm lint`: clean across all 5 projects
- `pnpm typecheck`: clean across all 5 projects

### Follow-ups
- `[defer]` Nx flagged `core:test` as a "flaky task" in two separate `pnpm
  test` runs during verification (unrelated to this sprint's files — core
  isn't touched here). Worth a look if it recurs, but not a blocker for this
  change.
