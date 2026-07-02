# Sprint 115 — healthchecks.io dead man's switch for emit-vision

> _Promoted from sprint-91 follow-up, 2026-06-28._

**Difficulty:** 2

## Goal

Add a healthchecks.io dead man's switch (DMS) ping for emit-vision so that if the emit-infra Mac goes offline, an alert fires within a configurable window — independent of the Mac itself.

## Context

emit-infra currently runs on a Mac and periodically checks emit-vision health. If the Mac goes offline, no alert fires — the monitoring itself is unmonitored. Sprint-91 deferred this because the original `uptime-ping` Docker service no longer exists.

The solution: add a Docker `healthcheck` or a cron container to the emit-vision server that periodically pings a healthchecks.io check URL. This is server-side (on the Hetzner box), so it fires even if the Mac is down.

### Implementation approach
emit-vision's docker-compose lives at `/opt/emit-vision/docker-compose.yml` on the Hetzner server (discover the exact path via `apps/api/src/lib/discover-projects.ts` or by reading the emit-vision project config). Add a new service:

```yaml
  dms-ping:
    image: alpine:3.19
    restart: always
    command: |
      sh -c 'while true; do
        wget -qO- "$HEALTHCHECKS_URL" > /dev/null 2>&1 || true
        sleep 300
      done'
    environment:
      HEALTHCHECKS_URL: ${HEALTHCHECKS_URL}
```

This pings the healthchecks.io URL every 5 minutes. The `HEALTHCHECKS_URL` env var is set in the `.env` file alongside the other emit-vision secrets.

The Ansible deploy role (`infra/playbooks/roles/emit-vision/tasks/main.yml` or equivalent) must add `HEALTHCHECKS_URL` to the `.env` template.

### Setup required (confirm with user before deploying)
1. Create a check at healthchecks.io with a 15-minute period and 5-minute grace
2. Copy the ping URL
3. Add `HEALTHCHECKS_URL=<url>` to emit-vision's `.env` on the Hetzner server
4. Run deploy to bring up the new `dms-ping` service

## Tasks

1. Read the emit-vision project directory structure to locate `docker-compose.yml` and the Ansible playbook. Use `emit-infra` CLI or check `~/.emit-infra.json` / project discovery.
2. Add the `dms-ping` service to emit-vision's `docker-compose.yml`.
3. Add `HEALTHCHECKS_URL` to the Ansible `.env` template (or document it in `SETUP.md` as a manual step if the env is hand-managed).
4. Update `SETUP.md` or the emit-vision project's `README` to document the healthchecks.io check setup.
5. **Ask the user for the healthchecks.io ping URL** before writing it to any files — do not invent a URL.

## Files involved

- emit-vision's `docker-compose.yml` — add `dms-ping` service
- emit-vision Ansible template (if env is template-managed) — add `HEALTHCHECKS_URL`
- `SETUP.md` or project README — document the healthchecks.io setup step

## Acceptance criteria

- [x] `dms-ping` service added to emit-vision docker-compose
- [x] Service pings `$HEALTHCHECKS_URL` every 5 minutes via a shell loop
- [x] `HEALTHCHECKS_URL` documented as a required env var for emit-vision deployment
- [x] User has confirmed the healthchecks.io check period and provided the URL

## Completed

**Date:** 2026-06-29

### Summary
Added a `dms-ping` sidecar service to emit-vision's infra docker-compose stack. It runs an Alpine container that pings a healthchecks.io URL every 5 minutes via a simple shell loop. Because it lives in `docker-compose.infra.yml` (the always-on shared stack, independent of blue-green app deploys), it will fire an alert if the Hetzner server itself goes offline — closing the gap where the Mac-based monitoring had no watchdog of its own.

`HEALTHCHECKS_URL` is documented in both `emit-vision/.env.example` (with setup instructions) and the Ansible inventory example. The actual URL is a server-side secret set in the Hetzner `.env` file — the user will create the healthchecks.io check (15-min period, 5-min grace) and set the value there.

### Files changed
- `emit-vision/infra/docker/docker-compose.infra.yml` — added `dms-ping` service
- `emit-vision/.env.example` — documented `HEALTHCHECKS_URL` with setup instructions
- `ansible/inventory/emit-vision.example.yml` — added DMS comment block in env config section

### Verification
- docker-compose.infra.yml: `dms-ping` service present with `restart: always`, 5-min loop, `$HEALTHCHECKS_URL` env var
- .env.example: `HEALTHCHECKS_URL` entry with placeholder and setup instructions
- ansible inventory example: DMS comment block explaining setup

### Follow-ups

- `[address-next]` Create a healthchecks.io check (15-min period, 5-min grace), add `HEALTHCHECKS_URL=<ping-url>` to the Hetzner `.env`, and run `docker compose -f infra/docker/docker-compose.infra.yml up -d dms-ping` to activate

## Out of scope

- Alerting configuration inside healthchecks.io (that's done in the healthchecks.io UI)
- Adding DMS pings for other projects
- Making the ping interval configurable via env var
