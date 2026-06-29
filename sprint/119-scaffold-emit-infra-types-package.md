# Sprint 119 — Scaffold @emit-infra/types package

**Difficulty:** 3

## Goal

Create a new `packages/types/` workspace package that holds browser-safe shared types — starting with `ProjectConfigSchema` and `ProjectConfig` — and update `packages/core` to re-export from it.

## Reason

`apps/dashboard` can't import from `@emit-infra/core` because that package pulls in Node.js-only modules (`execa`, `ssh2`, terraform/ansible wrappers). As a result, the dashboard maintains its own simplified `ProjectConfig` interface in `api.ts` with only 4 fields, while the canonical schema in `packages/core/src/config.ts` has 12+ fields. This will drift. The fix is a browser-safe `@emit-infra/types` package that both core and dashboard can depend on.

## Context

- `packages/core/src/config.ts` — canonical source of `ProjectConfigSchema` (Zod, ~60 lines) and `type ProjectConfig = z.infer<typeof ProjectConfigSchema>`. Move these here; leave a re-export in core.
- `packages/core/package.json` — name is `@emit-infra/core`. Use the same pattern for the new package: `@emit-infra/types`.
- `apps/dashboard/package.json` — does NOT currently depend on `@emit-infra/core`. After this sprint, it will depend on `@emit-infra/types`.
- The monorepo uses pnpm workspaces (`pnpm-workspace.yaml` includes `packages/*`) and Nx. Look at `packages/core/package.json` and `packages/core/project.json` (if present) as a reference for the new package's config.
- Zod is already in both core and dashboard's dependencies — the new types package will also declare `zod` as a dependency.

## Tasks

1. Read `packages/core/package.json`, `packages/core/tsconfig.json`, and any `packages/core/project.json` to understand the exact package structure to replicate.
2. Create `packages/types/` with:
   - `package.json` — name: `@emit-infra/types`, same structure as core's (main, types, exports pointing to `dist/src/index.js`)
   - `tsconfig.json` — same as core's (extends root tsconfig, includes `src/**/*.ts`)
   - `project.json` — Nx targets: `build` (tsc) and `typecheck` (tsc --noEmit), same as core
   - `src/project-config.ts` — paste the content of `packages/core/src/config.ts` verbatim
   - `src/index.ts` — `export { ProjectConfigSchema, type ProjectConfig } from './project-config.js'`
3. Update `packages/core/src/config.ts` — replace the Zod schema definition with a re-export: `export { ProjectConfigSchema, type ProjectConfig } from '@emit-infra/types'`
4. Update `packages/core/package.json` — add `@emit-infra/types` to dependencies (workspace protocol: `"@emit-infra/types": "workspace:*"`).
5. Run `pnpm install` to link the workspace package.
6. Run `pnpm nx typecheck core --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `packages/types/package.json`
- new file: `packages/types/tsconfig.json`
- new file: `packages/types/project.json`
- new file: `packages/types/src/project-config.ts`
- new file: `packages/types/src/index.ts`
- `packages/core/src/config.ts` — replace definition with re-export
- `packages/core/package.json` — add `@emit-infra/types` workspace dep

## Acceptance criteria

- [x] `packages/types/` exists as a valid Nx workspace package named `@emit-infra/types`
- [x] `packages/types/src/project-config.ts` contains the full Zod schema
- [x] `packages/core/src/config.ts` re-exports from `@emit-infra/types` (no local definition)
- [x] `pnpm nx typecheck core --skip-nx-cache` passes clean

## Completed

**Date:** 2026-06-29

### Summary
Created `packages/types/` as a new browser-safe Nx workspace package (`@emit-infra/types`). Moved `ProjectConfigSchema` and `ProjectConfig` from `packages/core/src/config.ts` into `packages/types/src/project-config.ts`. Core's `config.ts` now re-exports both from `@emit-infra/types`. Added `@emit-infra/types: workspace:*` to core's dependencies.

Required adding `"@emit-infra/types": ["packages/types/src/index.ts"]` to `tsconfig.base.json` paths — without this, TypeScript couldn't resolve the module, causing a cascade error in `load-config.ts` (the implicit `any` on the Zod `.map()` callback). Both fixes together made typecheck clean on core and types.

### Files changed
- (new) `packages/types/package.json` — package manifest for `@emit-infra/types`
- (new) `packages/types/tsconfig.json` — extends root tsconfig
- (new) `packages/types/tsconfig.lib.json` — build config with declarations
- (new) `packages/types/project.json` — Nx targets (build, typecheck, lint)
- (new) `packages/types/src/project-config.ts` — full Zod schema (moved from core)
- (new) `packages/types/src/index.ts` — re-exports ProjectConfigSchema and ProjectConfig
- `packages/core/src/config.ts` — replaced definition with re-export from `@emit-infra/types`
- `packages/core/package.json` — added `@emit-infra/types: workspace:*` dep
- `tsconfig.base.json` — added `@emit-infra/types` path alias

### Verification
- `pnpm nx typecheck core --skip-nx-cache`: clean
- `pnpm nx typecheck types --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Wiring the dashboard to the new package (sprint 120)
- Moving any other types besides `ProjectConfigSchema` / `ProjectConfig`
- Build/dist output from the new package (only typecheck required at this stage)
