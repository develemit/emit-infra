# Sprint 136 — requiredEnvKeys project config field

**Difficulty:** 1

## Goal

Add a `requiredEnvKeys: string[]` optional field to `ProjectConfigSchema` in `packages/types/src/project-config.ts`. This field lists the `.env` key names that must be present on the server for the project to function correctly.

## Reason

Secrets drift detection (sprint 137) and the panel (sprint 138) depend on this field existing in the config schema. This sprint adds only the schema change — no API or UI touches. Unblocks the next two sprints without risk of accidental scope creep.

## Context

- `packages/types/src/project-config.ts` — the Zod schema file. Currently has `postgres`, `nginx`, `stripe`, `deploy`, etc. objects.
- Add at the top level of `ProjectConfigSchema` (not inside any sub-object):
  ```ts
  requiredEnvKeys: z.string().array().optional(),
  ```
- The field is optional so existing project configs without it remain valid.
- After adding, run `pnpm nx typecheck types --skip-nx-cache` to confirm no regressions.

## Tasks

1. Read `packages/types/src/project-config.ts` in full to find the correct insertion point (after `deploy` or at end of the schema object).
2. Add `requiredEnvKeys: z.string().array().optional()` to `ProjectConfigSchema`.
3. Run `pnpm nx typecheck types --skip-nx-cache`. Fix any errors.

## Files involved

- `packages/types/src/project-config.ts` — add `requiredEnvKeys` field

## Acceptance criteria

- [x] `ProjectConfigSchema.shape.requiredEnvKeys` is a `z.string().array().optional()`
- [x] Existing configs without the field still parse successfully (optional field)
- [x] `pnpm nx typecheck types --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `requiredEnvKeys: z.string().array().optional()` at the top level of `ProjectConfigSchema`, after the `stripe` and `deploy` optional objects. The field is optional so existing project configs without it remain valid. This unblocks sprint 137 (secrets-drift-api) and sprint 138 (secrets-drift-panel).

### Files changed
- `packages/types/src/project-config.ts` — added `requiredEnvKeys` field to schema

### Verification
- `pnpm nx typecheck types --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- API route for drift detection (sprint 137)
- Dashboard UI (sprint 138)
- Validation that key names follow env var naming conventions
