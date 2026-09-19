# Prove the rebuilt deploy pipeline with one real deploy
**Difficulty:** 3

## ⚠ Requires Emit's explicit approval before it can complete
This sprint deploys to production. Per `/start-sprint`'s rules, an irreversible
outward-facing action must not be taken unprompted: **if the invoking prompt
does not explicitly authorise a production deploy of a named project, halt with
`STATUS: blocked`**, say what approval is needed, and report the local checks
you did finish. Do not deploy on the strength of this file alone.

## Goal
One real deploy exercises the whole 336-344 chain end to end, so the fleet's
deploy path is proven in production rather than only in tests.

## Reason
Sprints 336-340 rewrote large parts of the deploy path — baseline-flagged deploy
records, an image-arch guard with a new `prisma` probe kind, all 15 fleet
Dockerfiles moved to a lockfile-keyed `pnpm fetch` deps stage, per-image build
progress, and a token guard wired into `ci_done`/`deploy_done`. **Every one of
those sprints deferred real-deploy verification**, each closing with some form
of "confirm on the next ordinary deploy". That deferral has now accumulated
across five sprints plus this batch's changes.

Some of it genuinely cannot be proven any other way. The arch guard only runs
when `TO_BUILD` is non-empty (sprint 327 discovered this the hard way — its
deploy was re-tag-only, so the guard never fired). Per-image progress only
appears in a live `.deploy-status.json`. And sprint 336 introduced a one-time
fleet-wide effect — the first push after it finds no pre-336 baseline and
rebuilds every declared service once — that nobody has yet watched happen.

## Context

### What a good candidate project looks like
- Currently healthy in production.
- A small unpushed range, so the deploy ships this pipeline work and little else.
- Ideally has an arch probe declared, so the guard actually runs.
- Ideally more than one image, so per-image progress has something to show.

Check each candidate's unpushed range with
`git rev-list --count <deployed-sha>..HEAD` and read what's in it before
choosing — several fleet repos are dozens of commits ahead, and deploying one of
those ships a great deal of unrelated work. **Name the project you chose and why
in the report.** If every candidate has a large unreviewed range, that is itself
the finding: stop and report rather than shipping one blind.

### What to verify, and where each signal appears
| Claim | Where to see it |
|---|---|
| Build actually ran (not re-tag-only) | `→ services to build:` in the deploy log |
| Arch probe fired on a real build | `✓ image-arch-check: …` lines |
| Per-image progress | `image: {name, index, total, action}` in `.deploy-status.json` while running |
| Deps stage is lockfile-keyed | `pnpm fetch` layer `CACHED` on a repeat build |
| Build got faster | compare `durationSec`/`phases` against earlier `.deploy-history.jsonl` entries |
| Record is a real baseline | `isBuildBaseline: true` in the new record |
| `BUILD_NUMBER` preserved | server `.env` still has it after the deploy |
| Token guard silent | deploy succeeds; no secret-scan failure |
| One-time rebuild happened | every declared service built, even unchanged ones |

### How to deploy
`git push` is the deploy, and the pre-push hook refuses any shell with
`$CLAUDECODE` set. Use `~/projects/emit-infra/scripts/deploy-detached.sh --dir
~/projects/<project> --no-wait` (executable since sprint 329), then either
`--watch` it (sha-targeted since 329) or read `.deploy-status.json` and
`/tmp/emit-deploy-<project>-<sha>.log` directly.

Capture `.deploy-status.json` **while the build is running** — the per-image
progress field only exists mid-flight and is gone from the terminal record.

### Verify the deploy actually landed
Independently of `.deploy-status.json`: the project's health endpoint should
report a reset uptime, and its container's `build.number` label should match the
new build. A deploy that fails before the nginx switch leaves the old slot
serving — safe, but it means nothing shipped.

### If something fails
A failure here is a **success for this sprint** — it means the chain had a real
defect that tests missed. Record exactly what failed and where, don't try to fix
it in this sprint, and file it as a `[blocker]` follow-up.

## Tasks
1. Confirm the invoking prompt authorises a production deploy of a named
   project. If not, halt with `STATUS: blocked` (see the banner above).
2. Choose the candidate, stating its unpushed range and what's in it.
3. Capture the "before" state: recent `.deploy-history.jsonl` timings, current
   deployed sha and build number, health endpoint uptime.
4. Deploy, watching the log live and capturing `.deploy-status.json` mid-build.
5. Walk the verification table above, quoting real output for each row.
6. Confirm the deploy landed independently of the status record.
7. Record anything that didn't behave as the sprints claimed, as a `[blocker]`.

## Files involved
- No source changes expected. This sprint produces evidence, recorded in its own
  `## Completed` section.

## Acceptance criteria
- [ ] The deploy was explicitly authorised, or the sprint halted as `blocked`
- [ ] The chosen project and its unpushed range are stated, with the contents reviewed
- [ ] Every row of the verification table is answered with quoted real output,
      or explicitly marked not-observable with the reason
- [ ] The deploy is confirmed live independently of `.deploy-status.json`
- [ ] Build timing is compared against a pre-338 deploy of the same project
- [ ] Any deviation from what sprints 336-344 claimed is filed as a `[blocker]`
      follow-up, quoted exactly
- [ ] No source change is made in this sprint — it verifies, it doesn't fix

## Out of scope
- Fixing anything the verification uncovers — that becomes its own sprint.
- Deploying more than one project.
- Re-running the full fleet's deploys.
