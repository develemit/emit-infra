# Sprint 61 — Add `/healthz` route to all deployed projects

> _Promoted from sprint-40 follow-up, 2026-06-15._
> _This item may benefit from `/plan-sprint "healthz routes"` to expand into a per-project sequence before running._

## Goal

Every deployed project exposes `GET /healthz` returning
`{ status, build, service, uptime }` so `emit-infra status` can surface live
build data instead of relying solely on `.ci-status.json`.

## Context

Sprint 40 added `/healthz` querying to `emit-infra status` (`status-healthz-query`).
The CLI can already call these routes — but none of the projects implement the
endpoint yet, so `emit-infra status` falls back to the version file.

Projects that need the route:
- **emit-vision** — Fastify API (`apps/api`)
- **martialops** — Fastify API (`apps/api`)
- **easy-living** — check API framework
- **develemail** — Fastify API (`apps/api`)
- **diner-decider** — Fastify API (`apps/api`)

Expected response shape (JSON, HTTP 200):

```json
{
  "status": "ok",
  "build": "1234",
  "service": "api",
  "uptime": 3600
}
```

Where:
- `build` = `BUILD_NUMBER` env var (injected at Docker build time)
- `service` = the service name string (e.g. `"api"`)
- `uptime` = `Math.floor(process.uptime())` in seconds

The route should be unauthenticated and excluded from rate limiting.

## Tasks

1. For each project's API (`apps/api`), add a `GET /healthz` route.
2. Register the route without auth middleware (if the project uses JWT or API
   key middleware on all routes, add an explicit bypass or register the route
   before the middleware is applied).
3. Inject `BUILD_NUMBER` via `process.env.BUILD_NUMBER` — it is already set as
   a Docker build arg in each project's deploy script.
4. Return `{ status: "ok", build: process.env.BUILD_NUMBER ?? "dev", service: "<name>", uptime: Math.floor(process.uptime()) }`.
5. Smoke-test locally: `curl http://localhost:<port>/healthz`.
6. Commit to each project.

## Completed

**Date:** 2026-06-16

### Summary
Added `/healthz` returning `{ status, build, service, uptime }` to all active deployed projects. emit-vision already had a `/healthz` stub — updated it to the standard shape. develemail and diner-decider had `/health` endpoints; `/healthz` was added alongside them. easy-living doesn't exist locally (skipped). martialops has the route implemented and staged but commit is deferred — the pre-commit hook runs e2e tests requiring postgres, which isn't running locally; user opted to defer that project.

### Files changed
- `emit-vision` `apps/api/src/server/index.ts` — updated /healthz to standard shape
- `develemail` `apps/api/src/server.ts` — added /healthz
- `diner-decider` `apps/api/src/server.ts` — added /healthz
- `martialops` `apps/api/src/routes/health.ts` — /healthz added (staged, not yet committed — deferred)

### Verification
- emit-vision typecheck: clean; committed `97a5e97`
- develemail typecheck: clean; committed `74bc029`
- diner-decider typecheck: clean; committed `4979a02`
- martialops typecheck: clean; commit deferred (e2e requires postgres)
- easy-living: skipped — project not present locally

### Follow-ups

- `[defer]` martialops: `/healthz` is staged at `apps/api/src/routes/health.ts` — commit when postgres is available locally (`docker compose up -d postgres` then stage health.ts + pnpm-lock.yaml + packages/contracts/openapi.json + packages/contracts/src/generated/types.ts)
- `[defer]` Production validation: curl each domain's `/healthz` after next deploy to confirm live build numbers surface in `emit-infra status`

## Acceptance criteria

- `curl https://<project-domain>/healthz` returns HTTP 200 with the expected
  JSON shape in production for all five projects.
- `emit-infra status` shows live build numbers instead of `—` for each project.
- No auth tokens required to call the endpoint.
