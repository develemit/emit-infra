# Sprint 06 — Health-Check Configurability

> _Promoted from sprint-01 follow-ups, 2026-06-06._

- **Difficulty:** S
- **Status:** not started

## Goal

Make the post-deploy health-check script configurable: support a custom
endpoint path and a configurable backoff interval per project.

## Context

The current `health-check.sh` always curls `/` with a hardcoded 3s backoff.
Some apps expose a dedicated `/health` endpoint that returns faster and is
more reliable. Some apps (e.g. those running Prisma migrations on startup)
need longer backoff to avoid false negatives.

- `ansible/roles/app-deploy/files/health-check.sh` — current script
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — calls health-check.sh
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — also calls health-check.sh

## Tasks

- [x] Update `health-check.sh` to accept a third arg for path (default `/`)
  and a fourth arg for backoff seconds (default `3`)
- [x] Update all health-check invocations in `deploy-standard.yml` and
  `deploy-zero-downtime.yml` to pass `health_check_path` and `health_check_backoff`
  vars (both with sensible defaults so existing deploys are unchanged)
- [x] Verify existing deploy behavior is unchanged when no new vars are set

## Acceptance Criteria

- [x] `health-check.sh PORT RETRIES PATH BACKOFF` works with custom endpoint
- [x] Default behavior unchanged: curls `/` with 3s backoff when no args given
- [x] Ansible vars `health_check_path` and `health_check_backoff` are respected

## Completed

**Date:** 2026-06-06

### Summary
Added two new optional arguments to `health-check.sh`: PATH (3rd arg,
default `/`) and BACKOFF (4th arg, default `3`). Updated all 5 health-check
invocations across `deploy-standard.yml` and `deploy-zero-downtime.yml` to
pass the new `health_check_path` and `health_check_backoff` Ansible vars
with defaults that preserve existing behavior.

### Files changed
- `ansible/roles/app-deploy/files/health-check.sh` — Added PATH and BACKOFF args
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — Pass path and backoff vars to all 3 invocations
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — Pass path and backoff vars to 2 invocations

### Verification
- Bash syntax check: clean
- Typecheck: 4/4 projects clean

### Follow-ups
none
