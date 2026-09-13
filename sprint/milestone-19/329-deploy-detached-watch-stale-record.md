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
Read the code before trusting any summary of it — verified 2026-09-12:

- `watch_main()` (`scripts/deploy-detached.sh:211-216`) is the whole bug.
  It reads the sha out of `.deploy-status.json` (`:214`) and derives `base` from
  it, then hands both to `poll_for_result`.
- `poll_for_result` (`:118-135`) does **not** poll `.deploy-status.json`. It
  blocks until the sentinel file `${base}.rc` exists — i.e.
  `/tmp/emit-deploy-<project>-<sha>.rc`. The status JSON is read only twice:
  once at `:214` to choose the sha, and again in `print_summary` (`:156-157`),
  which *does* correctly guard on `record_sha == sha`.
- The blocking path already does the right thing: `main` (`:231-234`) resolves
  the sha with `git rev-parse HEAD` and derives `base` from that. **So the fix is
  to make `--watch` behave like the path that already works**, not to invent a
  new scheme.

Both observed failure modes follow from that one bad line:
- The stale sha's `.rc` does **not** exist (the 2026-09-11 incident) → the loop
  spins to `--timeout` and prints `⏳ still running after 540s` for a deploy that
  finished minutes earlier.
- The stale sha's `.rc` **does** still exist in `/tmp` → `print_summary` runs
  against the wrong sha and instantly reports a previous deploy's outcome as this
  one's. Arguably worse, and equally reachable; cover both.

Fix direction: `--watch` should establish the sha it cares about — `HEAD` is the
natural default, since that is what a detached deploy ships — and treat a record
or sentinel for a *different* sha as "this deploy hasn't started yet", not as its
status. Resolve the log and `.rc` paths from that sha too. A terminal result for
another sha must never be reported as this deploy's outcome.

The blocking mode is already sha-correct, so this is mostly about giving `--watch`
the same footing: establish the target sha once, in one place, and have both modes
use it.

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
- [x] A terminal record for a different sha is never reported as the watched
      deploy's outcome — covered by a test that fails against today's code
- [x] The watched log path is derived from the target sha, not from whatever the
      status file happens to hold
- [x] "Record hasn't appeared yet" is distinguishable from "running" and
      "finished" in the output
- [x] `git ls-files -s scripts/deploy-detached.sh` shows mode `100755`, and
      invoking it directly (no `bash` prefix) works
- [x] Test coverage for all of the above in
      `scripts/lib/deploy-detached.test.sh`; new cases add no real sleeps
- [x] `pnpm test:hooks` passes
- [ ] A real deploy of any project is watched end to end with the fixed script,
      and its reported outcome matches `.deploy-status.json` — not run this
      pass (would mean launching a real production deploy; deferred to the
      next natural one, same precedent as sprint 289/291)

## Out of scope
- Rewriting how `.deploy-status.json` is written, or adding history/locking.
  The record format is fine; only the reader's sha assumption is wrong.
- Editing `~/.claude/commands/deploy.md` (untracked, outside any repo) — report
  any wording that should change.
- The image-arch guard (sprints 326-328), even though 327 has to work around the
  `bash` prefix until this lands.

## Completed

**Date:** 2026-09-12

### Summary
The bug was exactly where the sprint's Context section said it was: `watch_main`
read the target sha out of `.deploy-status.json` instead of resolving it the
same way `main()`'s launch path already did (`git rev-parse HEAD`). Fixed by
extracting that resolution into a shared `target_sha()` helper used by both
`main()` and `watch_main()`, so there is exactly one place a detached deploy's
sha comes from. Since `status_base`/the `.rc`/`.log` paths were already keyed
by sha, fixing the sha resolution alone closes both failure modes the sprint
described (stale-sha timeout misreport, and stale-sha terminal-record
misreport) — no change was needed to `poll_for_result`'s or `print_summary`'s
existing sha-matching logic.

Added a second helper, `record_state_for_sha()`, purely for the "hasn't
appeared yet" vs. "running" distinction (task 3): it reads
`.deploy-status.json`'s `sha` field and reports `running` only when it matches
the target sha, `not-started` otherwise (missing file, missing field, or a
different sha — all read the same, which is the point). `poll_for_result` now
prints this once up front and again in the timeout message, so a timed-out
`--watch` no longer says "still running" when nothing has actually started.

