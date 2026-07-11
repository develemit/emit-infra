# Split routes/history.ts (448 lines) by sub-domain
**Difficulty:** 2

## Goal
`apps/api/src/routes/history.ts` is split into focused route modules grouped by sub-domain (metrics/timeseries vs incidents/reliability), no behavior change, all tests passing.

## Reason
2026-07-10 audit: second-largest file in the repo at 448 lines (house cap is 300). It mixes raw metric timeseries endpoints with incident/SLA/reliability analytics — two audiences (charts vs reliability panels) that change for different reasons. Companion to sprint 216.

## Context
- `apps/api/src/routes/history.ts` — routes by line: `:name/metrics` (104), `deploy-history` (130), `ci-history` (146), four unnamed routes (162, 179, 196, 237 — read the file to identify them), `container-restarts` (278), `incidents` (306), `deploy-cadence` (350), `sla` (391).
- Suggested split:
  - `history.ts` — metrics timeseries + deploy/ci history + the 162-237 routes if they're metric-shaped (keeps existing registration name)
  - `reliability.ts` — container-restarts, incidents, deploy-cadence, sla
  - Adjust the boundary after reading the four unnamed routes — group by what the dashboard consumes together, not strictly by line count.
- Same mechanics as sprint 216: check the plugin registration site, keep prefixes/URLs identical, move shared local helpers (JSONL readers, time-window parsing) to a lib module if both files need them.
- Dashboard consumers: `DeployCadenceChart`, `SlaPanel`, `IncidentPanel` (moving to sub-pages in the detail-page reorg) — URLs must not change or those panels break silently.
- If sprint 216 already landed, follow whatever helper-placement conventions it established.

## Tasks
1. Read `history.ts` fully; identify the four unnamed routes and assign every route to a target module.
2. Create `reliability.ts` (or better name per actual grouping) and move routes verbatim.
3. Register the new module with the same prefix; verify the URL surface is unchanged.
4. Update test imports/mocks for moved routes; mirror the split in test files if any exceed ~300 lines.
5. Run `pnpm nx test api`, `pnpm nx typecheck api`, `pnpm nx lint api`.

## Files involved
- `apps/api/src/routes/history.ts` — slims to metrics/history routes
- new file: `apps/api/src/routes/reliability.ts` (name may adjust after reading)
- app route-registration entry
- shared helpers → `apps/api/src/lib/` if used by both modules
- existing test files — path updates only

## Acceptance criteria
- [x] Both resulting files ≤ ~300 lines
- [x] Route URLs, methods, and response shapes unchanged
- [x] All existing tests pass; typecheck and lint clean

## Completed

**Date:** 2026-07-10

### Summary
Split `apps/api/src/routes/history.ts` (448 lines) into two focused route modules grouped by subdomain: metrics/timeseries and incidents/reliability. The original file mixed two distinct concerns serving different dashboard consumers — raw metric endpoints for charts and SLA/incident analytics for reliability panels. The split reduces cognitive load and isolates concerns without changing any URL routes or behavior.

**history.ts** (260 lines) holds metric timeseries and deployment/CI event streams: metrics, deploy-history, ci-history, ci-log, deploy-log, disk-trend, memory-trend, container-restarts.

**reliability.ts** (209 lines) holds incident/SLA analytics: incidents, deploy-cadence, sla.

Both modules are registered in `index.ts` with the same `/projects/:name` prefix, so all external URLs remain unchanged.

### Files changed
- `apps/api/src/routes/history.ts` — slimmed to 260 lines (metrics/timeseries routes only)
- (new) `apps/api/src/routes/reliability.ts` — 209 lines (incidents/SLA routes)
- `apps/api/src/index.ts` — added import and registration for reliability module

### Verification
- `pnpm nx test api`: 266/266 pass
- `pnpm nx typecheck api`: clean
- `pnpm nx lint api`: clean
- Both files under 300-line cap (260 and 209)
- All route URLs, methods, and response shapes unchanged

### Follow-ups
- none

## Out of scope
- Behavior/validation changes
- projects.ts split (sprint 216)
