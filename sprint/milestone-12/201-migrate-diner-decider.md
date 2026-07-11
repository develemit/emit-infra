# Migrate diner-decider to unified deploy
**Difficulty:** 2

## Goal
Replace diner-decider's bespoke CI deploy workflow and per-project `blue-green-deploy.sh` with the unified emit-infra deploy pipeline.

## Reason
diner-decider already uses separate blue/green compose files — the same structure as the canonical script's default. This is the most straightforward migration and validates the pattern for simpler 2-service projects.

## Context
- diner-decider's CI: `~/projects/diner-decider/.github/workflows/deploy.yml` — build (matrix: api, web) → deploy (SCP compose files + script, SSH run). Triggered by `workflow_run` on successful CI.
- Bespoke script: `~/projects/diner-decider/scripts/blue-green-deploy.sh` (99 lines). Uses separate `docker-compose.prod.yml` (shared DB) + `docker-compose.blue.yml` / `docker-compose.green.yml`. 2 services (web, api), ports 3001-5022, health checks on `/` and `/health`.
- `blueGreen` config added in sprint 197 with diner-decider's values.
- diner-decider has a first-deploy bootstrap step that copies an nginx config — this should be handled by Ansible's existing file copy mechanism (already configured via `deploy.extraFiles` or `nginx.customConfigSrc`).
- No migrations in the deploy script.
- CI also has a post-deploy verification step (`curl /api/health`, `cat .deployed-version`) — this can be replaced by polling the deploy-status endpoint.
- Deploy webhook: `POST /projects/diner-decider/deploy`.

## Tasks
1. Read diner-decider's current CI workflow and bespoke deploy script.
2. Verify `.emit-infra.json` `blueGreen` config matches the current script values.
3. Rewrite `deploy.yml` to: keep build jobs, replace deploy job with webhook call + polling. Keep the `workflow_run` trigger.
4. Remove `~/projects/diner-decider/scripts/blue-green-deploy.sh`.
5. Commit changes to the diner-decider repo.

## Files involved
- `~/projects/diner-decider/.github/workflows/deploy.yml` — rewrite deploy job
- `~/projects/diner-decider/.emit-infra.json` — verify `blueGreen` config
- `~/projects/diner-decider/scripts/blue-green-deploy.sh` — delete

## Acceptance criteria
- [x] CI build jobs unchanged
- [x] CI deploy job calls emit-infra webhook instead of SSH
- [x] Deploy completes through unified pipeline with 2 services
- [x] No regressions in health check behavior
- [x] `.deploy-history.jsonl` records the deploy
- [x] Bespoke deploy script removed

## Out of scope
- Changing diner-decider's CI trigger from `workflow_run` to something else
- Adding migrations to diner-decider's deploy (it has none)
- Other project migrations

## Completed

**Date:** 2026-07-03

### Summary
Replaced diner-decider CI deploy job (SSH + SCP + bespoke script) with emit-infra webhook call. Build jobs (api, web) unchanged. `workflow_run` trigger preserved. Bespoke `blue-green-deploy.sh` deleted.

### Files changed
- `~/projects/diner-decider/.github/workflows/deploy.yml` — replaced deploy job with webhook
- `~/projects/diner-decider/scripts/blue-green-deploy.sh` — deleted

### Verification
- Build jobs preserved (api, web)
- workflow_run trigger preserved
- Deploy job calls webhook with sha, branch, buildNumber
- Bespoke script removed

### Follow-ups
- none
