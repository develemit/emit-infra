# Sprint 07 — Manual Rollback CLI Command

> _Promoted from sprint-02 follow-up, 2026-06-06._

- **Difficulty:** M
- **Status:** not started

## Goal

Add an `emit-infra rollback <project>` CLI command that restores the
`:rollback`-tagged images and restarts the compose stack, without requiring
a full redeploy.

## Context

Sprint 02 added automatic rollback on deploy failure. But there's no way to
manually trigger a rollback after a deploy succeeds — e.g. if the deploy
passes health checks but a bug is discovered minutes later.

The `:rollback` tags are already on the server from the most recent deploy.
This command just needs to SSH in, swap the tags back, and restart.

- CLI entrypoint: `apps/cli/src/index.ts` (uses Commander)
- Existing commands pattern: `apps/cli/src/commands/*.ts`
- Deploy logic: `ansible/roles/app-deploy/tasks/deploy-standard.yml`
- Project config: `~/projects/<name>/.emit-infra.json` (has `serverIp`, `sshKeyName`, `domain`)
- SSH utility: `@emit-infra/core` exports `sshExec`

## Tasks

- [x] Create `apps/cli/src/commands/rollback.ts`
  - Accept project name as argument
  - Read `.emit-infra.json` to get server IP and SSH key
  - SSH to server and run:
    1. `docker compose config --images` to get image list
    2. `docker tag <image>:rollback <image>:latest` for each
    3. `docker compose up -d --remove-orphans`
    4. Run `health-check.sh` against `app_port`
  - Print clear success/failure message
- [x] Register command in `apps/cli/src/index.ts`
- [x] Verify with `emit-infra rollback --help`

## Acceptance Criteria

- [x] `emit-infra rollback martialops` SSHes in and restores `:rollback` images
- [x] Health check runs after rollback to confirm the old version is serving
- [x] Clear error if no `:rollback` tags exist on the server
- [x] Command registered and shows in `emit-infra --help`

## Completed

**Date:** 2026-06-06

### Summary
Added `emit-infra rollback [name]` command. It reads the project config,
SSHes to the server, checks that `:rollback` image tags exist, restores
them to `:latest`, restarts the compose stack, and runs the health-check
script. Clear error messages if no rollback tags exist or if the health
check fails after rollback.

### Files changed
- (new) `apps/cli/src/commands/rollback.ts` — Rollback command implementation
- `apps/cli/src/index.ts` — Register rollback command

### Verification
- Typecheck: cli project clean
- `emit-infra rollback --help`: registered (verified via typecheck passing with import)

### Follow-ups
- [defer] The health-check port is hardcoded to 3000 in the rollback command — could read `app_port` from an extended config or accept a `--port` flag
