# Sprint 208 — Fix pre-existing lint errors across API routes

> _Promoted from backlog: sprint-206 and sprint-207 follow-ups, 2026-07-10._

## Goal
Eliminate all pre-existing lint errors in the API so future sprint diffs are clean.

## Context
Sprints 206 and 207 both flagged ~8 pre-existing lint errors that predate their changes. The errors are unused variables and imports across several API route files. These create noise in every future sprint's lint output and make it harder to tell if new code introduced regressions.

Affected files (from sprint 206/207 notes):
- `apps/api/src/routes/billing.ts` — unused vars
- `apps/api/src/routes/cert.ts` — unused vars
- `apps/api/src/routes/history.ts` — unused vars
- `apps/api/src/routes/incidents-export.ts` — unused vars
- `apps/api/src/routes/operations.ts` — unused imports/vars
- `apps/api/vitest.config.ts` — tsconfig include issue

## Tasks
1. Run `pnpm nx lint api` (or equivalent) to get the current list of errors with file:line references.
2. For each error, determine if the unused variable/import can simply be removed or if it's actually used elsewhere (re-exported, referenced in a type-only context, etc.).
3. Fix each error — prefer removal over prefixing with `_`.
4. Re-run lint to confirm zero errors.
5. Run `pnpm nx test api` to confirm no regressions.

## Acceptance criteria
- `pnpm nx lint api` exits 0 with no warnings or errors.
- All existing tests still pass.
- No behavior changes — this is a pure cleanup sprint.

## Completed

**Date:** 2026-07-10

### Summary
Removed 8 pre-existing lint errors across 5 route files and the API tsconfig. All errors were unused variables/imports that accumulated from earlier sprints. No logic was changed — pure dead-code removal. The tsconfig fix adds `vitest.config.ts` to the `include` list so the parser can resolve it properly.

### Files changed
- `apps/api/src/routes/billing.ts` — removed `hoursInMonth` from destructuring (only `hours` is used)
- `apps/api/src/routes/cert.ts` — removed unused `field()` function (parser was rewritten to not use it)
- `apps/api/src/routes/history.ts` — removed unused `MAX_HOURS` and `MAX_HISTORY_LIMIT` constants
- `apps/api/src/routes/incidents-export.ts` — removed unused `createTtlCache` import
- `apps/api/src/routes/operations.ts` — removed `runAnsible` and `sshExec` from import (only `runTerraform`, `getTerraformOutput`, `sshMuxArgs` remain)
- `apps/api/tsconfig.json` — added `vitest.config.ts` to `include` to resolve ESLint parse error

### Verification
- `pnpm nx lint api`: clean (0 errors, 0 warnings)
- `pnpm nx test api`: 222/222 pass

### Follow-ups
none
