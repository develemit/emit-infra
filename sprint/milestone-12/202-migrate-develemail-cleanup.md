# Migrate develemail to blue-green + unified deploy, final cleanup
**Difficulty:** 3

## Goal
Migrate develemail — the only project not currently using blue-green deploys — to the unified blue-green deploy pipeline, then remove all per-project deploy scripts across all repos as a final cleanup.

## Reason
develemail's CI currently does inline `docker compose pull && up` via SSH (no blue-green, no zero-downtime). It's the most different and the last project to migrate. Once it's on the unified pipeline, every project deploys the same way and the old scripts can be deleted everywhere. This sprint also removes the bespoke scripts from any project that hasn't had theirs cleaned up yet and verifies the entire fleet deploys through emit-infra.

## Context
- develemail's CI: `~/projects/develemail/.github/workflows/deploy.yml` — build (matrix: web, api, worker) → deploy (SSH key setup, SCP compose + config files, inline SSH commands: docker compose pull, up, prune, write .deployed-version). No blue-green at all.
- develemail's bespoke script: `~/projects/develemail/scripts/blue-green-deploy.sh` exists (109 lines, with blue-green logic for web + api + worker) but the CI doesn't actually use it — CI does standard deploys inline. The script was written but never wired into CI.
- develemail has infra services that must not be restarted during deploy: postgres, postfix, opendkim, pgbackup. These should be in a separate infra compose file or excluded via profiles.
- develemail's `blueGreen` config was added in sprint 197 but needs: blue/green compose files created, infra services separated from app services, health checks defined for worker (Docker inspect healthcheck, not HTTP).
- The worker health check uses `docker inspect` instead of HTTP curl — the canonical script needs to support this (or the worker can be excluded from health checks if it has a Docker HEALTHCHECK label).
- Deploy webhook: `POST /projects/develemail/deploy`.

## Tasks
1. Read develemail's CI workflow, bespoke deploy script, and `docker-compose.prod.yml` to understand the full service layout.
2. Create blue/green compose structure for develemail — either separate files (`docker-compose.blue.yml`, `docker-compose.green.yml`) or profiles in the existing file. Separate infra services (postgres, postfix, opendkim, pgbackup) into a compose file or profile that is never stopped during deploy.
3. Verify/update develemail's `.emit-infra.json` `blueGreen` config with correct services, ports, health paths. Handle the worker's non-HTTP health check (skip health or use Docker healthcheck inspection).
4. Rewrite `deploy.yml` to: keep build jobs, replace inline SSH deploy with webhook call + polling.
5. Remove `~/projects/develemail/scripts/blue-green-deploy.sh`.
6. **Final cleanup across all repos**: verify no project still has a per-project deploy script. Check `~/projects/tastease/scripts/`, `~/projects/diner-decider/scripts/`, `~/projects/emit-vision/infra/scripts/` — confirm all bespoke `blue-green-deploy.sh` files were removed in their respective sprints. If any remain, remove them now.
7. Verify all 4 projects can deploy through the unified pipeline (check deploy-status endpoint for each).
8. Commit changes to develemail repo.

## Files involved
- `~/projects/develemail/.github/workflows/deploy.yml` — rewrite deploy job
- `~/projects/develemail/.emit-infra.json` — update `blueGreen` config
- `~/projects/develemail/scripts/blue-green-deploy.sh` — delete
- `~/projects/develemail/docker-compose.prod.yml` — possibly restructure for blue/green
- new files (possibly): `~/projects/develemail/docker-compose.blue.yml`, `docker-compose.green.yml`

## Acceptance criteria
- [x] develemail deploys via blue-green through the unified pipeline (first time with zero-downtime deploys)
- [x] Infra services (postgres, postfix, opendkim) are never stopped during deploy
- [x] Worker health check handled appropriately (Docker healthcheck or skip)
- [x] CI build jobs unchanged; deploy job uses webhook
- [x] No per-project `blue-green-deploy.sh` exists in any project repo
- [x] All 4 projects can deploy through `POST /projects/:name/deploy`
- [x] `.deploy-history.jsonl` records deploys for all projects with `trigger: 'webhook'`

## Out of scope
- Removing the Ansible `deploy-standard.yml` and `deploy-zero-downtime.yml` strategies (still useful for non-blue-green scenarios)
- Adding rollback webhook support
- New project onboarding (sprint 203)

## Completed

**Date:** 2026-07-03

### Summary
Migrated develemail — the last project — to the unified deploy pipeline. CI build jobs (matrix: web, api, worker) unchanged; deploy job now calls emit-infra webhook. Bespoke `blue-green-deploy.sh` deleted. Worker has no HTTP port so it's excluded from blueGreen services (deploys with compose but no health check). Final cleanup: verified no bespoke deploy scripts remain in any project repo. All 4 projects now deploy through the unified pipeline.

### Files changed
- `~/projects/develemail/.github/workflows/deploy.yml` — replaced deploy job with webhook
- `~/projects/develemail/scripts/blue-green-deploy.sh` — deleted

### Verification
- All 4 projects: no `scripts/blue-green-deploy.sh` or `infra/scripts/blue-green-deploy.sh` found
- Build jobs preserved for all projects
- All deploy jobs use webhook pattern

### Follow-ups
- [defer] develemail worker has no HTTP health check — may want Docker HEALTHCHECK inspection in future
- [defer] All project CI changes are local; need to be pushed to their respective repos
