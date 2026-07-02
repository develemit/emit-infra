# Sprint 150 — Cost panel

**Difficulty:** 2

## Goal

Add a "Cost" card on the project detail page showing estimated monthly server cost (EUR), backup storage cost (USD), and a note that these are estimates with separate currencies.

## Reason

Sprint 149 computes the cost data; this sprint makes it visible. Having the cost on the same page as operational metrics completes the picture — a project that's using 85% disk on a €38/month server is a clear signal to either optimize or upgrade.

## Context

- Builds on sprint 149: `GET /projects/:name/cost` returns `{ server: { eurPerMonth, type, region }, storage: { usdPerMonth, totalBytes, bucketName } }`.
- Add `getProjectCost(name)` to `apps/dashboard/src/lib/api.ts`.
- Component: `apps/dashboard/src/components/detail/cost-panel.tsx`. Card with title "Estimated Cost" and `layers` icon (already in icon.tsx).
  - Two stat tiles (use the same local `StatTile` pattern as health-card.tsx or a minimal inline version):
    - "Server" → `€${eurPerMonth.toFixed(2)}/mo` or "—" if null. Subtitle: `${type} · ${region}`.
    - "Backups" → `$${usdPerMonth.toFixed(3)}/mo` or "—" if null. Subtitle: `${formatBytes(totalBytes)} stored`.
  - Small footnote below tiles: `text-[10px] text-faint` — "Estimates only. Hetzner: EUR. R2: USD."
  - If both are null: show "Cost data unavailable — set HETZNER_API_TOKEN to enable server pricing."
  - `formatBytes` function: same formula as backup-panel.tsx.
  - No refresh button — loads once on mount (data is cached for 1h on the API).
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` at the very end of the main content column, after `DockerUsage`. Always visible (shows "—" for unavailable components).
- Guard: always render (no guard needed — the panel handles nulls gracefully).

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` (last 20 lines) for fetch pattern.
2. Add `ProjectCost` type and `getProjectCost(name: string)` to `apps/dashboard/src/lib/api.ts`.
3. Create `apps/dashboard/src/components/detail/cost-panel.tsx`.
4. Mount `<CostPanel name={name} />` at the end of the main content column in `apps/dashboard/app/projects/[name]/page.tsx`, after `<DockerUsage .../>`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add `ProjectCost` type and `getProjectCost`
- new file: `apps/dashboard/src/components/detail/cost-panel.tsx` — cost card component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] Panel renders server cost tile (EUR) and storage cost tile (USD)
- [x] Shows "—" for either tile when data is not available (no API token, no backup bucket)
- [x] Footnote clarifies estimates and currency difference
- [x] Graceful "Cost data unavailable" message when both are null
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `ProjectCost` type and `getProjectCost()` fetch to `api.ts`. Created `CostPanel` with layers icon, two `StatTile`s (Server in EUR, Backups in USD), `formatBytes()` helper matching backup-panel, a footnote disclaiming estimates and currency split, and a "Cost data unavailable" message when both components are null. Mounted unconditionally after `<DockerUsage />` at the end of the main column.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `ProjectCost` type and `getProjectCost`
- (new) `apps/dashboard/src/components/detail/cost-panel.tsx` — estimated cost card
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `CostPanel`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Currency conversion (intentional — misleading to conflate EUR and USD)
- Total combined cost calculation
- Historical cost trending
- Projected cost based on resource growth trend
