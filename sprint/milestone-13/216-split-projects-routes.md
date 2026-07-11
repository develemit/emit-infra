# Split routes/projects.ts (544 lines) by sub-domain
**Difficulty:** 2

## Goal
`apps/api/src/routes/projects.ts` is split into focused route modules (~150-200 lines each) grouped by sub-domain, with no behavior change and all existing tests still passing.

## Reason
2026-07-10 audit: at 544 lines, this is the largest file in the repo and nearly 2x the 300-line house cap. It mixes at least four distinct concerns — project registry/settings, live status, docker/container ops, and backups — which makes every edit riskier than it needs to be. File-size pillar graded B largely because of this file and history.ts (sprint 217).

## Context
- `apps/api/src/routes/projects.ts` — 17 routes. Current registrations by line:
  - Registry/settings: `GET /projects` , `GET /projects/unregistered`, `POST register` (108), `PATCH settings` (162), `GET ssh-keys` (197)
  - Status/CI/deploy: `:name/status` (209), `:name/ci-status` (481), `:name/deploy-status` (496)
  - Docker/containers: `:name/docker-usage` (284), `POST :name/prune` (309), `POST restart container` (332), `:name/containers` (511)
  - Backups: `:name/backup-status` (354), `:name/backups` (380), `DELETE backups/:key` (414), `POST backups/trigger` (438), `backups/:key/download` (457)
- Suggested split (follow the sub-domain grouping above):
  - `projects.ts` — registry/settings/ssh-keys (keeps the name so route registration in the app entry barely changes)
  - `project-status.ts` — status, ci-status, deploy-status
  - `project-docker.ts` — docker-usage, prune, restart, containers
  - `project-backups.ts` — the five backup routes
- Check the Fastify plugin registration site (app entry / route index) to see how projects.ts is registered; new modules follow the same pattern with the same prefix so URLs are unchanged.
- Shared helpers used across the split files (config lookup, host resolution, SAFE_NAME_RE checks) likely live in `apps/api/src/lib/project-helpers.ts` already — move any route-file-local shared helpers there rather than cross-importing between route files.
- Existing route tests (`projects.test.ts` or similar from sprint 206) must keep passing; update their imports/mocks if they target the moved routes. Sprint 206 gotcha: mocks of `../lib/project-helpers.js` must export `SAFE_NAME_RE`, `SAFE_CONTAINER_RE`, `SAFE_DOMAIN_RE`.

## Tasks
1. Read `projects.ts` fully; map each route and its local helpers to one of the four target modules.
2. Create the three new route modules and move routes verbatim (no logic edits). Move shared local helpers to `lib/project-helpers.ts` if used by more than one module.
3. Register the new modules alongside the slimmed `projects.ts` with identical prefixes — the external URL surface must not change.
4. Update any test files whose imports/mocks point at moved code; split test files to mirror the new modules if that keeps each under ~300 lines.
5. Run `pnpm nx test api`, `pnpm nx typecheck api`, `pnpm nx lint api`.

## Files involved
- `apps/api/src/routes/projects.ts` — slims to registry/settings routes
- new file: `apps/api/src/routes/project-status.ts`
- new file: `apps/api/src/routes/project-docker.ts`
- new file: `apps/api/src/routes/project-backups.ts`
- app route-registration entry — register new modules
- `apps/api/src/lib/project-helpers.ts` — receives shared helpers if needed
- existing route test files — import/mock path updates only

## Acceptance criteria
- [x] No file in the split exceeds ~300 lines
- [x] Every route URL, method, and response shape is unchanged (pure move)
- [x] All existing tests pass without weakening assertions
- [x] Tests pass, typecheck clean, lint clean

## Out of scope
- Any behavior or validation changes (if a gap is spotted, add a `[defer]` note)
- history.ts split (sprint 217)

## Completed

**Date:** 2026-07-11

### Summary
Split `apps/api/src/routes/projects.ts` (544 lines) into four focused route modules grouped by sub-domain. The original file was nearly 2x the 300-line house cap and mixed four distinct concerns: project registry/settings, live status, docker/container ops, and backups. The split reduces cognitive load and isolates concerns.

Each new module handles a single domain and stays under 200 lines. Shared validation schemas and caches are moved to respective modules since they're not used cross-module. All three new route functions are registered in `index.ts` with the same `/projects` prefix, so external URLs are unchanged — pure internal reorganization.

### Files changed
- `apps/api/src/routes/projects.ts` — slimmed to 131 lines (registry/settings only)
- (new) `apps/api/src/routes/project-status.ts` — 182 lines (status, ci-status, deploy-status)
- (new) `apps/api/src/routes/project-docker.ts` — 117 lines (docker-usage, prune, restart, containers)
- (new) `apps/api/src/routes/project-backups.ts` — 134 lines (backup-status, backups CRUD, trigger, download)
- (new) `apps/api/src/routes/project-status.test.ts` — 107 lines (status route tests, extracted from projects.test.ts)
- (new) `apps/api/src/routes/project-docker.test.ts` — 91 lines (docker/containers tests, extracted from projects.test.ts)
- (new) `apps/api/src/routes/project-backups.test.ts` — 67 lines (backup route tests, new coverage file)
- `apps/api/src/routes/projects.test.ts` — slimmed to 110 lines (only registry/settings tests)
- `apps/api/src/routes/backup.test.ts` — updated import to use projectBackupsRoutes
- `apps/api/src/index.ts` — added imports and registrations for three new route functions

### Verification
- `pnpm nx test api`: 266/266 pass
- `pnpm nx typecheck api`: clean
- `pnpm nx lint api`: clean
- All files under 300 lines cap; original 544-line file now split into four modules (131, 182, 117, 134 lines)
- URL surface unchanged; all routes respond from same prefixes

### Follow-ups
- none
