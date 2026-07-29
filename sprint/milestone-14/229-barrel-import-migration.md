# Sprint 229 — Migrate dashboard barrel imports to domain-specific API modules

> _Promoted from backlog item (sprint 172), 2026-07-17._
> _This item may benefit from `/plan-sprint "barrel import migration"` to expand into a sequence if the scope proves too large for a single sprint._

## Goal
All dashboard `import { ... } from '~/lib/api'` calls import from the specific domain module (`api-projects.ts`, `api-containers.ts`, `api-metrics.ts`, etc.) instead of the barrel re-export.

## Context
- `apps/dashboard/src/lib/api.ts` is the barrel that re-exports from domain-specific modules:
  `api-auth.ts`, `api-containers.ts`, `api-history.ts`, `api-infra.ts`, `api-metrics.ts`, `api-ops.ts`, `api-projects.ts`, `api-secrets.ts`
- 52 files currently import from the barrel, totaling 60 import statements.
- Importing directly from domain modules improves tree-shaking, faster IDE go-to-definition, and makes dependency graphs clearer.
- After migration, `api.ts` barrel can either be deleted or kept as a convenience re-export for any remaining consumers.

## Tasks
1. Read `api.ts` barrel to map each exported function to its domain module.
2. For each of the 52 importing files, update the import path from `~/lib/api` to `~/lib/api-<domain>`.
3. Remove unused re-exports from `api.ts` or delete the barrel if no imports remain.
4. Run `npx nx run dashboard:typecheck` and `npx nx run dashboard:test`.

## Acceptance criteria
- [x] Zero imports from `~/lib/api` barrel remain (except the barrel file itself, if kept for backwards compat).
- [x] All domain-specific imports resolve correctly.
- [x] Dashboard typecheck and tests pass.

## Completed

**Date:** 2026-07-18

### Summary
Migrated all 51 dashboard source files that were importing from the `@/lib/api` barrel to use their respective domain-specific modules (`api-auth`, `api-projects`, `api-containers`, `api-metrics`, `api-history`, `api-infra`, `api-ops`, `api-secrets`). Files importing multiple domains were split into multiple import lines. Test files with `vi.mock('@/lib/api', ...)` were updated to mock the individual domain modules instead, and `import * as api` namespaces in tests were split per domain.

The `api.ts` barrel is retained as-is since it still has `src/lib/api.test.ts` consuming it, and it may serve as a convenience re-export — the sprint accepted keeping it if no imports remained in consumer files.

### Files changed
- `src/lib/ops-chat-context.ts` — split import across api-projects + api-history
- `src/lib/use-project-detail.ts` — split import across api-projects + api-containers + api-auth
- `src/lib/use-ops-chat.ts` — split import across api-auth + api-projects + api-history
- `src/lib/use-ops-chat.test.ts` — split vi.mock across 3 domain modules
- `src/lib/use-project-detail.test.ts` — split vi.mock + import * as api across api-projects + api-containers
- `src/lib/use-deploy-markers.ts` — → api-history
- `src/lib/use-ops-session.ts` — → api-auth
- `src/lib/use-restart-confirm.ts` — → api-containers
- `src/lib/use-server-metrics.ts` — → api-metrics
- `src/lib/use-ci-history.ts` — → api-history
- `src/components/add-project-dropdown.tsx` — → api-projects
- `src/components/billing-widget.tsx` — → api-auth
- `src/components/command-palette.tsx` — → api-projects
- `src/components/rollback-panel.tsx` — → api-projects
- `src/components/secrets-sync-panel.tsx` — → api-secrets
- `src/components/project-card.tsx` — split import across api-containers + api-projects
- `src/components/detail/container-log-viewer.tsx` — → api-auth
- `src/components/detail/container-table.tsx` — split import across api-containers + api-metrics
- `src/components/detail/desktop-container-row.tsx` — → api-containers
- `src/components/detail/mobile-container-row.tsx` — → api-containers
- `src/components/detail/container-row-utils.ts` — → api-containers
- `src/components/detail/docker-usage.tsx` — → api-containers
- `src/components/detail/container-row.test.tsx` — vi.mock + dynamic import → api-containers
- `src/components/detail/deploy-cadence-chart.tsx` — → api-metrics
- `src/components/detail/sla-panel.tsx` — → api-metrics
- `src/components/detail/queue-chart.tsx` — → api-metrics
- `src/components/detail/alert-banners.tsx` — split import across api-ops + api-metrics
- `src/components/detail/summary-cards-grid.tsx` — split import across api-ops + api-metrics + api-projects + api-history
- `src/components/detail/health-card.tsx` — split import across api-projects + api-metrics + api-infra
- `src/components/detail/health-card.test.tsx` — split import across api-projects + api-infra
- `src/components/detail/deploy-timeline.tsx` — → api-history
- `src/components/detail/ci-timeline.tsx` — → api-history
- `src/components/detail/run-log-page.tsx` — → api-history
- `src/components/detail/incident-panel.tsx` — merged 2 lines into one → api-history
- `src/components/detail/incident-panel.test.tsx` — vi.mock → api-history
- `src/components/detail/response-time-panel.tsx` — → api-infra
- `src/components/detail/cert-panel.tsx` — → api-infra
- `src/components/detail/disk-dirs-panel.tsx` — → api-infra
- `src/components/detail/disk-breakdown-panel.tsx` — → api-infra
- `src/components/detail/nginx-endpoints-panel.tsx` — → api-infra
- `src/components/detail/pg-table-sizes-panel.tsx` — → api-infra
- `src/components/detail/cost-panel.tsx` — merged 2 lines into one → api-infra
- `src/components/detail/ufw-panel.tsx` — → api-ops
- `src/components/detail/cron-panel.tsx` — → api-ops
- `src/components/detail/backup-panel.tsx` — split import across api-projects + api-ops
- `src/components/detail/backup-panel.test.tsx` — vi.mock + imports → api-ops + api-projects
- `src/components/detail/secrets-panel.tsx` — → api-secrets
- `src/components/detail/alert-history-panel.tsx` — → api-projects
- `src/components/detail/alert-rules-section.tsx` — → api-projects
- `src/components/detail/project-settings-panel.tsx` — split import across api-projects + api-containers
- `src/components/provision/step-infrastructure.tsx` — → api-containers

### Verification
- `npx nx run dashboard:typecheck`: clean
- `npx nx run dashboard:test`: 169/169 pass
- `grep -r "from '@/lib/api'" src/`: no matches

### Follow-ups
- `[defer]` The `api.ts` barrel is retained — it could be deleted once its own test (`api.test.ts`) is confirmed to only test internal structure, but this is cosmetic and not urgent.
