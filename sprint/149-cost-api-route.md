# Sprint 149 — Cost API route

**Difficulty:** 3

## Goal

Add a `GET /projects/:name/cost` route that combines Hetzner server monthly cost (from the client built in sprint 148) with R2 storage cost (derived from the backup list) and returns a structured cost estimate.

## Reason

"How much does this project cost?" is a question that currently requires manual calculation across multiple dashboards. This route makes it answerable with one API call, combining server and storage costs in the same place.

## Context

- Create `apps/api/src/routes/cost.ts`. Register in `apps/api/src/index.ts`.
- Server cost: call `getServerTypeMonthlyPrice(project.config.serverType, project.config.region)` from `../lib/hetzner.js`. Returns a number in EUR or null.
- Storage cost: if `project.config.postgres?.backupBucket` is set, reuse the same R2 approach as the backup routes in `apps/api/src/routes/projects.ts` to list backups and sum `sizeBytes`.
  - R2 pricing: $0.015 per GB per month (standard Cloudflare R2 rate as of 2024). Use this as a constant `R2_PRICE_PER_GB_MONTH = 0.015`.
  - Total R2 cost = `totalBytes / (1024^3) * R2_PRICE_PER_GB_MONTH`.
  - Note: R2 has a 10 GB free tier; for simplicity, do not subtract the free tier.
  - Currency note: R2 is priced in USD, Hetzner in EUR. Return both separately with currency labels — do not convert between them.
- Return type:
  ```ts
  interface CostEstimate {
    server: { eurPerMonth: number | null; type: string; region: string }
    storage: { usdPerMonth: number | null; totalBytes: number | null; bucketName: string | null }
  }
  ```
  `null` values mean "data not available" (no API token, no backup bucket, etc.).
- TTL cache 3_600_000ms (1 hour).
- On any failure, return partial data with `null` for the failed component — never 503 for cost (availability of the cost info should not affect dashboard loading).

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 240–320 (the backup routes) to see how the R2 SSH command is structured, so you can replicate the pattern for summing backup bytes.
2. Read `apps/api/src/index.ts` for registration pattern.
3. Create `apps/api/src/routes/cost.ts`. Import `getServerTypeMonthlyPrice` from `../lib/hetzner.js`.
4. For storage cost: run the `aws s3 ls` SSH command (same as the backup list route) and sum `sizeBytes` from all lines.
5. Register `costRoutes` in `apps/api/src/index.ts`.
6. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/routes/cost.ts` — cost route
- `apps/api/src/index.ts` — register cost routes

## Acceptance criteria

- [x] `GET /projects/:name/cost` returns `{ server: { eurPerMonth, type, region }, storage: { usdPerMonth, totalBytes, bucketName } }`
- [x] `server.eurPerMonth` is null when `HETZNER_API_TOKEN` is not set
- [x] `storage.usdPerMonth` is null when `postgres.backupBucket` is not configured
- [x] Partial data is returned without errors when one component fails
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/cost.ts` with `GET /projects/:name/cost`. Fetches Hetzner server monthly price via `getServerTypeMonthlyPrice()` (returns null if token missing). For storage, runs `aws s3 ls` via SSH using the same R2 env-var pattern as the backup routes, sums `sizeBytes`, and applies `R2_PRICE_PER_GB_MONTH = 0.015`. Both components have independent error boundaries — SSH failure leaves storage null while server cost still returns. 1-hour TTL cache.

### Files changed
- (new) `apps/api/src/routes/cost.ts` — cost estimation route
- `apps/api/src/index.ts` — registered `costRoutes`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Dashboard UI (sprint 150)
- Volume / snapshot / snapshot pricing
- Multi-region cost comparison
- Free-tier subtraction for R2
