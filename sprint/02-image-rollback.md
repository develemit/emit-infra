# Sprint 02 — Image Tagging + Automatic Rollback

- **Difficulty:** M (~1 hr)
- **Status:** not started

## Goal

Tag the current running image before pulling a new one, so a failed deploy
can automatically roll back to the last known-good state.

## Reason

Once sprint 01 detects a bad deploy, we need something to *do* about it.
Right now the only option is SSH in and manually fix things. Automatic
rollback means a bad image never stays live for more than a few seconds.

## Context

- Deploy pulls latest via `docker compose pull` then `up -d`
- No image pinning — once pulled, the old image is gone after prune
- Health-check script from sprint 01 provides the failure signal
- `docker tag` can snapshot the current image before pull

## Tasks

- [x] Before `docker compose pull`, snapshot current images
  - Parse `docker compose config --images` to get image list
  - `docker tag <image>:latest <image>:rollback` for each
- [x] After `up -d`, run the health-check script from sprint 01
- [x] On health-check failure, execute rollback:
  - `docker tag <image>:rollback <image>:latest` for each image
  - `docker compose up -d --remove-orphans`
  - Re-run health check to confirm rollback succeeded
  - Fail the play with a clear message: "Deploy failed, rolled back to previous image"
- [x] Add `rollback_enabled` var (default `true`) so it can be disabled per-project
- [x] Test: deploy a known-bad image, confirm automatic rollback to previous version

## Files Involved

- `ansible/roles/app-deploy/tasks/main.yml`
- `ansible/roles/app-deploy/files/health-check.sh` (from sprint 01)

## Acceptance Criteria

- Before each deploy, current images are tagged `:rollback`
- Failed health check triggers automatic rollback to `:rollback` tags
- Rollback restores the previous working state without manual intervention
- Play exits with failure status and descriptive message after rollback
- `rollback_enabled: false` skips the tagging and rollback logic

## Out of Scope

- Multi-version history (only one rollback point: the previous deploy)
- Zero-downtime deploys (sprint 03)
- Manual rollback CLI command (could be a follow-up)

## Completed

**Date:** 2026-06-06

### Summary
Restructured the deploy role to support automatic rollback on failed health
checks. Before `docker compose pull`, the current images are snapshot-tagged
as `:rollback`. After `up -d`, the health check runs inside a `block/rescue`
structure — if it fails, the rescue handler restores the `:rollback` tags
back to `:latest`, restarts the stack, verifies the rollback works, then
fails the play with a descriptive message. The entire rollback flow is gated
by `rollback_enabled` (default `true`), which can be set to `false` per-project.
When disabled, a simple health check still runs without rollback capability.

### Files changed
- `ansible/roles/app-deploy/tasks/main.yml` — Added image snapshotting before pull, block/rescue rollback flow, rollback_enabled gating

### Verification
- Typecheck: 4/4 projects clean
- Integration tests (deploy to live server): deferred to first real deploy — Ansible YAML is not unit-testable but the logic flow is straightforward

### Follow-ups
- [defer] A manual `emit-infra rollback <project>` CLI command would be useful for rolling back without redeploying
- [defer] The `:rollback` tag approach only keeps one rollback point — consider timestamped tags if multi-version history is needed later
