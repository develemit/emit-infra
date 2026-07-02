# Split api.ts into Domain Modules
**Difficulty:** 4

## Goal
Break `apps/dashboard/src/lib/api.ts` (~645 lines, 60+ exports) into focused domain modules of ≤200 lines each, with `api.ts` becoming a thin re-export barrel.

## Reason
A single 645-line file with 60+ exported functions spanning a dozen domains (metrics, backups, billing, certs, cron, disk, history, containers, nginx, secrets, settings, SLA) violates the ≤300 line target and creates high cognitive load. Navigating to any specific function requires scrolling through unrelated code. Splitting reduces cognitive load and enables targeted imports in future sprints.

## Context
- `apps/dashboard/src/lib/api.ts` — Sprint 169 (explicit return types) must be done first; rely on those annotations being in place.
- **Do not update any call sites.** Maintain a re-export barrel `api.ts` so all existing `import ... from '~/lib/api'` continue to work unchanged.
- Proposed domain split (adjust based on what you find when reading the file):
  - `api-auth.ts` — `authHeaders`, `getApiBase`, `SseEvent`, `ProjectConfig` re-export
  - `api-projects.ts` — `ProjectSummary`, `ProjectStatus`, `getProjects`, `getProject`, `getProjectStatus`, `updateProjectConfig`, `ProjectConfigPatch`
  - `api-metrics.ts` — `MetricPoint`, `getMetrics`, `getContainerRestarts`, `getDeployCadence`, `DeployCadenceDay`, `getSla`, `SlaData`
  - `api-history.ts` — `DeployHistoryEntry`, `CiHistoryEntry`, `getDeployHistory`, `getCiHistory`, `getIncidents`
  - `api-containers.ts` — `Container`, `getContainers`, `restartContainer`, `getSshKeys`
  - `api-infra.ts` — `DiskBreakdown`, `getDiskBreakdown`, `NginxEndpoint`, `NginxEndpointsData`, `getNginxEndpoints`, `ScaleAdvice`, `getScaleAdvice`, `getCert`, `getBilling`
  - `api-ops.ts` — `getCron`, `getBackups`, `getBackupStatus`, `triggerBackup`
  - `api-secrets.ts` — `SecretsData`, `getSecrets`, `syncSecrets`
- Each module imports `authHeaders` and `getApiBase` from `api-auth.ts` only. No cross-domain module imports.
- After splitting, `api.ts` should be ≤50 lines: imports from each module + re-exports.

## Tasks
1. Read `api.ts` in full to catalog all exports and dependencies.
2. Create each domain module file. Move the relevant interfaces and functions, importing `authHeaders`/`getApiBase` from `./api-auth.js`.
3. Rewrite `api.ts` as a barrel: `export * from './api-auth.js'`, `export * from './api-projects.js'`, etc.
4. Check for circular imports — `api-auth.ts` must be a leaf (no imports from other domain modules).
5. Run `npx tsc --noEmit`.
6. Confirm each new file is ≤300 lines. If any exceeds this, split further.

## Files involved
- `apps/dashboard/src/lib/api.ts` — becomes re-export barrel (≤50 lines)
- new file: `apps/dashboard/src/lib/api-auth.ts`
- new file: `apps/dashboard/src/lib/api-projects.ts`
- new file: `apps/dashboard/src/lib/api-metrics.ts`
- new file: `apps/dashboard/src/lib/api-history.ts`
- new file: `apps/dashboard/src/lib/api-containers.ts`
- new file: `apps/dashboard/src/lib/api-infra.ts`
- new file: `apps/dashboard/src/lib/api-ops.ts`
- new file: `apps/dashboard/src/lib/api-secrets.ts`

## Acceptance criteria
- [x] `api.ts` is ≤50 lines (barrel re-exports only)
- [x] Each domain module is ≤300 lines
- [x] All existing `import ... from '~/lib/api'` imports resolve without any changes at call sites
- [x] No circular imports between domain modules
- [x] Typecheck passes

## Out of scope
- Updating call sites to import from specific domain modules (barrel handles this)
- Moving or updating existing tests
- Adding new functionality

## Completed

**Date:** 2026-07-02

### Summary
Split the 645-line `api.ts` into 8 focused domain modules. `api-auth.ts` is the leaf module containing constants, `authHeaders`, `getApiBase`, `openSseStream`, `apiFetch`, `SseEvent`, and `ProjectConfig` re-export. All other domain modules import only from `api-auth.ts` — no cross-domain imports exist.

Domain modules use `const API_BASE = getApiBase()` at module level for functions that need direct fetch calls. `apiFetch` (previously unexported) is now exported from `api-auth.ts` so all domain modules can use it without duplication. The barrel `api.ts` is 8 lines of `export *` re-exports — all existing call sites (`import ... from '~/lib/api'`) continue to resolve unchanged.

### Files changed
- `apps/dashboard/src/lib/api.ts` — rewritten as 8-line barrel (from 645 lines)
- (new) `apps/dashboard/src/lib/api-auth.ts` — 56 lines: auth, base utilities, apiFetch, SseEvent
- (new) `apps/dashboard/src/lib/api-projects.ts` — 116 lines: project CRUD, config patch, rollback
- (new) `apps/dashboard/src/lib/api-containers.ts` — 95 lines: containers, Docker, CI/deploy status
- (new) `apps/dashboard/src/lib/api-metrics.ts` — 89 lines: metrics, trends, cadence, SLA
- (new) `apps/dashboard/src/lib/api-history.ts` — 74 lines: deploy/CI history, logs, incidents
- (new) `apps/dashboard/src/lib/api-infra.ts` — 126 lines: disk, nginx, certs, cost, response times
- (new) `apps/dashboard/src/lib/api-ops.ts` — 91 lines: backups, cron, UFW
- (new) `apps/dashboard/src/lib/api-secrets.ts` — 18 lines: secrets drift, sync

### Verification
- line counts: api.ts=8, max module=126 (api-infra.ts) — all within limits
- `npx nx run-many -t typecheck`: clean (all 5 packages pass)
- no circular imports: api-auth.ts imports only from @emit-infra/types; domain modules import only from api-auth.ts

### Follow-ups
- `[defer]` call sites still import from `~/lib/api` barrel — future sprints could update them to import from specific domain modules for better tree-shaking and faster IDE go-to-definition
