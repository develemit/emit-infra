# Sprint 14 — Dashboard Nginx Health Monitoring

**Difficulty:** 3

## Goal

Surface nginx service status, site config presence, and SSL certificate expiry
in the dashboard's health card so nginx problems are visible at a glance —
before they cause a 502.

## Reason

Nginx runs as a host-level systemd service, not a Docker container, so it's
completely invisible to the current dashboard monitoring (which only checks
`docker ps`). When nginx is down or misconfigured, the dashboard shows all
containers healthy while the site returns 502. This was exactly the
emit-vision situation — everything looked green but nginx was the problem.
Adding nginx status to the dashboard closes this blind spot.

## Context

- Nginx is installed via `apt` during provisioning (`ansible/roles/nginx/tasks/main.yml`),
  runs as a systemd service, and proxies to Docker containers.
- Site configs live at `/etc/nginx/sites-enabled/<project_name>`.
- SSL certs are at `/etc/letsencrypt/live/<domain>/fullchain.pem`, obtained
  via certbot (either HTTP-01 or DNS-01 for wildcards).
- `apps/api/src/routes/projects.ts` — the `/projects/:name/status` endpoint.
  Runs a single SSH command that collects uptime, disk, memory, container
  counts, and `.deployed-version`. Returns a `StatusData` object. The SSH
  command output is split by newlines and parsed positionally.
- `apps/dashboard/src/lib/api.ts` — defines the `ProjectStatus` interface
  consumed by dashboard components.
- `apps/dashboard/src/components/detail/health-card.tsx` — renders the health
  card with `StatTile` components in a grid layout (4-col desktop, 2-col mobile).
- The status endpoint already reads the project name via `req.params.name`
  and the domain via `project.config.domain`.

## Tasks

1. [x] Extend the SSH command in the status endpoint
2. [x] Update the destructured parsing to capture three new lines
3. [x] Add three new fields to `StatusData`
4. [x] Add fields to dashboard's `ProjectStatus` interface
5. [x] Add nginx stat tiles to the health card
6. [x] Typecheck api and dashboard

## Files involved

- `apps/api/src/routes/projects.ts` — extend SSH command, StatusData type, parsing
- `apps/dashboard/src/lib/api.ts` — extend ProjectStatus interface
- `apps/dashboard/src/components/detail/health-card.tsx` — add nginx + SSL stat tiles

## Acceptance criteria

- [x] Status endpoint returns `nginxStatus`, `nginxConfigured`, and `sslExpiry`
- [x] `nginxStatus` is null when SSH fails or nginx isn't installed (graceful fallback)
- [x] Health card shows Nginx status tile with Active/Down indicator
- [x] Health card shows SSL tile with days-until-expiry
- [x] Typecheck clean across api and dashboard

## Completed

**Date:** 2026-06-06

### Summary
Extended the status SSH command with three new checks: `systemctl is-active nginx`,
site config existence test, and `openssl x509 -enddate` for SSL cert expiry. Added
`nginxStatus`, `nginxConfigured`, and `sslExpiry` to both the API `StatusData` type
and dashboard `ProjectStatus` interface. Updated the health card's `StatTile` component
to support an optional `color` prop, then added two helper functions (`nginxLabel` and
`sslDaysLeft`) to derive display values with color-coded indicators. The Nginx tile
shows "Active" (green) or "Down" (red), and the SSL tile shows days until expiry with
a warning color when < 14 days.

### Files changed
- `apps/api/src/routes/projects.ts` — added nginx/SSL checks to SSH command, extended StatusData and parsing
- `apps/dashboard/src/lib/api.ts` — added `nginxStatus`, `nginxConfigured`, `sslExpiry` to ProjectStatus
- `apps/dashboard/src/components/detail/health-card.tsx` — added `color` prop to StatTile, `nginxLabel`/`sslDaysLeft` helpers, Nginx and SSL tiles to both grids

### Verification
- Typecheck (api): clean
- Typecheck (dashboard): clean

### Follow-ups
none

## Out of scope

- Adding nginx checks to the deploy-readiness-check skill (sprint 15)
- Alerting when SSL is about to expire (future enhancement)
- Nginx config validation (`nginx -t`) — too slow for a polling endpoint
