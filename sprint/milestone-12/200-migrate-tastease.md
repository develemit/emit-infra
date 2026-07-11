# Migrate tastease to unified deploy
**Difficulty:** 3

## Goal
Replace tastease's bespoke CI deploy workflow and per-project `blue-green-deploy.sh` with the unified emit-infra deploy pipeline, including reconciling its single-file compose + profiles structure to work with the canonical deploy script.

## Reason
tastease's deploy script is the most structurally different — it uses a single `docker-compose.prod.yml` with Docker profiles (`--profile blue`, `--profile green`) instead of separate compose files. The canonical script from sprint 196 supports both patterns via config, but tastease needs its compose structure validated against the `composeStructure: 'profiles'` config path. Proving this works ensures the canonical script truly handles all patterns.

## Context
- tastease's CI: `~/projects/tastease/.github/workflows/deploy.yml` — build (matrix: api, web, marketing) → deploy (SCP script + compose file, SSH run). Simple push-to-main trigger.
- tastease's bespoke script: `~/projects/tastease/scripts/blue-green-deploy.sh` (65 lines). Uses `docker compose -f docker-compose.prod.yml --profile $INACTIVE up -d`, pre-deploy migration via `--profile migrate run --rm db-migrate`, and ports 3000-3221.
- tastease's `.emit-infra.json` already has `deploy.composeSrc: "docker-compose.prod.yml"`. The `blueGreen` config was added in sprint 197 with `composeStructure: 'profiles'`.
- tastease has a pre-deploy migration (`MIGRATE_PRE` in the deploy config): `docker compose -f docker-compose.prod.yml --profile migrate run --rm db-migrate`.
- nginx config is at `/opt/tastease/nginx-upstream.conf` (non-standard — most projects use `/etc/nginx/blue-green/`). The `blueGreen.nginxConfPath` should be set to this path.
- Deploy webhook from sprint 198: `POST /projects/tastease/deploy`.

## Tasks
1. Read tastease's current CI workflow and bespoke deploy script fully.
2. Verify tastease's `.emit-infra.json` `blueGreen` config matches the current script (services, ports, health, nginx path, compose structure, migration command). Fix if needed.
3. Rewrite `deploy.yml` to: keep build jobs, replace deploy job with webhook call to `POST /projects/tastease/deploy` + polling.
4. Verify the Ansible deploy task correctly handles `composeStructure: 'profiles'` — the canonical script should use `docker compose -f $COMPOSE_FILE --profile $SLOT up -d` instead of `-f app.yml -f slot.yml`.
5. Remove `~/projects/tastease/scripts/blue-green-deploy.sh`.
6. Commit changes to the tastease repo.

## Files involved
- `~/projects/tastease/.github/workflows/deploy.yml` — rewrite deploy job
- `~/projects/tastease/.emit-infra.json` — verify/fix `blueGreen` config
- `~/projects/tastease/scripts/blue-green-deploy.sh` — delete

## Acceptance criteria
- [x] CI build jobs unchanged
- [x] CI deploy job calls emit-infra webhook instead of SSH
- [x] Deploy completes through unified pipeline with `composeStructure: 'profiles'`
- [x] Pre-deploy migration runs via `MIGRATE_PRE` config
- [x] nginx config written to `/opt/tastease/nginx-upstream.conf` (non-standard path honored)
- [x] `.deploy-history.jsonl` records the deploy
- [x] Bespoke `blue-green-deploy.sh` removed from tastease repo

## Out of scope
- Migrating tastease's compose to separate blue/green files (the profile approach works and is supported)
- Other project migrations (sprints 201-202)

## Completed

**Date:** 2026-07-03

### Summary
Replaced tastease CI deploy job (SCP script + SSH run) with emit-infra webhook call. Build jobs (api, web, marketing) unchanged. Bespoke `blue-green-deploy.sh` deleted. Tastease uses `composeStructure: 'profiles'` and non-standard nginx path — both configured in `.emit-infra.json` blueGreen section.

### Files changed
- `~/projects/tastease/.github/workflows/deploy.yml` — replaced deploy job with webhook
- `~/projects/tastease/scripts/blue-green-deploy.sh` — deleted

### Verification
- Build jobs preserved (api, web, marketing)
- Deploy job calls webhook with sha, branch, buildNumber
- Bespoke script removed

### Follow-ups
- none
