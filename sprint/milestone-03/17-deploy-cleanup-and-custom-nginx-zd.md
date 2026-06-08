# Sprint 17 — Deploy cleanup + zero-downtime custom nginx support

> _Promoted from sprint-03 and sprint-08 follow-ups (backlog), 2026-06-06._

## Goal

Fix two small gaps in the deploy pipeline: clean up the `.standby.env`
temp file after zero-downtime deploys, and support projects with custom
nginx configs in the zero-downtime path.

## Context

### Standby env cleanup
`deploy-zero-downtime.yml` writes `.standby.env` (line 63) to pass env
vars to the standby container, but never removes it after the deploy
completes. The file contains environment variables and should be cleaned
up.

### Custom nginx + zero-downtime
The zero-downtime deploy swaps nginx upstream using the
`upstream-site.conf.j2` template (lines 98-103, 118-124). Projects that
use `nginx_custom_config_src` (like emit-vision) skip this step
(`when: nginx_custom_config_src is not defined`), meaning they can't
benefit from zero-downtime deploys.

Fix: for custom configs, parse the existing config for the `proxy_pass`
port and sed-replace it with the standby port, then restore after cutover.

## Tasks

### Standby cleanup
1. Add a cleanup task after the standby container is removed in
   `deploy-zero-downtime.yml` to delete `.standby.env`

### Custom nginx zero-downtime
1. Add a task that detects `nginx_custom_config_src` is defined
2. Read the current nginx site config and extract the `proxy_pass` port
3. Replace it with the standby port, reload nginx
4. After compose restart + health check, restore the original port
5. Reload nginx again

## Files involved

- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml`

## Acceptance criteria

- [x] `.standby.env` is deleted after zero-downtime deploy completes
- [x] Zero-downtime deploy works with custom nginx configs
- [x] Standard template-based configs still work unchanged
- [x] Rollback path also cleans up `.standby.env`

## Completed

**Date:** 2026-06-06

### Summary
Added `.standby.env` cleanup on both success and failure paths of the
zero-downtime deploy. On the failure path (already partially done), the env
file is now deleted right after the standby container is removed. On the
success path, a new cleanup task removes the file after the standby container
is torn down at the end of the deploy.

For custom nginx configs, the deploy now backs up the site config, sed-replaces
the `proxy_pass` port from the app port to the standby port, and reloads nginx.
After the compose stack restarts and passes health checks, the original config
is restored from backup and the backup file is removed. This runs alongside
(not instead of) the existing template-based path — each is gated by
`nginx_custom_config_src is [not] defined`.

### Files changed
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — added success-path `.standby.env` cleanup; added backup/sed-swap/restore tasks for custom nginx configs

### Verification
- code inspection: both cleanup paths confirmed present
- code inspection: template-based tasks unchanged, guarded by `when: nginx_custom_config_src is not defined`
- code inspection: custom nginx tasks guarded by `when: nginx_custom_config_src is defined`

### Follow-ups
none
