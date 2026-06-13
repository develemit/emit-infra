# Sprint 58 — Split operations.ts into Domain Route Files
**Difficulty:** 3

> _Promoted from sprint-55 follow-up, 2026-06-13. Also addresses sprint-53 follow-up (projects.ts at ~300 lines)._

## Goal
Split `apps/api/src/routes/operations.ts` (~380 lines) into focused sub-files, and while touching the route registration layer, extract the rollback snapshots endpoint from `projects.ts` into its own file to bring both files under the 300-line limit.

## Reason
`operations.ts` has grown to ~380 lines across 5 different concerns (deploy, provision, destroy, rollback, secrets-sync). `projects.ts` crossed 300 lines after the rollback snapshots endpoint was added. Both violate the project's 300-line guideline and will only grow. Splitting now is cheap; splitting later with more dependents is not.

## Context

### Current file structure
- `apps/api/src/routes/operations.ts` — deploy, provision, destroy, rollback SSE, secrets-sync, logs
- `apps/api/src/routes/projects.ts` — status, containers, docker-usage, prune, container restart, rollback snapshots

### Target structure
```
apps/api/src/routes/
  projects.ts          (~230 lines — remove rollback/snapshots endpoint)
  operations.ts        (~180 lines — keep deploy, provision, destroy, logs only)
  rollback.ts          (new — rollback snapshots GET + rollback POST SSE)
  secrets-sync.ts      (new — secrets-sync POST SSE + parseEnvFile helper)
```

### How routes are registered
Look at `apps/api/src/server.ts` (or wherever the Fastify app is created and routes registered). Currently likely:
```ts
await app.register(projectRoutes)
await app.register(operationRoutes)
```
After the split, register the new route files alongside the existing ones.

### Shared helpers
`operations.ts` defines these helpers used by multiple endpoints:
- `parseEnvFile(content)` → move to `secrets-sync.ts`
- `openSse(reply)` → move to `lib/open-sse.ts` (or keep in operations.ts and re-export) — check if it's also in `ops.ts`
- `sseError(raw, message)` → same as `openSse`
- `sshKeyPath(keyName)` → already defined separately in `projects.ts` too — DRY later, for now just keep a copy in each file
- `findProject(name)` → same, keep a copy
- `operationTimeout()` + `OPERATION_TIMEOUT_MS` → stay in `operations.ts` (only used by deploy/provision/destroy)

Both `operations.ts` and `projects.ts` have their own `findProject` and `sshKeyPath` — that duplication predates this sprint. Don't consolidate into shared lib here unless it's trivially simple; that's a separate sprint.

## Tasks
1. Read `apps/api/src/routes/operations.ts` in full (currently ~380 lines).
2. Read `apps/api/src/routes/projects.ts` to confirm rollback/snapshots endpoint location.
3. Read `apps/api/src/server.ts` (or equivalent) to understand route registration pattern.
4. Create `apps/api/src/routes/rollback.ts`:
   - Import: `FastifyInstance`, `sshExec` from core, `discoverProjects`, `writeEvent`, `openSse`, `sseError`
   - Copy `findProject` and `sshKeyPath` from existing files
   - Move `GET /projects/:name/rollback/snapshots` from `projects.ts`
   - Move `POST /projects/:name/rollback` from `operations.ts`
   - Export `async function rollbackRoutes(app: FastifyInstance)`
5. Create `apps/api/src/routes/secrets-sync.ts`:
   - Import: `FastifyInstance`, `execa`, `readFile`, `existsSync`, `homedir`, `join`, `discoverProjects`, `writeEvent`, `openSse`, `sseError`
   - Copy `findProject` (and `parseEnvFile` from operations.ts)
   - Move `POST /projects/:name/secrets-sync` from `operations.ts`
   - Export `async function secretsSyncRoutes(app: FastifyInstance)`
6. Remove the moved endpoints from `operations.ts` and `projects.ts`.
7. Register `rollbackRoutes` and `secretsSyncRoutes` in `server.ts`.
8. Run `pnpm nx run api:typecheck` (or `pnpm nx run cli:typecheck` if that covers the API).

## Files involved
- `apps/api/src/routes/operations.ts` — remove rollback + secrets-sync endpoints
- `apps/api/src/routes/projects.ts` — remove rollback/snapshots endpoint
- (new) `apps/api/src/routes/rollback.ts` — rollback domain routes
- (new) `apps/api/src/routes/secrets-sync.ts` — secrets-sync route + parseEnvFile
- `apps/api/src/server.ts` (or equivalent) — register new route files

## Acceptance criteria
- [ ] `GET /projects/:name/rollback/snapshots` still works (moved to rollback.ts)
- [ ] `POST /projects/:name/rollback` still works (moved to rollback.ts)
- [ ] `POST /projects/:name/secrets-sync` still works (moved to secrets-sync.ts)
- [ ] `operations.ts` is under 250 lines
- [ ] `projects.ts` is under 250 lines
- [ ] API typecheck clean

## Out of scope
- Consolidating the duplicate `findProject` / `sshKeyPath` helpers across route files (separate sprint)
- Moving `openSse` / `sseError` into a shared lib (they already live in a lib file — confirm this)
