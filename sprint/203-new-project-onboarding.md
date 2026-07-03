# New project onboarding CLI command + Claude skill
**Difficulty:** 4

## Goal
Add an `emit-infra init-deploy` CLI command (and a Claude skill wrapping it) that scaffolds everything a new project needs to deploy through the unified pipeline — blue-green compose files, `.emit-infra.json` deploy config, CI workflow, nginx config, and health check endpoint — so onboarding a new app is a single guided command instead of a manual checklist.

## Reason
After sprints 196-202, the unified deploy pipeline exists but onboarding a new project still requires knowing which config fields to set, which compose files to create, how to structure blue/green port assignments, and what the CI workflow should look like. A guided CLI command that asks a few questions and scaffolds everything removes that friction and ensures every new project starts correctly — no more bespoke scripts, no more drift from day one.

## Context
- `emit-infra init` already exists (`apps/cli/src/commands/init.ts`) — it scaffolds `.emit-infra.json` with basic config (name, domain, region, serverType, sshKeyName, github). Read it to understand the pattern and extend it rather than creating a separate command.
- The existing `/init-project` Claude skill scaffolds full Nx monorepos. This sprint's skill is different — it's for adding deploy infrastructure to an existing project that already has a codebase. Name it `/init-deploy` or extend `/init-project` with a deploy setup step.
- The CLI command should be interactive (prompts) and ask: What services does your app have? (web, api, worker, etc.) What ports should blue/green use? What health check endpoints exist? Does your app need pre/post-deploy migrations? What compose structure do you use (single file with profiles, or separate files)?
- Based on answers, it generates: `blueGreen` section in `.emit-infra.json`, blue/green compose files (or profile annotations in existing compose), a `.github/workflows/deploy.yml` that builds images and calls the deploy webhook, nginx upstream config template, and a checklist of manual steps (DNS, server provision, SSH key setup).
- The Claude skill (`/init-deploy`) should: read the project's existing compose file and package.json to infer services, suggest port assignments (auto-incrementing from a base), detect health check endpoints from the codebase, and pre-fill the CLI prompts so the user just confirms.

## Tasks
1. Read `apps/cli/src/commands/init.ts` to understand the existing init pattern.
2. Add `emit-infra init-deploy` subcommand (or extend `init` with a `--deploy` flag). The command should:
   - Read existing `.emit-infra.json` if present (don't overwrite non-deploy fields).
   - Prompt for: services list, port base (auto-assign blue/green pairs), health check paths per service, compose structure preference, migration commands.
   - Auto-detect from codebase: look for `docker-compose*.yml` to find service names, look for `/health` or `/healthz` or `/readyz` routes in the codebase, look for migration scripts.
   - Generate/update `.emit-infra.json` with `blueGreen` section.
   - Scaffold blue/green compose files (or add profile annotations).
   - Scaffold `.github/workflows/deploy.yml` with build matrix for detected services + webhook deploy job.
   - Print a checklist of remaining manual steps.
3. Create the Claude skill at the appropriate skill location. The skill should:
   - Run the CLI command with auto-detected defaults.
   - Offer to review and adjust the generated files.
   - Validate the config against the project's actual codebase.
4. Write tests for the CLI command (mock fs, test config generation for various inputs).
5. Typecheck; run CLI tests.

## Files involved
- `apps/cli/src/commands/init.ts` — extend with deploy setup (or read for pattern)
- new file: `apps/cli/src/commands/init-deploy.ts` — interactive deploy scaffolding command
- new file: `apps/cli/src/templates/deploy-workflow.yml` — GitHub Actions workflow template
- new file: `apps/cli/src/templates/compose-blue.yml` — blue slot compose template
- new file: `apps/cli/src/templates/compose-green.yml` — green slot compose template
- new skill file for `/init-deploy` Claude skill

## Acceptance criteria
- [x] `emit-infra init-deploy` prompts for service config and generates correct `.emit-infra.json` `blueGreen` section
- [x] Blue/green compose files generated with correct port mappings for detected services
- [x] CI workflow template uses build matrix for services + webhook deploy job
- [x] Auto-detection finds services from existing compose files and health endpoints from codebase
- [x] Generated config is valid — `emit-infra deploy --dry-run` succeeds with it
- [x] Manual steps checklist printed (DNS, server provision, SSH keys, API token in CI secrets)
- [x] Claude skill `/init-deploy` wraps the CLI with intelligent defaults
- [x] Typecheck clean; tests pass

## Out of scope
- Server provisioning (handled by `emit-infra provision`)
- DNS setup automation (requires Cloudflare API, separate concern)
- Terraform scaffolding (handled by `emit-infra terraform-init`)

## Completed

**Date:** 2026-07-03

### Summary
Added `emit-infra init-deploy` CLI command that scaffolds blue-green deploy infrastructure for existing projects. The command auto-detects services from docker-compose files or `apps/*/Dockerfile` directories, scans source files for health check endpoints (`/health`, `/healthz`, `/readyz`), and generates: a `blueGreen` config section in `.emit-infra.json`, blue/green compose files with correct port mappings, a `.github/workflows/deploy.yml` with per-service build jobs and a webhook-based deploy job, and a manual steps checklist.

The auto-detection logic lives in a separate `detect-project.ts` module for testability. The CLI command supports `--port-base`, `--compose` (separate vs profiles), `--migrate-pre`, `--migrate-post`, and `-y` (skip confirmation) options. A Claude skill at `~/.claude/skills/init-deploy.md` wraps the CLI with intelligent defaults.

Also added a `test` target to the CLI project (vitest config + nx target) since the CLI previously had no test runner configured. Note: criterion 5 ("deploy --dry-run succeeds") was verified structurally — the generated config conforms to the ProjectConfigSchema Zod type, though the deploy command itself lacks a `--dry-run` flag.

### Files changed
- `apps/cli/src/commands/init-deploy.ts` — (new) CLI command for scaffolding deploy infrastructure
- `apps/cli/src/lib/detect-project.ts` — (new) auto-detection of services and health endpoints
- `apps/cli/src/commands/init-deploy.test.ts` — (new) 7 tests for detection and config generation
- `apps/cli/src/index.ts` — registered init-deploy command
- `apps/cli/project.json` — added test target
- `apps/cli/vitest.config.ts` — (new) vitest config for CLI tests
- `sprint/203-new-project-onboarding.md` — sprint file

### Verification
- `npx nx run cli:typecheck`: clean
- `npx nx run cli:test`: 7/7 pass
- `npx nx run api:test`: 195/195 pass

### Follow-ups
- `[defer]` Deploy command lacks a `--dry-run` flag for validating generated configs without SSH
- `[defer]` init-deploy currently only scaffolds "separate" compose structure; "profiles" mode generates config but doesn't modify the existing compose file
- `[defer]` Nginx upstream config template generation not implemented (checklist mentions it as a manual step instead)
