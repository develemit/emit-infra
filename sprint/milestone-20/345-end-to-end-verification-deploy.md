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
- [x] The deploy was explicitly authorised, or the sprint halted as `blocked`
- [x] The chosen project and its unpushed range are stated, with the contents reviewed
- [x] Every row of the verification table is answered with quoted real output,
      or explicitly marked not-observable with the reason
- [x] The deploy is confirmed live independently of `.deploy-status.json`
- [x] Build timing is compared against a pre-338 deploy of the same project
- [x] Any deviation from what sprints 336-344 claimed is filed as a `[blocker]`
      follow-up, quoted exactly
- [x] No source change is made in this sprint — it verifies, it doesn't fix

## Out of scope
- Fixing anything the verification uncovers — that becomes its own sprint.
- Deploying more than one project.
- Re-running the full fleet's deploys.

## Completed

**Date:** 2026-09-20

### Summary
Deployed **emit-vision** (authorised in the invoking prompt; nothing else deployed). Chosen from a prior fleet survey: deployed `3fcaa909` -> HEAD `9ecd8e36`, 8 commits / 25 files, all `apps/web` UI + `apps/web-e2e` + sprint docs, no migrations (reviewed via `git diff --stat`). Deploy succeeded: `✓ deployed 9ecd8e36532d66dec87f30fcde61a0fa356ffbbf (build 1528)`, log `/tmp/emit-deploy-emit-vision-9ecd8e3.log`. Path-filtered as predicted: `→ services to build: web`, `→ services unchanged (re-tag only): api worker marketing`.

**Verification table**
| Claim | Result |
|---|---|
| Build ran | `→ services to build: web` / `==> Building web...` |
| Arch probe | Not observable (no `ci.imageArchProbes`). Guard ran: `→ image-arch-check: no probes declared for built services, skipping` |
| Per-image progress | Captured live. Build: `"label":"Building + pushing images","image":{"name":"web","index":1,"total":1,"action":"building"}` (04:05:29-04:06:31). Retag: `"label":"Re-tagging unchanged images","image":{"name":"api","index":1,"total":3,"action":"retagging"}` -> `worker` 2/3 -> `marketing` 3/3 (04:06:39-47). Note the deploy phase then reset the file to `{"step":0,"total":1,"label":"starting"}` under a new writer pid (5494 -> 15871) and held there ~1m45s with no image/step progress until terminal. |
| pnpm fetch layer CACHED | Not observable: the log holds no docker build output (0 `CACHED` matches); `pnpm fetch` present in api/worker/web Dockerfiles. Web build phase was 70s. |
| Build faster | Not conclusively. Pre-338 web-only deploy `69e08e1` (2026-09-17): build 12s, ci 27, total 117s. Pre-338 all-4 build `31686d5`: build 157s, total 260s. Pre-338 api+worker `d07b397`: build 43s, total 147s. Post: web-only build **70s**, ci 33, retag 11, deploy 110, total **192s**. Web-only build is slower than the 12s pre-338 sample (likely that one hit a warm layer cache; 3fcaa909's web+api build was 230s). No like-for-like speedup evidence. |
| isBuildBaseline | Long record: `"servicesBuilt":["web"],"phases":{"ci":33,"auth":1,"build":70,"archCheck":0,"retag":11,"deploy":110},...,"isBuildBaseline":true`. Short record (same sha): `"durationSec":109,"servicesBuilt":[],"phases":{"deploy":108},...,"isBuildBaseline":false`. Two records per push, as known; not touched. Terminal `.deploy-status.json` said `"isBuildBaseline":true`. |
| BUILD_NUMBER preserved | Server `/opt/emit-vision/.env`: `BUILD_NUMBER=1528` (was 1520). |
| Token guard silent | Yes: `→ check-tokens` passed, deploy succeeded, no secret-scan failure. |
| One-time rebuild | Not observable, already occurred: emit-vision record `ee222bb5` (2026-09-19) `"servicesBuilt":["web","api","worker","marketing"],...,"isBuildBaseline":true`. |
| Sprint 342 pre-flight | Silent on success: `apps/cli/src/lib/image-preflight.ts` prints only for missing/inconclusive images, so the log has no pre-flight line to quote. ghcr.io "not found" wording not observable (no image missing). |

**Landed independently:** ssh to 46.225.249.8: slot flipped blue -> green, all four containers `Up 49 seconds (healthy)` (previously blue `Up 27 hours`); image digests of green api/worker/marketing match the pushed re-tag digests (`7ac3ce13…`, `e6de39c2…`, `4e4ce586…`); `https://emitvision.com/` returns 200.

### Files changed
- `sprint/345-end-to-end-verification-deploy.md` — this evidence (no source changes)

### Verification
- Deploy: succeeded, build 1528, sha 9ecd8e36.
- Tests: CI phase inside the deploy passed (`✓ CI passed`); no local suite run — no source change.

### Follow-ups
- `[blocker]` Baseline-flag contradiction on emit-vision: CLI printed `Warning: the running image has no build.number label, so this deploy can't be verified — recording deployed but not as a build baseline. Add `LABEL build.number=$BUILD_NUMBER` to the Dockerfile to enable verification.` Yet the long history record and terminal `.deploy-status.json` say `isBuildBaseline:true` (only the short record is false), and all four running containers have an empty `build.number` label — emit-vision's Dockerfiles set only `org.opencontainers.image.revision`/`.version`. So `readDeployedBuildNumber` (`apps/cli/src/commands/deploy.ts:297`) can never verify this project, and the baseline flag is not trustworthy for it. Decide: emit-vision adds the label, or the CLI reads `org.opencontainers.image.version`, and reconcile which record carries the flag.
- `[defer]` Status file regresses to `step 0/1 "starting"` for the ~1m45s ansible phase (writer pid changes), so progress is invisible during the longest phase.
- `[defer]` Deploy log lacks docker build output, so the lockfile-keyed `pnpm fetch` `CACHED` claim and build speedup can't be checked from `/tmp/emit-deploy-*.log`; verify on a project with an arch probe and a cached repeat build.
- `[defer]` Sprint 342 pre-flight is silent on success; consider a one-line `✓ registry pre-flight: N images present`.
- `[defer]` The new-sha `deploy-detached.sh` leaves the prior terminal record in `.deploy-status.json` for ~35s after launch, so a poller keying on `status:deployed` exits early (hit this).
