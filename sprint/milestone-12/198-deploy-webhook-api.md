# Deploy webhook API route
**Difficulty:** 3

## Goal
Add a `POST /projects/:name/deploy` API endpoint that triggers `emit-infra deploy` for a given project, so GitHub Actions (or any external system) can trigger deploys via HTTP instead of SSHing to production servers directly.

## Reason
Currently CI workflows SCP scripts to production servers and SSH into them to run deploys. This means every project needs SSH keys to production, every CI workflow has bespoke deploy logic, and deploy history/notifications bypass emit-infra entirely. A webhook endpoint centralizes deploy orchestration through emit-infra — CI just calls one URL after building images, and emit-infra handles the rest (Ansible, history recording, push notifications).

## Context
- The API runs on the Mac at `localhost:9000`. CI workflows will call this endpoint after building and pushing images to GHCR.
- Authentication: the API already uses bearer token auth (`apps/api/src/auth.ts`). CI will use the same `API_TOKEN`. Read the auth middleware to understand how to apply it.
- The deploy should run `emit-infra deploy` as a child process (or call `runAnsible` directly from the API). Read how `apps/cli/src/commands/deploy.ts` invokes `runAnsible` — the API route should do the same thing.
- Deploy history: the API already reads `.deploy-history.jsonl` in various routes. This endpoint should APPEND a new entry on completion with `{ status, sha, branch, startedAt, completedAt, durationSec, trigger: 'webhook' }`.
- Push notification: use `sendToAll` from `apps/api/src/lib/push.ts` to notify on completion (like the "Build #623 is live" pattern).
- The endpoint should be async — return `202 Accepted` with a deploy ID immediately, then run the deploy in the background. Add `GET /projects/:name/deploy-status` to poll for completion.
- Prevent concurrent deploys to the same project (reject with 409 if a deploy is already running).
- Accept optional body params: `{ sha?: string, branch?: string, buildNumber?: string }` for metadata recording.

## Tasks
1. Read `apps/api/src/auth.ts` to understand the auth middleware pattern.
2. Read `apps/cli/src/commands/deploy.ts` and `packages/core/src/index.ts` to understand how `runAnsible` works and whether it can be called from the API process directly (or if it needs to be spawned as a child process).
3. Create `apps/api/src/routes/deploy.ts` with:
   - `POST /projects/:name/deploy` — validate project exists, check no concurrent deploy, spawn deploy process, return 202 with deploy ID.
   - `GET /projects/:name/deploy-status` — return current deploy state (idle/running/completed/failed) with output tail.
4. Add deploy state tracking (in-memory map of project name → deploy state).
5. On deploy completion: append to `~/projects/{name}/.deploy-history.jsonl`, send push notification, update deploy state.
6. Register the route in the API's route setup (`apps/api/src/index.ts` or route registration file).
7. Write tests for the route (mock the deploy execution, test 202 response, 409 concurrent rejection, 404 unknown project, deploy-status polling).
8. Typecheck; run API tests.

## Files involved
- new file: `apps/api/src/routes/deploy.ts` — webhook route + status endpoint
- new file: `apps/api/src/routes/deploy.test.ts` — route tests
- `apps/api/src/index.ts` — register deploy route
- `apps/api/src/lib/push.ts` — used for completion notification (read only)
- `apps/api/src/auth.ts` — used for auth pattern (read only)

## Acceptance criteria
- [x] `POST /projects/:name/deploy` returns 202 with deploy ID and triggers deploy in background
- [x] `GET /projects/:name/deploy-status` returns current state (idle/running/completed/failed)
- [x] Concurrent deploys to the same project return 409
- [x] Deploy completion appends to `.deploy-history.jsonl` with `trigger: 'webhook'`
- [x] Push notification sent on deploy completion
- [x] Unknown project returns 404; missing auth returns 401
- [x] Typecheck clean; API tests pass

## Out of scope
- Updating any project's CI workflow to use this endpoint (sprints 199-202)
- Streaming deploy output via SSE (existing deploy panel already handles this differently)
- Rollback via webhook (can be added later)

## Completed

**Date:** 2026-07-03

### Summary
Added `POST /projects/:name/deploy` webhook (returns 202, runs deploy in background) and `GET /projects/:name/deploy-status` polling endpoint. Prevents concurrent deploys (409). On completion, appends to `.deploy-history.jsonl` with `trigger: 'webhook'` and sends push notification. Auth handled by existing API_SECRET middleware. Spawns `npx emit-infra deploy` as child process.

### Files changed
- (new) `apps/api/src/routes/deploy.ts` — webhook route + status endpoint
- (new) `apps/api/src/routes/deploy.test.ts` — 6 tests covering 404/202/409/idle/running/400
- `apps/api/src/index.ts` — registered deploy routes

### Verification
- `npx nx run api:typecheck`: clean
- `npx nx run api:test`: 195/195 pass

### Follow-ups
- none
