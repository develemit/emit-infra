# Sprint 59 — Consolidate Duplicate Route Helpers into Shared Lib
**Difficulty:** 2

> _Promoted from sprint-58 out-of-scope, 2026-06-13._

## Goal
Extract the duplicated `findProject` and `sshKeyPath` helpers that exist independently in `projects.ts`, `operations.ts`, `rollback.ts`, and `secrets-sync.ts` into a single shared lib file.

## Reason
Sprint 58's split created four route files that each carry their own copy of `findProject` and `sshKeyPath`. These are identical across all four files — any change to one (e.g. a new fallback behavior, a config field rename) must be applied in four places. Extracting them now prevents drift while the duplication is still fresh and easy to see.

## Context

`findProject` appears in:
- `apps/api/src/routes/projects.ts` — `async function findProject(name: string)`
- `apps/api/src/routes/operations.ts` — identical copy
- `apps/api/src/routes/rollback.ts` — identical copy
- `apps/api/src/routes/secrets-sync.ts` — identical copy

`sshKeyPath` appears in:
- `apps/api/src/routes/projects.ts` — `function sshKeyPath(keyName: string): string`
- `apps/api/src/routes/operations.ts` — `function sshKeyPath(keyName = 'emit-deploy'): string`
- `apps/api/src/routes/rollback.ts` — `function sshKeyPath(keyName = 'emit-deploy'): string`

Both helpers are pure functions that import only from `@emit-infra/core` or `../lib/discover-projects.js` / `node:path` / `node:os`. Move them to `apps/api/src/lib/project-helpers.ts` and import from there in all four route files.

`sshKeyPath` in `projects.ts` has `(keyName: string)` (no default) while the others have `(keyName = 'emit-deploy')`. Normalize to `(keyName = 'emit-deploy')` — the callers already pass the value or rely on the default.

## Tasks
1. Read all four route files to confirm the current signatures are truly identical.
2. Create `apps/api/src/lib/project-helpers.ts`:
   ```ts
   import { homedir } from 'node:os'
   import { join } from 'node:path'
   import { discoverProjects } from './discover-projects.js'

   export function sshKeyPath(keyName = 'emit-deploy'): string {
     return process.env['EMIT_SSH_KEY_PATH'] ?? join(homedir(), '.ssh', keyName)
   }

   export async function findProject(name: string) {
     return (await discoverProjects()).find((p) => p.config.name === name) ?? null
   }
   ```
3. In `projects.ts`, `operations.ts`, `rollback.ts`, `secrets-sync.ts`:
   - Remove the local `findProject` and `sshKeyPath` definitions
   - Add `import { findProject, sshKeyPath } from '../lib/project-helpers.js'`
   - Remove any now-unused imports (`homedir`, `join`, `discoverProjects`) if they were only used by the helpers
4. Run `pnpm nx run api:typecheck`.

## Files involved
- (new) `apps/api/src/lib/project-helpers.ts` — shared `findProject` + `sshKeyPath`
- `apps/api/src/routes/projects.ts` — import from lib, remove local definitions
- `apps/api/src/routes/operations.ts` — import from lib, remove local definitions
- `apps/api/src/routes/rollback.ts` — import from lib, remove local definitions
- `apps/api/src/routes/secrets-sync.ts` — import from lib, remove local definitions

## Acceptance criteria
- [x] `findProject` and `sshKeyPath` are defined in exactly one place
- [x] All four route files import them from `../lib/project-helpers.js`
- [x] `pnpm nx run api:typecheck` clean
- [x] No orphaned imports left in the route files after removing the local helpers

## Completed

**Date:** 2026-06-13

### Summary
Extracted the duplicated `findProject` and `sshKeyPath` helpers from four route files into a single shared `apps/api/src/lib/project-helpers.ts` module. The `sshKeyPath` signature was normalized to use the default parameter `keyName = 'emit-deploy'` across all call sites. Each route file now imports from the shared lib, and unused imports (`discoverProjects` in operations/rollback/secrets-sync) were cleaned up. Imports like `homedir`, `join`, and `discoverProjects` that are still used for other purposes in their respective files were left intact.

### Files changed
- (new) `apps/api/src/lib/project-helpers.ts` — shared `findProject` + `sshKeyPath` definitions
- `apps/api/src/routes/projects.ts` — removed local helpers, imports from shared lib
- `apps/api/src/routes/operations.ts` — removed local helpers + unused `discoverProjects`, imports from shared lib
- `apps/api/src/routes/rollback.ts` — removed local helpers + unused `homedir`/`join`/`discoverProjects`, imports from shared lib
- `apps/api/src/routes/secrets-sync.ts` — removed local `findProject` + unused `discoverProjects`, imports from shared lib

### Verification
- `pnpm nx run api:typecheck --skip-nx-cache`: clean
- grep for local `findProject`/`sshKeyPath` definitions in route files: none found
- grep for orphaned `discoverProjects` in operations/rollback/secrets-sync: none found

### Follow-ups
- none
