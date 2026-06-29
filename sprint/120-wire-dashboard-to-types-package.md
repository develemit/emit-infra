# Sprint 120 — Wire dashboard to @emit-infra/types

**Difficulty:** 2

## Goal

Replace the dashboard's hand-rolled `ProjectConfig` interface with the canonical type from `@emit-infra/types`, eliminating the drift risk.

## Reason

After sprint 119, `@emit-infra/types` holds the real `ProjectConfig` type (12+ fields, Zod-validated). The dashboard's `apps/dashboard/src/lib/api.ts` still declares its own simplified 4-field interface. This means the dashboard silently ignores half the config shape — any new field added to the schema is invisible to the UI. Wiring to the shared type closes this gap with a single dependency change.

## Context

- `apps/dashboard/src/lib/api.ts` — currently exports `interface ProjectConfig { name, domain, region, github? }` (4 fields, TypeScript interface, not Zod). Replace this with `export type { ProjectConfig } from '@emit-infra/types'`.
- `apps/dashboard/package.json` — add `"@emit-infra/types": "workspace:*"` to `dependencies`.
- The dashboard's `ProjectSummary` interface uses `ProjectConfig` as a field (`config: ProjectConfig`) — it will automatically pick up the richer type with no other changes.
- Callers of `ProjectSummary.config` throughout the dashboard (health page, project detail, etc.) only access `.name`, `.domain`, `.region` — they'll still compile fine against the larger type; no widespread changes needed.
- `apps/dashboard/src/components/provision/types.ts` exports `FormValues` — this is a separate, intentionally flat form type and should NOT be changed to use the Zod schema. Leave it alone.
- Build note: `@emit-infra/types` doesn't need to be compiled to dist for the dashboard's typecheck to pass — Next.js + TypeScript will resolve via `packages/types/src/index.ts` directly if `tsconfig.json` paths are configured, or you may need to add a path alias. Check `apps/dashboard/tsconfig.json` for how `@emit-infra/core` would be referenced (it isn't, since dashboard doesn't use core) — check how the Nx monorepo resolves workspace packages in the dashboard.

## Tasks

1. Read `apps/dashboard/tsconfig.json` and `apps/dashboard/package.json` to understand current path resolution.
2. Add `"@emit-infra/types": "workspace:*"` to `apps/dashboard/package.json` dependencies.
3. Run `pnpm install` to link.
4. In `apps/dashboard/src/lib/api.ts`, remove the local `ProjectConfig` interface definition. Add `export type { ProjectConfig } from '@emit-infra/types'` (adjust import path if needed based on how workspace packages resolve in the dashboard's tsconfig).
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors (likely just import path adjustments).

## Files involved

- `apps/dashboard/package.json` — add `@emit-infra/types` dep
- `apps/dashboard/src/lib/api.ts` — replace local `ProjectConfig` interface with import from `@emit-infra/types`
- `apps/dashboard/tsconfig.json` — may need a path alias for `@emit-infra/types` if workspace resolution doesn't work automatically

## Acceptance criteria

- [x] `apps/dashboard/package.json` lists `@emit-infra/types` as a dependency
- [x] `apps/dashboard/src/lib/api.ts` no longer defines `ProjectConfig` locally — it imports from `@emit-infra/types`
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-06-29

### Summary
Added `@emit-infra/types` to the dashboard's dependencies and replaced the hand-rolled 4-field `ProjectConfig` interface in `api.ts` with a re-export from `@emit-infra/types`. The dashboard's tsconfig needed a local path alias (`../../packages/types/src/index.ts`) since its `paths` config is relative to its own baseUrl. Typecheck clean.

### Files changed
- `apps/dashboard/package.json` — added `@emit-infra/types: workspace:*` dep
- `apps/dashboard/src/lib/api.ts` — replaced local interface with import + re-export from `@emit-infra/types`
- `apps/dashboard/tsconfig.json` — added `@emit-infra/types` path alias

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Deriving `FormValues` from the Zod schema (the form shape is intentionally different)
- Moving `ProjectSummary`, `ProjectStatus`, or other interfaces to the types package
- Adding any other types to `@emit-infra/types` beyond what sprint 119 put there
