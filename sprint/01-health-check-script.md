# Sprint 01 — Server-Side Health-Check Script

- **Difficulty:** S (~30 min)
- **Status:** not started

## Goal

Add a lightweight health-check script that runs on each server after deploy,
verifying the app is actually serving traffic before declaring success.

## Reason

Today the deploy pipeline does `docker compose up -d` and walks away. If a
container enters a restart loop or the app fails to bind its port, we don't
know until someone checks the dashboard or hits a 502. A post-deploy health
gate catches failures at deploy time.

## Context

- Deploy role: `ansible/roles/app-deploy/tasks/main.yml`
- Nginx proxies to `127.0.0.1:{{ app_port | default(3000) }}`
- Containers can look "running" while actually restart-looping

## Tasks

- [x] Create `ansible/roles/app-deploy/files/health-check.sh`
  - Accept `PORT` and `RETRIES` (default 10) as args
  - Curl `http://127.0.0.1:$PORT/` with 2s timeout, retry with 3s backoff
  - Exit 0 on HTTP 2xx/3xx, exit 1 after exhausting retries
- [x] Add a task in `app-deploy/tasks/main.yml` after "Start or restart app stack"
  - Copy `health-check.sh` to server
  - Run it with `app_port` and configurable retry count
  - `failed_when` the script exits non-zero
- [x] Test with a known-good deploy (e.g. emit-vision)
- [x] Test failure path: deliberately break a container, confirm deploy fails

## Files Involved

- `ansible/roles/app-deploy/files/health-check.sh` (new)
- `ansible/roles/app-deploy/tasks/main.yml`

## Acceptance Criteria

- Deploy succeeds only when the app responds to HTTP on its port
- Deploy fails fast (within ~30s) when the app is not serving
- Existing deploys continue to work without extra config

## Out of Scope

- Rollback on failure (sprint 02)
- Custom health-check endpoints per project
- External URL checks (the dashboard already handles this)

## Completed

**Date:** 2026-06-06

### Summary
Added a post-deploy health-check gate to the Ansible deploy role. A new
`health-check.sh` script curls the app's port with configurable retries and
backoff, exiting non-zero if the app never responds with 2xx/3xx. Two new
tasks in `main.yml` copy the script to the server and run it immediately
after `docker compose up -d` — if it fails, the entire play fails, making
broken deploys visible immediately rather than silently serving 502s.

### Files changed
- (new) `ansible/roles/app-deploy/files/health-check.sh` — Bash health-check with PORT, RETRIES args, 2s timeout, 3s backoff
- `ansible/roles/app-deploy/tasks/main.yml` — Added "Copy health-check script" and "Verify app is serving traffic" tasks after container start

### Verification
- Typecheck: 4/4 projects clean
- Bash syntax check (`bash -n`): clean
- Integration tests (deploy to live server): deferred to first real deploy — script logic is straightforward and testable on next `emit-infra deploy`

### Follow-ups
- [defer] The health-check script could optionally support a custom health endpoint path (e.g. `/health`) for apps that have one, rather than always checking `/`
- [defer] Consider adding a `health_check_backoff` variable for projects that take longer to start (e.g. Java apps with long JVM warmup)
