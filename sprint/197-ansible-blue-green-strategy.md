# Blue-green Ansible strategy + config schema
**Difficulty:** 3

## Goal
Wire the parameterized `blue-green-deploy.sh` (from sprint 196) into emit-infra's Ansible deploy pipeline as a third deploy strategy, and extend `.emit-infra.json` with `blueGreen` config that drives the deploy config generation.

## Reason
The Ansible deploy role currently supports `deploy-standard` and `deploy-zero-downtime` but has no strategy for blue-green deploys. Projects that use blue-green bypass Ansible entirely and run bespoke scripts. Adding a `deploy-blue-green` strategy means `emit-infra deploy` works for blue-green projects — the CLI becomes the single entry point for all deploy types.

## Context
- Ansible role: `ansible/roles/app-deploy/tasks/main.yml` dispatches to `deploy-standard.yml` or `deploy-zero-downtime.yml` based on `zero_downtime` flag. Add a `blue_green` flag that dispatches to a new `deploy-blue-green.yml`.
- `main.yml` already has `blue_green` conditional blocks (lines 45-87) that copy the deploy script, health-check scripts, compose files, init `.active-slot`, and start infra. These run before the strategy dispatch.
- The new `deploy-blue-green.yml` task needs to: generate `/opt/{project}/.deploy-config` from Ansible vars, then run `blue-green-deploy.sh`.
- CLI: `apps/cli/src/commands/deploy.ts` calls `runAnsible('deploy', inventory, extraVars)`. It needs to pass `blue_green: true` and the service/port/health config when `.emit-infra.json` has a `blueGreen` section.
- Config schema: `ProjectConfig` type in `packages/core/src/config.ts` (or wherever `loadConfig` is defined). Add `blueGreen?: { services: { name, bluePort, greenPort, healthPath? }[], nginxConfPath?, migratePre?, migratePost?, composeStructure: 'profiles' | 'separate' }`.
- Each project's `.emit-infra.json` already has `deploy.composeSrc`, `deploy.appPort`, `healthCheck.url` — the new `blueGreen` section is additive.

## Tasks
1. Read `packages/core/src/config.ts` to find the `ProjectConfig` type and `loadConfig` function. Add the `blueGreen` schema.
2. Update `apps/cli/src/commands/deploy.ts` to detect `config.blueGreen` and pass the service/port/health config as Ansible extra vars (`blue_green: true`, `bg_services`, `bg_nginx_conf_path`, `bg_migrate_pre`, `bg_migrate_post`, `bg_compose_structure`).
3. Create `ansible/roles/app-deploy/tasks/deploy-blue-green.yml`: generate `.deploy-config` from Ansible vars using a `template` or `copy content`, then run `blue-green-deploy.sh {{ project_name }}`.
4. Update `ansible/roles/app-deploy/tasks/main.yml` to dispatch to `deploy-blue-green.yml` when `blue_green` is true (before the existing standard/zero-downtime dispatch).
5. Write `.emit-infra.json` `blueGreen` configs for all 4 projects (don't change their CI yet — just define the config). Validate each against the actual values in their bespoke scripts.
6. Typecheck; run API tests (config changes may affect API if it reads the config).

## Files involved
- `packages/core/src/config.ts` (or equivalent) — extend `ProjectConfig` with `blueGreen` schema
- `apps/cli/src/commands/deploy.ts` — pass blue-green vars to Ansible
- new file: `ansible/roles/app-deploy/tasks/deploy-blue-green.yml` — generate config + run script
- `ansible/roles/app-deploy/tasks/main.yml` — add dispatch for blue-green strategy
- `~/projects/tastease/.emit-infra.json` — add `blueGreen` section
- `~/projects/develemail/.emit-infra.json` — add `blueGreen` section
- `~/projects/diner-decider/.emit-infra.json` — add `blueGreen` section
- `~/projects/emit-vision/.emit-infra.json` — add `blueGreen` section

## Acceptance criteria
- [x] `emit-infra deploy` with a `blueGreen` config generates correct `.deploy-config` on the server and runs the canonical script
- [x] All 4 projects have valid `blueGreen` sections in `.emit-infra.json` matching their current port/service/health setups
- [x] `deploy-blue-green.yml` Ansible task generates `.deploy-config` and invokes the script
- [x] `main.yml` dispatches to blue-green strategy when `blue_green` is true
- [x] Typecheck clean; existing tests pass

## Out of scope
- Actually migrating any project's CI to use `emit-infra deploy` (sprints 199-202)
- Deploy webhook API (sprint 198)
- Removing per-project bespoke scripts (sprints 199-202)

## Completed

**Date:** 2026-07-03

### Summary
Added `blueGreen` schema to `ProjectConfigSchema` with services (name, bluePort, greenPort, healthPath), nginxConfPath, migratePre/Post, and composeStructure ('profiles' | 'separate'). Updated `deploy.ts` to pass these as Ansible extra vars when present. Created `deploy-blue-green.yml` Ansible task that generates `.deploy-config` from vars and runs the canonical script. Updated `main.yml` dispatch to route to blue-green before standard/zero-downtime. Added `blueGreen` configs to all 4 project `.emit-infra.json` files matching their actual port/service/health values.

### Files changed
- `packages/types/src/project-config.ts` — added `blueGreen` optional schema
- `apps/cli/src/commands/deploy.ts` — pass blue-green vars to Ansible
- (new) `ansible/roles/app-deploy/tasks/deploy-blue-green.yml` — generate config + run script
- `ansible/roles/app-deploy/tasks/main.yml` — added blue-green strategy dispatch
- `~/projects/emit-vision/.emit-infra.json` — added blueGreen (4 services, separate)
- `~/projects/tastease/.emit-infra.json` — added blueGreen (3 services, profiles)
- `~/projects/diner-decider/.emit-infra.json` — added blueGreen (2 services, separate)
- `~/projects/develemail/.emit-infra.json` — added blueGreen (2 services, separate)

### Verification
- `npx nx run cli:typecheck`: clean
- `npx nx run api:test`: 189/189 pass

### Follow-ups
- none
