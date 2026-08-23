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
- [ ] `init-deploy.test.ts` no longer spawns a cold `npx tsx` compile in its hot
      path, and its timeout is reduced accordingly
- [ ] The blue-green init-deploy case passes 5 consecutive runs under concurrent
      CPU load, not just once idle
- [ ] No assertion in `scripts/lib/deploy-unattended-gate.test.sh` is named as
      the inverse of what it verifies; the assertions themselves are unchanged
- [ ] `pnpm test:hooks` still reports the same number of passing gate assertions
      as before (renames only, no coverage lost)
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` green

## Out of scope
- `use-sse-stream.test.ts`'s exact-count assertions — see Context.
- Any behavior change to `init-deploy` itself or to the unattended gate.
- A broader test-suite audit; these are two named items.
