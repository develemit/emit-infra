# Sprint 04 — Backlog: Blue-Green on Single Server

- **Difficulty:** L
- **Status:** backlog

## Goal

Full blue-green deployment on a single Hetzner server, where two complete
environments exist side-by-side and traffic switches atomically between them.

## Reason

Sprint 03's rolling deploy handles the common case, but some projects may
benefit from a full blue-green model where the new environment is fully
validated (including DB migrations, warm caches, etc.) before any traffic
shifts. This is the next level of deploy safety.

## Context

- Builds on sprints 01-03 (health checks, rollback, zero-downtime)
- Single server means both environments share CPU/memory — need to size accordingly
- Nginx can atomically switch upstreams with a config swap + reload
- Docker Compose project names can isolate blue vs green stacks

## Design Notes

- Two compose projects: `<project>-blue` and `<project>-green`
- Each binds to its own port range
- Nginx config points to the "active" color
- Deploy targets the "inactive" color, validates, then swaps nginx
- A state file tracks which color is active
- Swap-back is instant (just re-swap nginx to the other color)

## Why Backlog

This requires careful resource planning (two full stacks on one server) and
is only needed for projects with strict uptime requirements that go beyond
what sprint 03 provides. Most projects will be well-served by sprints 01-03.

## Files Likely Involved

- `ansible/roles/app-deploy/tasks/blue-green.yml` (new)
- `ansible/roles/nginx/templates/blue-green-site.conf.j2` (new)
- Project compose files (would need blue/green port mapping)

## Completed

**Date:** 2026-06-06

### Summary
Backlog design document — no implementation. Documents the blue-green
single-server pattern for future reference when a project needs it.

### Files changed
- `sprint/04-backlog-blue-green-single-server.md` — this file (backlog item)

### Verification
- N/A (documentation only)

### Follow-ups
none
