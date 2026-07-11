# CLI arg-construction tests for deploy, provision, destroy
**Difficulty:** 3

## Goal
The config→arguments/extra-vars construction inside the CLI's three destructive commands (`deploy`, `provision`, `destroy`) is covered by unit tests with mocked execution, so a regression in what gets passed to Ansible/Terraform is caught before it touches a server.

## Reason
2026-07-10 audit: `apps/cli/src/commands/` has 1 test file for 19 commands, and the untested layer is exactly what broke develemail's deploy this week (`.deploy-config` template referencing a nonexistent `docker-compose.app.yml`). The executors these commands call are tested (sprint 205, `packages/core`), but the CLI layer that assembles extra-vars, inventory, and compose file lists is not. These commands operate on real production servers — this is the highest-risk untested code in the repo.

## Context
- `apps/cli/src/commands/deploy.ts` — builds Ansible extra-vars from `.emit-infra.json` project config. Key logic: `blue_green_compose_files` list is hardcoded then filtered with `.filter(f => existsSync(f))` (~lines 123-129); `build_number` var passthrough (sprint 204); the `-n/--dry-run` flag (sprint 212) resolves config and builds the full extra-vars set without SSH — this makes the construction path easy to exercise.
- `apps/cli/src/commands/provision.ts` and `destroy.ts` — same shape: read config, build terraform/ansible invocations via `@emit-infra/core`.
- Test pattern to copy: `packages/core/src/ssh.test.ts` / `ansible.test.ts` (sprint 205) — `vi.mock('execa')`, assert exact argument arrays. For the CLI, mock `@emit-infra/core` exports (`runAnsible`, `runTerraform`, `sshExec`) instead of execa directly, plus `node:fs` `existsSync` where file-existence filtering matters.
- Existing CLI test: `apps/cli/src/commands/init-deploy.test.ts` — proves vitest is already wired for this project (`apps/cli/vitest.config.ts`); follow its conventions.
- Fixture configs: build minimal in-memory `.emit-infra.json`-shaped objects — one "separate" blue-green project (like develemail: no app.yml), one with app.yml, one standard-strategy project.
- Gotcha: the CLI is bundled to `apps/cli/dist` for hooks; tests target `src` so no rebuild concerns.

## Tasks
1. Read `deploy.ts`, `provision.ts`, `destroy.ts` and identify the pure/near-pure construction logic. If any is inline and hard to test, extract to exported helpers in the same file (no behavior change).
2. Write `deploy.test.ts`: assert extra-vars for (a) standard strategy, (b) blue-green with app.yml present, (c) blue-green with app.yml missing — verify the missing file is filtered out of copied files; (d) `build_number` present in extra-vars when supplied; (e) `--dry-run` performs zero calls into `@emit-infra/core` SSH/Ansible execution.
3. Write `provision.test.ts`: assert terraform + ansible invocations receive the right project name, server IP source, and var files.
4. Write `destroy.test.ts`: assert the terraform destroy invocation targets the right directory/workspace and that any confirmation gate is respected (mock prompt to decline → nothing executes).
5. Run `pnpm nx test cli`, `pnpm nx typecheck cli`, `pnpm nx lint cli`.

## Files involved
- `apps/cli/src/commands/deploy.ts` — possibly extract construction helpers; no behavior change
- `apps/cli/src/commands/provision.ts`, `destroy.ts` — same
- new file: `apps/cli/src/commands/deploy.test.ts`
- new file: `apps/cli/src/commands/provision.test.ts`
- new file: `apps/cli/src/commands/destroy.test.ts`

## Acceptance criteria
- [x] Deploy extra-vars construction tested for standard, blue-green-with-app.yml, and blue-green-without-app.yml (develemail case)
- [x] Declined confirmation in destroy executes nothing
- [x] `--dry-run` provably makes no core-executor execution calls
- [x] Tests pass, typecheck clean, lint clean; no behavior changes to the commands

## Out of scope
- Tests for the other 13 CLI commands (status, logs, secrets-sync, etc.)
- Refactoring command structure beyond minimal helper extraction
- Integration tests that actually SSH anywhere

## Completed

**Date:** 2026-07-10

### Summary
Extracted `buildDeployExtraVars` as an exported helper in `deploy.ts`, accepting an `existsFn` parameter (defaults to `existsSync`) so tests can control file-existence filtering without module-level mocking. The action now calls the helper and checks `extraVars.ghcr_token` for the GHCR warning — no behavior change.

Three test files cover the sprint's required cases: deploy covers 12 assertions across standard strategy, blue-green with/without `app.yml`, `build_number` passthrough, `--dry-run` suppression, and non-dry-run invocation; provision covers init→apply and init→plan-only paths; destroy covers declined confirmation (two variants), matching confirmation, and `--yes` flag bypass.

### Files changed
- `apps/cli/src/commands/deploy.ts` — extracted `buildDeployExtraVars` as exported function; action uses it
- (new) `apps/cli/src/commands/deploy.test.ts` — 12 unit tests for extra-vars construction and dry-run behavior
- (new) `apps/cli/src/commands/provision.test.ts` — 3 tests for terraform init/apply/plan invocations
- (new) `apps/cli/src/commands/destroy.test.ts` — 4 tests for confirmation gate and --yes flag

### Verification
- `pnpm nx test cli`: 26/26 pass (19 new tests across 3 new files)
- `pnpm nx typecheck cli`: clean
- Lint on changed/new files: clean; 7 pre-existing errors in untouched files (audit.ts, init-deploy.ts, init-deploy.test.ts, vitest.config.ts)

### Follow-ups
- `[defer]` Pre-existing lint errors in audit.ts, init-deploy.ts, init-deploy.test.ts, vitest.config.ts — 7 errors unrelated to this sprint, should be swept in a future lint-cleanup sprint
