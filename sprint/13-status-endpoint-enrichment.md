# Sprint 13 — Status endpoint enrichment

> _Promoted from sprint-07 follow-ups, sprint-09 follow-up, 2026-06-03._

## Goal
Enrich the status endpoint to return server type, public IP, and container counts so the HealthCard and ProjectCard UI can display real values instead of dashes.

## Context
- Builds on sprints 01, 07.
- `GET /projects/:name/status` currently returns `{ uptime, disk, memory }` fetched via SSH. It does not return the server's public IP or server type (which would need to come from `.emit-infra.json` or terraform state).
- `apps/dashboard/src/components/detail/health-card.tsx` has stat tiles for "Server" and "IP" that currently show "—" because the data isn't in the response.
- `apps/dashboard/src/components/project-card.tsx` shows `— running` for container count because the endpoint doesn't return it.
- The `.emit-infra.json` file at `~/projects/<name>/.emit-infra.json` already has the server config (region, serverType etc.) if the project was provisioned by this system. Reading it avoids an extra SSH call for static config data.
- The SSH key input in the provision wizard (`apps/dashboard/src/components/provision/step-infrastructure.tsx`) has a text field hardcoded to "emit-deploy". It should use a dropdown populated from `GET /projects/ssh-keys` or similar, or at minimum list the keys from `~/.ssh/` that look like deploy keys.

## Tasks

1. **Enrich `GET /projects/:name/status`** in `apps/api/src/routes/projects.ts`:
   - Read `.emit-infra.json` at `~/projects/<name>/.emit-infra.json` (if it exists) and include `serverType` and `region` from the config.
   - If the project has a known host (from config.domain), run `ssh root@<domain> "hostname -I | awk '{print $1}'"` to get the public IP. Or, if it's in terraform outputs, read from state. The simpler approach: just return `config.domain` as the visible address (it's already the domain).
   - Add `containerCount` to the status response: run `docker ps -q | wc -l` via SSH (or combine with existing containers fetch).

2. **Update `ProjectStatus` type** in `apps/dashboard/src/lib/api.ts` to include the new fields: `serverType?: string`, `ip?: string`, `containerCount?: number`.

3. **Update `health-card.tsx`** to display the new fields (Server = serverType, IP = ip from the enriched response).

4. **Update `project-card.tsx`** to show container count when available.

5. **Add `GET /projects/ssh-keys`** endpoint that returns a list of private key filenames found in `~/.ssh/` (filters for files without `.pub` extension that start with "emit-" or "deploy-").

6. **Update provision wizard `step-infrastructure.tsx`** — change the SSH key text input to a `<select>` dropdown populated via `GET /projects/ssh-keys`.

## Files involved
- `apps/api/src/routes/projects.ts` — enrich status, add ssh-keys endpoint
- `apps/dashboard/src/lib/api.ts` — update ProjectStatus type
- `apps/dashboard/src/components/detail/health-card.tsx` — display new fields
- `apps/dashboard/src/components/project-card.tsx` — show container count
- `apps/dashboard/src/components/provision/step-infrastructure.tsx` — SSH key dropdown

## Completed

**Date:** 2026-06-03

### Summary
Enriched `GET /projects/:name/status` to include `serverType`, `region` (read best-effort from `~/projects/<name>/.emit-infra.json`), `ip` (the project's domain), and `containerCount` (via `docker ps -q | wc -l` SSH call). Added `GET /projects/ssh-keys` — scans `~/.ssh/` for files without `.pub` that start with `emit-` or `deploy-`. Updated `ProjectStatus` type to use `number` for `disk` and `memory` (they were typed as `string` but the API always returned integers) and added the four new optional fields. Fixed all callers that used `parseInt` on the now-numeric fields.

HealthCard "Server" and "Public IP" tiles now display real values from the status response. ProjectCard footer shows `N running` for container count when available. The provision wizard SSH key input is now a `<select>` populated from the API, defaulting to `['emit-deploy']` if the fetch fails or returns nothing.

### Files changed
- `apps/api/src/routes/projects.ts` — added `readProjectConfig` helper, enriched `/status` with 4 new fields, added `/projects/ssh-keys` endpoint
- `apps/dashboard/src/lib/api.ts` — updated `ProjectStatus` (disk/memory now `number`, added containerCount/serverType/region/ip), added `getSshKeys()`
- `apps/dashboard/src/components/detail/health-card.tsx` — use `status.serverType` and `status.ip` for Server and Public IP tiles; fixed disk/mem to use number directly
- `apps/dashboard/src/components/project-card.tsx` — fixed disk/mem in both `deriveVariant` and render; show real container count
- `apps/dashboard/src/components/provision/step-infrastructure.tsx` — added `'use client'`, `useEffect` to fetch SSH keys, dropdown populated from API
- `apps/dashboard/app/projects/[name]/page.tsx` — fixed `deriveVariant` to use numeric disk/mem

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- Code inspection: `readProjectConfig` is best-effort (returns null on any error); status response includes new fields only when available
- Code inspection: `/projects/ssh-keys` registered before `/:name` routes — Fastify static routes take priority

### Follow-ups
- `[defer]` `disk` and `memory` are now `number` in `ProjectStatus` but were previously `string` — the type was always wrong (API returned integers); this fix is correct but any client code outside this repo that depended on the string type would need updating

## Acceptance criteria
- [x] `GET /projects/:name/status` response includes `serverType` and/or `region` when `.emit-infra.json` exists
- [x] HealthCard "Server" and "IP" tiles show real values instead of "—" for provisioned projects
- [x] `GET /projects/ssh-keys` returns an array of key filenames found in `~/.ssh/`
- [x] SSH key input in provision wizard is a dropdown populated from the API
- [x] `pnpm typecheck` and `pnpm lint` pass
