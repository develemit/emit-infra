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
