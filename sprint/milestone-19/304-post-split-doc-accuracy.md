# Post-split doc accuracy pass: point every reference at the file that now owns it
**Difficulty:** 2

> _Promoted from backlog: sprint-270, sprint-294, and sprint-300 follow-ups, 2026-08-22._

## Goal
After sprints 294 and 300–302 split four large files into thirteen, every
in-repo pointer — doc tables, code comments, refusal messages — names the file
that actually holds the thing it's pointing at.

## Reason
Milestone 18 restructured the deploy machinery substantially:

| Original | Now |
| --- | --- |
| `docs/PRE-PUSH-HOOK.md` (703 lines) | 98-line entry point + `DEPLOY-GATES.md`, `DEPLOY-SIGNALS-AND-LIVENESS.md`, `DEPLOY-BUILD-INTERNALS.md`, `CROSS-PLATFORM-BUILD-PATTERN.md` |
| `scripts/lib/deploy-plan.sh` (329) | 61 + `deploy-path-filter.sh`, `deploy-smart-build.sh`, `deploy-launch.sh` |
| `scripts/lib/ci-utils.sh` (368) | 198 + `ci-atomic-write.sh`, `ci-heartbeat.sh`, `ci-log-capture.sh`, `ci-phase-tracking.sh`, `ci-signals.sh` |
| `scripts/hooks/pre-push` (307) | 245 + `pre-push-config.sh`, `pre-push-ci-phase.sh` |

Every split sprint was deliberately scoped to *move code, change nothing else* —
correct discipline, but it means the pointers were left pointing at the old
shape and three sprints filed the same class of follow-up. Nothing here is
broken: sourcing `deploy-plan.sh` still resolves the moved functions, and
`PRE-PUSH-HOOK.md` links onward to the split docs. This is about a reader
following a pointer and landing in the wrong file.

## Context

### Known stale pointers (verify each — line numbers drift)
1. **`docs/PRE-PUSH-HOOK.md`'s Files table (~line 9)** — one row credits
   `scripts/lib/deploy-plan.sh` with "Decision logic (what to deploy, what to
   rebuild), the unattended-shell gate, and the launch-mode declaration". That
   is now four files. The table also omits all ten new modules and the newer
   test files.
2. **`scripts/lib/ci-utils.sh:29`** — a comment credits "sprint 290's
   `deploy_launch_mode` in `deploy-plan.sh`"; that function now lives in
   `deploy-launch.sh`.
3. **`scripts/collect-metrics.sh:106`** — a comment references "the SIGPIPE
   hazard sprint 292 fixed in `deploy-plan.sh`"; that fix now lives in
   `deploy-path-filter.sh`.
4. **`docs/DEPLOY-GATES.md:88, 104`** — line 88 says the fix "match[es]
   `nx_projects` in `deploy-plan.sh`" (still true, `nx_projects` did stay) but
   describes code that moved to `deploy-path-filter.sh`; line 104 attributes
   `detect_unattended_shell` to `deploy-plan.sh`, but it now lives in
   `deploy-launch.sh`. Check both against the current source rather than
   trusting this description.
5. **`scripts/hooks/pre-push`'s refusal message** and **`deploy-plan.sh`'s
   comments** point at `docs/PRE-PUSH-HOOK.md` generically. Now that the detail
   lives in a specific split doc, they should point at the section that holds
   it — e.g. `DEPLOY-GATES.md#unattended-shell-gate`.
6. **`docs/PRE-PUSH-HOOK.md` never documented `run_build_fanout`** or the
   sprint-270 "fix-5" status-integrity change. That gap predates the split and
   was filed to be folded into the next doc touch — this is that touch.

### Constraints
- **The refusal message is user-facing and load-bearing.** It's what an agent
  session sees when the gate blocks a deploy. Keep it short and keep the
  actionable instruction first; a deeper link is an improvement only if it
  doesn't bury the "here's what to do" line. `docs/DEPLOY-GATES.md` and
  `docs/AGENT-DEPLOYS.md`-equivalent runbook content (sprint 291) are the
  authorities on what that message must still say.
- **Do not move code in this sprint.** If a pointer is stale because the code
  is in an odd place, fix the pointer and file the move.
- Anchors: verify each `#section-anchor` you write actually resolves against
  the current heading text — a link to a renamed heading is worse than a
  generic one, because it looks precise.

