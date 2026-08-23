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
- [ ] A project with unpushed commits and a recent successful gate run produces
      **no** warning — asserted by a test using develemail's shape (51 unpushed,
      healthy)
- [ ] A project with unpushed commits and a stale or failed gate record warns —
      asserted by a test using diner-decider's shape
- [ ] A project with unpushed commits and **no** `.ci-status.json` warns
      distinctly from the merely-stale case
- [ ] A project with no unpushed commits produces no output
- [ ] The staleness rule lives in one place in `packages/core` and reuses
      sprint 284's `classifyRunState` rather than reimplementing staleness
- [ ] `emit-infra status` states whether the comparison used a fetched or a
      cached `origin/main`
- [ ] Test coverage in `packages/core/src/gate-staleness.test.ts` for all four
      fleet shapes in task 6
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` green; `apps/cli/dist` rebuilt

## Out of scope
- **Running the gate.** This sprint reports on records that already exist;
  proving a gate runnable is sprint 298's job.
- Blocking or failing anything on staleness. This is a report, not a gate — an
  advisory that stops a push would be a worse version of the problem.
- Dashboard rendering of the signal. CLI first; a dashboard surface can be
  proposed once the rule has proven itself non-noisy.
- Auto-fetching on a schedule, or any background process.
