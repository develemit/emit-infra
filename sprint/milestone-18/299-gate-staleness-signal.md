# Surface when a push gate hasn't been exercised while commits pile up
**Difficulty:** 3

## Goal
`emit-infra status` says when a project's push gate has gone unexercised while
unpushed commits accumulated — the condition that let tastease reach 102
commits on a gate that could not pass.

## Reason
Sprint 298's doctor answers "is this gate runnable?" when you run it. This
sprint answers the question nobody thought to ask: **"has anyone run it
lately?"** That's the gap that turned tastease's one-line config error into a
blocked deploy — the gate was broken for 9 days and 102 commits, and the only
thing that would have surfaced it was someone happening to push.

The signal has to be chosen carefully, because the obvious one is wrong.
Measured 2026-08-22:

| project | unpushed | `origin/main` age | gate `test` under hook conditions |
|---|---|---|---|
| develemail | 51 | 3 weeks | **passes** |
| diner-decider | 98 | 3 weeks | **fails** |
| emit-billing | 15 | 9 days | failed; fixed in `a6df8f0` |
| emit-social / emit-vision / tastease | 0–1 | hours | pass |

develemail has 51 unpushed commits and a perfectly healthy gate. Warning on
commit count alone would cry wolf on the fleet's most normal state — a project
mid-backlog — and get muted, which is worse than no warning. The useful signal
is *staleness of the last gate run relative to accumulating work*, not the work
itself.

## Context
- `.ci-status.json` already records every gate run: `status`
  (`running`/`success`/`failure`), `sha`, `branch`, `startedAt`, and on
  terminal records `completedAt`. It is written by `ci_init`/`ci_step`/`ci_done`
  in `scripts/lib/ci-utils.sh` — by the hook *and* by every project's own
  `scripts/ci.sh`, all four of which source that same lib. So a local `ci.sh`
  run counts as exercising the gate, which is the behaviour you want.
- Sprint 283 added `writer{pid,host,heartbeatAt}` to in-flight records; sprint
  290 added `launch{mode,marker}`. Terminal records drop `writer`.
- Sprint 284's `classifyRunState` in `packages/core/src/deploy-status.ts`
  already turns a record into `idle | running | orphaned | unknown`. **Reuse
  it**; do not write a second staleness heuristic — that is exactly what 284
  exists to prevent.
- Sprint 289 added `scripts/lib/classify-run-state.mjs`, a thin Node wrapper so
  bash callers get the same verdict. Follow that precedent if a shell caller
  needs this.
- `apps/cli/src/commands/status.ts` already prints a "Local pipeline" section
  (added in sprint 284) showing CI and deploy classification. That is the
  natural home for this — extend it rather than adding a new command.
- Unpushed count is `git rev-list --count origin/main..HEAD`. Note it requires
  an up-to-date remote ref; decide whether to `git fetch` (slow, network) or
  read the possibly-stale local ref and say which you did.
- A project with **no** `.ci-status.json` at all has never run the gate. That
  is a distinct and stronger signal than a stale one — don't collapse them.

## Tasks
1. Decide the rule and write down the reasoning. Suggested shape: warn when
   unpushed commits exist **and** the newest `.ci-status.json` is either absent,
   older than the newest unpushed commit, or not `success`. Deliberately do not
   key on commit count alone.
2. Implement it in `packages/core` next to `classifyRunState`, so the CLI and
   anything else share one implementation.
3. Surface it in `apps/cli/src/commands/status.ts`'s existing Local pipeline
   section — state how many commits are unpushed and when the gate last ran
   successfully, or that it never has.
4. Handle the edge cases explicitly: no `.ci-status.json`; a `failure` record;
   a `running` record that sprint 284 would classify `orphaned`; and a project
   with no unpushed commits (say nothing — silence is correct there).
5. Be honest about the remote ref: either fetch, or state that the comparison
   is against the last-known `origin/main`.
6. Unit-test the rule against the real fleet shapes measured above — 51
   unpushed with a recent success (quiet), 98 unpushed with a stale record
   (warn), 15 unpushed with no record at all (warn louder), 0 unpushed (quiet).

## Files involved
- new file: `packages/core/src/gate-staleness.ts` — the rule
- new file: `packages/core/src/gate-staleness.test.ts` — coverage for task 6
- `packages/core/src/index.ts` — export it
- `apps/cli/src/commands/status.ts` — surface it in the Local pipeline section
- `apps/cli/src/commands/status.test.ts` — cover the new output

## Acceptance criteria
- [x] A project with unpushed commits and a recent successful gate run produces
      **no** warning — asserted by a test using develemail's shape (51 unpushed,
      healthy)