## Tasks
1. Rebuild `docs/PRE-PUSH-HOOK.md`'s Files table to match the current
   thirteen-file layout — one row per file, each with the role it *actually*
   owns now. Keep the entry point short; if the table starts dominating the
   98-line entry doc, move the detail into the relevant split doc and leave a
   summary row.
2. Fix the three stale code comments (`ci-utils.sh`, `collect-metrics.sh`,
   `DEPLOY-GATES.md`) to name the owning file.
3. Grep the whole repo — `scripts/`, `docs/`, `apps/`, `packages/` — for
   references to the four split files by name, and check each one: does the
   thing being described still live there? Fix the ones that don't.
4. Tighten the generic `PRE-PUSH-HOOK.md` pointers in the hook's refusal
   message and `deploy-plan.sh`'s comments to the specific split doc section,
   subject to the refusal-message constraint above.
5. Document `run_build_fanout` and the sprint-270 status-integrity change in
   whichever split doc now owns build/phase behaviour
   (`DEPLOY-BUILD-INTERNALS.md` is the likely home).
6. Confirm every internal doc link still resolves after the edits.

## Out of scope
- Moving, renaming, or refactoring any code.
- Rewriting doc *content* beyond accuracy fixes and the one documented gap in
  task 5. If you find something factually wrong while in there, file it.
- The four docs' overall structure — sprint 294 settled that.

## Acceptance criteria
- No reference anywhere in the repo attributes a function, fix, or
  responsibility to a file that no longer contains it. Show the grep.
- `docs/PRE-PUSH-HOOK.md`'s Files table lists every current script and test in
  the hook path, with accurate roles.
