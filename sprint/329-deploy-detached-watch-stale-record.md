# Stop `deploy-detached.sh --watch` reporting on the wrong deploy
**Difficulty:** 2

## Goal
`--watch` reports on the deploy it was asked about, not whichever record happens
to be in `.deploy-status.json`. And `deploy-detached.sh` is executable, so the
`/deploy` skill's documented invocation works.

## Reason
On 2026-09-11, `--no-wait` launched a tastease deploy for `2445c11` and printed
its log path. The follow-up `--watch` then polled the **previous** record —
`d838943`, `/tmp/emit-deploy-tastease-d838943.log` — and printed
`⏳ still running after 540s`. The deploy it was supposedly watching had already
terminated as `failed` at 07:42:35Z, roughly four minutes earlier.

That is the worst possible failure mode for this tool: it was being used to
watch a production deploy during an incident, and it reported "still running"
for something already dead. The failure was only caught because the operator
stopped trusting `--watch` and read `.deploy-status.json` directly — which is
now written into tastease's `CLAUDE.md` as standing advice to distrust the tool.
A monitoring tool nobody trusts is worse than none.

Separately, `scripts/deploy-detached.sh` is mode `-rw-r--r--`. The `/deploy`
skill documents invoking it directly, which fails with `permission denied`;
every caller has to know to prepend `bash`. Both are small; both waste time at
exactly the wrong moment.

## Context

### The stale-record bug
`scripts/deploy-detached.sh` (sprint 289) polls `.deploy-status.json` until it
reaches a terminal state. The record carries a `sha`, and the log path is derived
from it — hence `/tmp/emit-deploy-<project>-<sha>.log`. When `--watch` runs
without knowing which sha it should be watching, it reads whatever sha the file
currently holds. If the newly launched deploy hasn't written its record yet, that
is the *previous* deploy's sha, and if that old record is already terminal, the
logic misreads the situation entirely.

Fix direction: `--watch` should establish the sha it cares about — `HEAD` is the
natural default, since that is what a detached deploy ships — and treat a record
for a *different* sha as "this deploy hasn't started yet", not as its status.
Resolve the log path from that sha too. A terminal status for another sha must
never be reported as this deploy's outcome.

Worth checking while in here: the same confusion can affect the default
blocking mode, which polls immediately after launching. Establish the target sha
once, in one place, and have both modes use it.

### Existing coverage and conventions
`scripts/lib/deploy-detached.test.sh` already exists and is registered in the
root `package.json`'s `test:hooks` script — extend it rather than adding a new
file. Note the existing backlog item at ~line 142: that suite's `--no-wait` case
takes ~8s of wall time, so keep new cases fast and avoid real sleeps where a
fixture will do.

Related open backlog items worth reading first, since they touch the same
polling code and may be cheap to fold in — use judgement, and say what you chose:
- the default `--timeout` is 3600s, flagged as possibly over-generous
- `poll_for_result` uses a flat `sleep 10`, flagged as coarse

### The executable bit
`git update-index --chmod=+x scripts/deploy-detached.sh` records the mode change
in git rather than only on disk. Check whether any sibling script in `scripts/`
is also non-executable and fix those in the same pass if the list is short.

The `/deploy` skill file lives at `~/.claude/commands/deploy.md`, which is
**untracked and outside any git repo**, so it cannot be fixed by a commit here —
`backlog.md` already carries a related note at ~line 117. If the skill's wording
needs changing, say so in the report rather than silently editing an untracked
file.

## Tasks
1. Reproduce the stale-record misreport in a test: a `.deploy-status.json`
   holding a terminal record for a *different* sha must not be reported as the
   watched deploy's outcome.
2. Make `--watch` (and the blocking mode) resolve the target sha once and derive
   both the record match and the log path from it.
3. Report clearly when the record for the target sha hasn't appeared yet —
   distinct from "running" and from "finished".
4. `git update-index --chmod=+x scripts/deploy-detached.sh`, plus any sibling
   scripts missing the bit.
5. Extend `scripts/lib/deploy-detached.test.sh` with the cases above.
6. Decide on the two related polling backlog items (timeout, sleep granularity);
   fold in or leave, and record which.

## Files involved
- `scripts/deploy-detached.sh` — sha-targeted watching; mode `+x`
- `scripts/lib/deploy-detached.test.sh` — new cases
- `backlog.md` — close the item filed 2026-09-11, plus any folded-in items

## Acceptance criteria
- [ ] A terminal record for a different sha is never reported as the watched
      deploy's outcome — covered by a test that fails against today's code
- [ ] The watched log path is derived from the target sha, not from whatever the
      status file happens to hold
- [ ] "Record hasn't appeared yet" is distinguishable from "running" and
      "finished" in the output
- [ ] `git ls-files -s scripts/deploy-detached.sh` shows mode `100755`, and
      invoking it directly (no `bash` prefix) works
- [ ] Test coverage for all of the above in
      `scripts/lib/deploy-detached.test.sh`; new cases add no real sleeps
- [ ] `pnpm test:hooks` passes
- [ ] A real deploy of any project is watched end to end with the fixed script,
      and its reported outcome matches `.deploy-status.json`

## Out of scope
- Rewriting how `.deploy-status.json` is written, or adding history/locking.
  The record format is fine; only the reader's sha assumption is wrong.
- Editing `~/.claude/commands/deploy.md` (untracked, outside any repo) — report
  any wording that should change.
- The image-arch guard (sprints 326-328), even though 327 has to work around the
  `bash` prefix until this lands.