- [x] A project with unpushed commits and a stale or failed gate record warns —
      asserted by a test using diner-decider's shape
- [x] A project with unpushed commits and **no** `.ci-status.json` warns
      distinctly from the merely-stale case
- [x] A project with no unpushed commits produces no output
- [x] The staleness rule lives in one place in `packages/core` and reuses
      sprint 284's `classifyRunState` rather than reimplementing staleness
- [x] `emit-infra status` states whether the comparison used a fetched or a
      cached `origin/main`
- [x] Test coverage in `packages/core/src/gate-staleness.test.ts` for all four
      fleet shapes in task 6
- [x] `pnpm test`, `pnpm lint`, `pnpm typecheck` green; `apps/cli/dist` rebuilt

## Out of scope
- **Running the gate.** This sprint reports on records that already exist;
  proving a gate runnable is sprint 298's job.
- Blocking or failing anything on staleness. This is a report, not a gate — an
  advisory that stops a push would be a worse version of the problem.
- Dashboard rendering of the signal. CLI first; a dashboard surface can be
  proposed once the rule has proven itself non-noisy.
- Auto-fetching on a schedule, or any background process.

## Completed

**Date:** 2026-08-23

### Summary
Added `evaluateGateStaleness` in `packages/core`, a pure function that turns
`{unpushedCount, newestUnpushedCommitAt, ciRecord}` into a warn/quiet verdict.
It reuses `classifyRunState` (sprint 284) rather than reimplementing
staleness: a terminal record's `state` is `idle` regardless of success or
failure, so the actual outcome is read off `record.status`; an in-flight
record that `classifyRunState` calls `orphaned` or `unknown` is treated the
same as a failed run (it never demonstrably completed), while a genuinely
`running` record is quiet — the gate is being exercised right now. A missing
record (`never-run`) is kept as a reason distinct from `stale` per the
sprint's edge-case requirement, since "never run" is a stronger signal than
"ran once, a while ago."

`apps/cli/src/commands/status.ts`'s existing "Local pipeline" section now
runs `git log origin/main..HEAD --format=%cI` to get both the unpushed count
and the newest unpushed commit's timestamp in one shell-out, feeds that plus
the already-read `.ci-status.json` record into `evaluateGateStaleness`, and
prints a `Push gate:` line — colored yellow when `warn` is true, dim
otherwise — only when there are unpushed commits (silence when there are
none, per the sprint's explicit edge case). The line always states it
compared against a cached `origin/main`, never fetching: `status` is meant to
stay a fast, no-network local check, and fetching would add latency to every
invocation for a comparison that's advisory, not authoritative. That decision
is documented in a comment at the call site.

### Files changed
- (new) `packages/core/src/gate-staleness.ts` — `evaluateGateStaleness`, the staleness rule
- (new) `packages/core/src/gate-staleness.test.ts` — 7 tests covering the four fleet shapes plus running/orphaned-in-flight edges
- `packages/core/src/index.ts` — export `evaluateGateStaleness` and its types
- `apps/cli/src/commands/status.ts` — gather unpushed-commit git info, surface the verdict as a `Push gate:` line in the Local pipeline section
- `apps/cli/src/commands/status.test.ts` — 3 tests for `formatGateStalenessLine`

### Verification
- `pnpm test`: 356/356 pass (api), plus core (15 files incl. the new 7 gate-staleness tests) and cli (18 files incl. the new 9 status tests) all green — full `nx run-many -t test` reports success across all 4 test projects
- `pnpm lint`: clean across all 5 projects
- `pnpm typecheck`: clean across all 5 projects
- `pnpm nx run cli:build`: rebuilt `apps/cli/dist` after the source changes
- Manual check: ran the real git-info + `evaluateGateStaleness` wiring against this repo's own 174 unpushed commits (emit-infra has no `.ci-status.json`) — correctly produced `reason: 'never-run'`

### Follow-ups
- `[defer]` `emit-infra status` requires a `.emit-infra.json` in cwd, so the
  new Push gate line can't be smoke-tested against this repo (emit-infra
  itself has no config file — it's a local-only tool, not a managed project)
  — verified via direct function call against the built dist instead; worth
  keeping in mind if a future sprint wants an end-to-end CLI test fixture for
  `status`.
- `[defer]` The rule doesn't special-case a project whose default branch
  isn't `main` (matches existing convention — `deploy-detached.sh` and
  `gate-doctor-run.ts` both hardcode `origin/main` too), so this isn't a new
  gap, just an inherited one.