- Every internal doc link and anchor resolves.
- `run_build_fanout` and the sprint-270 status-integrity change are documented.
- The refusal message still leads with its actionable instruction, and
  `bash scripts/lib/deploy-unattended-gate.test.sh` still passes (it asserts on
  that message's content).
- Zero code behaviour change: `bash -n` clean on every touched script, and the
  full shell + `pnpm test` suites green with unchanged assertion counts.

## Completed

**Date:** 2026-08-23

### Summary
Swept every in-repo pointer left stale by sprints 294/300–302's file splits.
The six known-stale spots from the sprint's Context section were all real:
`docs/PRE-PUSH-HOOK.md`'s Files table still described the pre-split
four-file layout, `ci-utils.sh:29` and `collect-metrics.sh:106` credited
`deploy-plan.sh` for functions that moved to `deploy-launch.sh` and
`deploy-path-filter.sh` respectively, `DEPLOY-GATES.md` had the same
`nx_projects`/`detect_unattended_shell` mix-up, five generic
`docs/PRE-PUSH-HOOK.md` pointers (the refusal message, two comments in
`deploy-launch.sh`, one in `pre-push-config.sh`, one in `pre-push` itself)
now had a specific split-doc section to land on instead, and
`run_build_fanout`/the sprint-270 status-integrity fix had never been
documented.

A repo-wide grep for `deploy-plan.sh` and `ci-utils.sh` by name (task 3)
turned up five more stale attributions the Context section didn't call out:
`deploy-unattended-gate.test.sh`'s header comment, three spots in
`packages/core/src/deploy-records.ts`, and one in
`docs/DEPLOY-SIGNALS-AND-LIVENESS.md` — all crediting `deploy-plan.sh` for
`resolve_last_deployed_sha`, `detect_unattended_shell`,
`has_controlling_terminal`, or `deploy_launch_mode`, which sprint 300 moved
to `deploy-launch.sh`. Fixed all of them to point at the file that actually
defines the function now. One matching hit,
`packages/core/dist/src/deploy-records.js`, was left alone — it's gitignored
build output that regenerates correctly from the fixed `.ts` source on the
next build, not a tracked reference.

Several possessive references like "the hook's `run_ci`" or "`pre-push`'s
python reader" (in `apps/cli/src/lib/gate-doctor-*.ts`) were deliberately
left as-is: they describe behavior that `pre-push` still conceptually owns
by sourcing the extracting file, the same "entry point stays the accurate
reference" reasoning sprint 301/302 already established for `ci-utils.sh`
consumers — not a case of a function credited to a file that no longer
contains it.

`docs/PRE-PUSH-HOOK.md`'s Files table grew from one 10-row table to four
grouped tables (hook orchestration / deploy-decision cluster / status-history
cluster / detached-launch & gate-doctor, plus a tests table) — 23 rows total
covering all sixteen production files and seven test files actually in the
hook's path, each linking to the split doc that now owns its detail.
`docs/DEPLOY-BUILD-INTERNALS.md` gained a new "Build fan-out and status
integrity" section documenting `run_build_fanout`'s `on_fail`-callback design
(sprint 270's fix for the `wait ... || exit 1` ERR-trap gap) and
`push_payload_summary`'s commit-count/oldest-commit print, both still living
in `deploy-plan.sh` unchanged.

The refusal message's link target changed (`docs/PRE-PUSH-HOOK.md` →
`docs/DEPLOY-GATES.md#unattended-shell-gate`) but its line order and every
other word didn't — the actionable "use the detached deploy path" line still
follows it, and `deploy-unattended-gate.test.sh` only asserts on the
"refusing to deploy" substring, not the pointer text, so nothing to
special-case there. No code behavior changed anywhere in this sprint — every
edit was a comment, doc prose, or a printed string's link target.

### Files changed
- `docs/PRE-PUSH-HOOK.md` — rebuilt the Files table into four grouped tables
  (23 rows, up from 10) matching the current thirteen-file split, each row
  linking to the split doc that owns its detail
- `docs/DEPLOY-GATES.md` — fixed two stale attributions
  (`nx_projects` → `deploy-smart-build.sh`, `detect_unattended_shell` →
  `deploy-launch.sh`)
- `docs/DEPLOY-BUILD-INTERNALS.md` — added "Build fan-out and status
  integrity" documenting `run_build_fanout` and `push_payload_summary`
  (sprint 270, previously undocumented)
- `docs/DEPLOY-SIGNALS-AND-LIVENESS.md` — fixed `resolve_last_deployed_sha`'s
  attribution (`deploy-plan.sh` → `deploy-launch.sh`)
- `scripts/lib/ci-utils.sh` — fixed a comment crediting `deploy_launch_mode`
  to `deploy-plan.sh` instead of `deploy-launch.sh`
- `scripts/collect-metrics.sh` — fixed a comment crediting the sprint-292
  SIGPIPE fix to `deploy-plan.sh` instead of `deploy-path-filter.sh`
- `scripts/hooks/pre-push` — tightened the refusal message and a gate
  comment to point at `docs/DEPLOY-GATES.md#unattended-shell-gate`; fixed a
  `deploy_launch_mode` attribution
- `scripts/lib/deploy-launch.sh` — tightened two comments' generic
  `PRE-PUSH-HOOK.md` pointers to `DEPLOY-GATES.md#unattended-shell-gate`
- `scripts/lib/pre-push-config.sh` — tightened a comment's pointer to
  `DEPLOY-GATES.md#ignored-paths`
- `scripts/lib/deploy-unattended-gate.test.sh` — fixed the header comment's
  `deploy-plan.sh` attribution to `deploy-launch.sh`
- `packages/core/src/deploy-records.ts` — fixed three comments crediting
  `deploy-plan.sh` for functions that live in `deploy-launch.sh`

### Verification
- `grep -rn "deploy-plan\.sh\|ci-utils\.sh" docs/ scripts/ apps/ packages/`
  (excluding `node_modules` and gitignored `dist/`): every remaining hit is
  either the file's own header, a legitimate sourcing path (consumers still
  correctly source the entry point), or an attribution that's still true
  (e.g. `ci_init`/`deploy_done`/`run_build_fanout` really do still live where
  credited) — no false attribution left
- Doc-link resolver (`python3` script walking every `](FILE.md#anchor)` in
  `docs/*.md` against that file's actual headings): all resolve, including
  the five new/changed anchors this sprint added
- `bash -n` on every touched script (`pre-push`, `deploy-plan.sh`,
  `deploy-launch.sh`, `pre-push-config.sh`, `ci-utils.sh`,
  `deploy-unattended-gate.test.sh`, `collect-metrics.sh`): clean
- `bash scripts/lib/deploy-unattended-gate.test.sh` under `/bin/bash`:
  34/34 pass — unchanged from baseline
- `pnpm test:hooks` (all 8 shell suites): 47+7+12+6+12+17+34+25 = 160/160
  pass, exit 0 — identical per-suite counts to the pre-sprint baseline
- `pnpm test` (nx-wide vitest run): 356/356 tests across 42 files pass

### Follow-ups
none
