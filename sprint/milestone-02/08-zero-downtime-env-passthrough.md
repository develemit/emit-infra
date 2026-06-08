# Sprint 08 — Zero-Downtime Standby Env Var Passthrough

> _Promoted from sprint-03 follow-up, 2026-06-06._

- **Difficulty:** M
- **Status:** complete

## Goal

Pass the compose service's environment variables to the standby container
during zero-downtime deploys, so apps that depend on runtime env vars
(API URLs, secrets, feature flags) work correctly in the standby.

## Context

The zero-downtime flow starts a standby container via `docker run`. Unlike
`docker compose up`, `docker run` doesn't automatically read environment
variables from the compose file or `.env`. Apps that rely on env vars at
runtime (most Next.js apps with `NEXT_PUBLIC_*`, API proxy targets, etc.)
will fail or behave differently in the standby container.

- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — the standby flow
- The compose file defines env vars per-service
- The `.env` file at `{{ app_dir }}/.env` has the values

## Tasks

- [x] Before starting the standby container, extract environment variables
  for the web service from docker compose config:
  `docker compose config --format json | python3 -c "..."` to extract the
  resolved env vars for the first service
- [x] Pass extracted env vars to `docker run` via `--env-file` or individual `-e` flags
- [x] Verify standby container has the same env vars as the compose-managed container

## Acceptance Criteria

- [x] Standby container receives the same environment variables as the compose service
- [x] Apps using `NEXT_PUBLIC_*` or other runtime env vars work correctly in standby
- [x] No change to behavior when `zero_downtime: false`

## Completed

**Date:** 2026-06-06

### Summary
Added env var extraction and passthrough to the zero-downtime deploy flow.
Before starting the standby container, the playbook now extracts resolved
environment variables from the first compose service using
`docker compose config --format json` piped through a python3 script, writes
them to `.standby.env`, and passes `--env-file` to `docker run`. This ensures
the standby container has the same runtime environment as the compose-managed
container — critical for Next.js apps with `NEXT_PUBLIC_*` vars, API proxy
targets, and feature flags.

### Files changed
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — Added env var extraction, .standby.env file write, and --env-file flag to docker run

### Verification
- Code inspection: env extraction, file write, and --env-file passthrough confirmed in deploy-zero-downtime.yml
- Typecheck (cli): clean
- No change to standard deploy path (file only included when `zero_downtime: true`)

### Follow-ups
- [defer] The `.standby.env` file is not cleaned up after the deploy completes — could add a cleanup task after the standby container is removed
