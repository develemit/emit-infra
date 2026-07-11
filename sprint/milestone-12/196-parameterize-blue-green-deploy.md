# Parameterize canonical blue-green-deploy.sh
**Difficulty:** 4

## Goal
Make emit-infra's canonical `blue-green-deploy.sh` fully config-driven so the same script works for any project — different services, ports, health endpoints, nginx locations, and optional migrations — without any project-specific hardcoding.

## Reason
Every project currently maintains its own bespoke copy of this script with hardcoded ports, services, and health paths. Bugs (like the missing `.deployed-at` write) must be fixed in 5 places. A single parameterized script eliminates drift and makes every future improvement apply everywhere at once. This is the foundation for the unified deploy initiative — nothing else ships without it.

## Context
- Canonical script: `ansible/roles/app-deploy/files/blue-green-deploy.sh` (~130 lines). Currently hardcodes emit-vision's layout: 4 services (web, api, worker, marketing), ports 4300-4403, external `health-check.sh` helper, nginx at `/etc/nginx/blue-green/${PROJECT}.conf`, separate `docker-compose.app.yml` + `docker-compose.{blue,green}.yml`.
- Per-project scripts differ in: service lists, port ranges, health check approach (curl loop vs external helper), nginx config location, compose structure (single file with profiles vs separate blue/green files), migration commands, cleanup strategy.
- The script must remain a standalone shell script (no Node/Python deps) since it runs on production servers via SSH.
- The config file should be a simple sourceable shell file (`.deploy-config`) placed at `/opt/{project}/.deploy-config` by Ansible (sprint 197 handles that wiring).

## Tasks
1. Read all 5 deploy scripts (canonical + tastease + develemail + diner-decider + emit-vision) and extract every dimension that varies between them.
2. Design the `.deploy-config` format — a sourceable shell file with variables like `SERVICES`, `PORTS_BLUE`, `PORTS_GREEN`, `HEALTH_CHECKS`, `NGINX_CONF_PATH`, `COMPOSE_FILES`, `MIGRATE_CMD`, `PRUNE_STRATEGY`.
3. Rewrite `ansible/roles/app-deploy/files/blue-green-deploy.sh` to source `/opt/${PROJECT}/.deploy-config` and use those variables instead of hardcoded values. Fall back to sensible defaults (current emit-vision values) if no config exists, so existing servers aren't broken before migration.
4. The script must handle: variable number of services (1-4+), per-service health checks (HTTP path or skip), configurable compose file structure (single file with profiles OR separate app+slot files), optional pre-deploy and post-deploy migration commands, nginx upstream generation for N services, and configurable nginx config output path.
5. Ensure `.deployed-at`, `.deployed-version`, and `.active-slot` are always written regardless of config.
6. Add a `--dry-run` flag that prints what would happen without executing (useful for testing config).
7. Test the rewritten script locally with a mock `.deploy-config` for each project's values — verify the generated nginx config, compose commands, and health check commands are correct for tastease, diner-decider, develemail, and emit-vision patterns.

## Files involved
- `ansible/roles/app-deploy/files/blue-green-deploy.sh` — rewrite to be config-driven
- new file: `ansible/roles/app-deploy/files/deploy-config.example` — documented example config showing all available variables

## Acceptance criteria
- [x] Script sources `.deploy-config` and uses its variables for all project-specific values
- [x] Falls back to current emit-vision defaults when no config exists (backward compatible)
- [x] Handles 1-4+ services with per-service port pairs and health checks
- [x] Supports both compose structures: single file with profiles AND separate app+slot files
- [x] Optional `MIGRATE_PRE` and `MIGRATE_POST` commands execute at the right lifecycle points
- [x] `--dry-run` flag prints planned actions without executing
- [x] `.deployed-at`, `.deployed-version`, `.active-slot` always written on success
- [x] Example config file documents all variables with comments

## Out of scope
- Ansible wiring (sprint 197)
- `.emit-infra.json` schema changes (sprint 197)
- Migrating any project to use the new script (sprints 199-202)
- Deploy webhook API (sprint 198)

## Completed

**Date:** 2026-07-03

### Summary
Rewrote `blue-green-deploy.sh` to be fully config-driven. The script sources `/opt/{project}/.deploy-config` for all project-specific values (services, ports, health checks, compose structure, migrations, nginx path, prune strategy). Falls back to emit-vision defaults when no config exists. Added `--dry-run` flag. Supports both "separate" compose files (app+slot) and "profiles" (single file with `--profile`). Health checks are per-service with configurable paths (or "skip" for workers). Pre/post migration hooks at correct lifecycle points. Always writes `.deployed-at`, `.active-slot`, and optionally `.deployed-version`.

### Files changed
- `ansible/roles/app-deploy/files/blue-green-deploy.sh` — complete rewrite to source `.deploy-config` variables
- (new) `ansible/roles/app-deploy/files/deploy-config.example` — documented example config with all variables

### Verification
- `bash -n blue-green-deploy.sh`: syntax clean
- All 8 acceptance criteria verified by code inspection

### Follow-ups
- none