`watch_main` still refuses outright when `.deploy-status.json` doesn't exist
at all (no deploy has ever been recorded for the project) — that guard didn't
depend on the sha field and stays a legitimate precondition. The old "status
file has no 'sha' field" guard was removed since sha no longer comes from that
file; a missing/empty sha field there now just reads as `not-started`, which
is the correct behavior, not an error.

Fixed the executable bit on `scripts/deploy-detached.sh` (`chmod +x` +
`git update-index --chmod=+x`, so the mode is recorded in git, not just on
disk). Checked every other script directly under `scripts/*.sh` (not
`scripts/lib/*.sh`, which are sourced libraries, not invoked directly) —
`deploy-detached.sh` was the only one missing `+x`.

**Decision on the two related backlog items** (task 6): left both as-is,
`[defer]`. The 3600s default `--timeout` and the flat `sleep 10` poll
granularity are performance/tuning concerns unrelated to this sprint's
correctness bug, and folding them in would have widened scope on a
difficulty-2 sprint without adding test coverage for the actual bug. They're
already tracked in `backlog.md` (lines pre-dating this sprint).

**The one acceptance criterion left unchecked**: "a real deploy of any
project is watched end to end." Running that for real means launching an
actual production `git push origin main` against a live project — an
irreversible, outward-facing action, and exactly the category of action the
user explicitly deferred for sprints 327/328 this same session. Sprint 289
(which built this script) and sprint 291 (its verification checklist) hit the
identical situation and deferred the real-world check to "whatever project's
next ordinary detached deploy happens to be" rather than manufacturing one;
this sprint follows that precedent. Every other criterion is covered by a
fast, deterministic, git-repo-backed test, including one written specifically
to fail against pre-fix code (verified by stashing the fix and re-running).

### Files changed
- `scripts/deploy-detached.sh` — added `target_sha()` (shared sha resolution
  for launch and watch) and `record_state_for_sha()` (running vs. not-started
  vs. finished); `watch_main()` and `main()` both now resolve the sha through
  `target_sha()`; `poll_for_result()` reports the not-started/running
  distinction up front and in its timeout message; mode changed to `100755`
- `scripts/lib/deploy-detached.test.sh` — `watch_main` fixtures now use a real
  git repo (required since sha resolution is now `git rev-parse HEAD`); added
  the stale-sha-terminal-record regression case (fails against pre-fix code);
  added a not-started-vs-running case to the `poll_for_result` block; removed
  the now-obsolete "status file has no sha field" case
- `backlog.md` — closed the mode-644 half of the 2026-08-27 entry, pointing at
  this sprint; the parent-teardown-survival half of that entry is unrelated
  and still open

### Verification
- `bash scripts/lib/deploy-detached.test.sh`: 28/28 pass
- Regression proof: stashed `scripts/deploy-detached.sh` (keeping the updated
  test file) and re-ran — the new stale-record test fails against the old
  code exactly as expected (reports "deploy finished: deployed" for a
  different sha, exit 0 instead of 2); restored the fix and it passes again
- `pnpm test:hooks` (full chain, all 14 suites): all suites downstream of
  `deploy-detached.test.sh` in the `&&` chain completed, which is only
  possible if it exited 0 — full run ended `[exited with code 0]`
- `bash -n` clean on both touched scripts
- `git ls-files -s scripts/deploy-detached.sh` → `100755 ...`; `./scripts/deploy-detached.sh --help` runs without a `bash` prefix

### Follow-ups
- `[defer]` The real-deploy end-to-end check (last acceptance criterion) is
  still outstanding — verify the next time any wired project runs an ordinary
  detached deploy, and confirm the reported outcome matches
  `.deploy-status.json`. Same pattern as sprint 291.
- `[defer]` Default `--timeout` (3600s) and `poll_for_result`'s flat
  `sleep 10` granularity (both flagged in sprint 289/303's backlog) were
  reviewed per task 6 and left as-is — unrelated to this sprint's correctness
  fix, no new evidence changes the prior call.
