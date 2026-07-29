# Sprint 226 — Invalidate SLA cache when annotation is written

> _Promoted from backlog item (sprint 189), 2026-07-17._

## Goal
Writing or updating an incident annotation (especially toggling `falsePositive`) immediately invalidates the SLA cache so the next GET /projects/:name/sla reflects the change.

## Context
- `apps/api/src/routes/reliability.ts` uses a 120s TTL cache (`slaCache`) for SLA data. The SLA calculation filters out incidents marked `falsePositive` via annotations.
- `apps/api/src/routes/incident-annotations.ts` handles `PUT /projects/:name/incidents/:startedAt/annotation` — calls `writeAnnotation()` but does NOT invalidate `slaCache`.
- Result: after marking an incident as a false positive, the SLA endpoint returns stale data for up to 120s.
- The TTL cache in `apps/api/src/lib/ttl-cache.ts` already exposes an `invalidate(key)` method, used elsewhere (e.g. `project-docker.ts`).

## Tasks
1. Export `slaCache` from `reliability.ts` (or export an `invalidateSlaCache(name: string)` function).
2. In `incident-annotations.ts`, after the `writeAnnotation()` call on line 41, invalidate the SLA cache for `params.data.name`.
3. Add a test in `incident-annotations.test.ts` verifying that `slaCache.invalidate` is called after a successful PUT.
4. Run `npx nx run api:test` and `npx nx run api:typecheck`.

## Acceptance criteria
- [x] PUT annotation → immediate GET /sla returns updated data (no 120s delay).
- [x] All existing tests pass.
- [x] Typecheck clean.

## Completed

**Date:** 2026-07-17

### Summary
Exported `invalidateSlaCache(name)` from `reliability.ts` and called it in `incident-annotations.ts` immediately after `writeAnnotation()`. The SLA cache entry for the project is now dropped on every successful annotation PUT, so the next GET /sla recalculates fresh data instead of serving a stale 120s-TTL hit.

### Files changed
- `apps/api/src/routes/reliability.ts` — added exported `invalidateSlaCache` wrapper around `slaCache.invalidate`
- `apps/api/src/routes/incident-annotations.ts` — import `invalidateSlaCache` and call it after `writeAnnotation`
- `apps/api/src/routes/incident-annotations.test.ts` — mock `./reliability.js`, add test verifying `invalidateSlaCache` is called with the project name

### Verification
- `npx nx run api:test`: 294/294 pass (10 in incident-annotations.test.ts)
- `npx nx run api:typecheck`: clean

### Follow-ups
- none
