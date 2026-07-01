# Sprint 131 — PostgreSQL table sizes API

**Difficulty:** 3

## Goal

Add a `GET /projects/:name/pg-table-sizes` route that SSHes into the server, queries the running Postgres container for the top-10 largest tables (by total size), and returns structured data.

## Reason

Knowing that disk is at 72% doesn't tell you whether it's a table that's grown unexpectedly or an index bloat issue. Developers currently have no way to inspect table sizes without SSHing in and running psql manually. This route exposes that data to the dashboard in a format ready for display.

## Context

- Create `apps/api/src/routes/postgres.ts`. Register it in `apps/api/src/index.ts` (pattern: `await app.register(postgresRoutes)`).
- SSH pattern: same as other routes — `sshExec(host, command, key)` from `@emit-infra/core`, host/key from `findProject` + `sshKeyPath`. See `apps/api/src/routes/projects.ts` for the exact pattern.
- The project runs Postgres in Docker Compose under `/opt/{name}/`. The container name convention is `{name}_postgres_1` or similar. Use docker compose exec to query it:
  ```bash
  cd /opt/${name} && docker compose exec -T postgres psql -U postgres -t -A -F'\t' -c "SELECT schemaname||'.'||tablename, pg_total_relation_size(quote_ident(schemaname)||'.'||quote_ident(tablename)), reltuples::bigint FROM pg_tables WHERE schemaname='public' ORDER BY 2 DESC LIMIT 10"
  ```
  Output is tab-separated lines: `<schema.table>\t<total_bytes>\t<row_estimate>`.
  Note: `reltuples` is a stats estimate, not exact — this is fine for display.
- TTL cache 60_000ms. On SSH failure return 503. If postgres isn't configured, return 404.
- Guard: only proceed if `project.config.postgres` is set (return 404 otherwise — no postgres configured).
- Return type: `{ tables: { name: string; totalBytes: number; rowEstimate: number }[] }`

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 1–15 to confirm exact import paths and Zod pattern.
2. Read `apps/api/src/index.ts` to see registration pattern.
3. Create `apps/api/src/routes/postgres.ts` with the `GET /projects/:name/pg-table-sizes` route. Parse tab-separated lines from psql output. Return `{ tables: [...] }`.
4. Guard: if `!project.config.postgres`, return `reply.status(404).send({ error: 'postgres not configured' })`.
5. Register `postgresRoutes` in `apps/api/src/index.ts`.
6. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/routes/postgres.ts` — pg-table-sizes route
- `apps/api/src/index.ts` — register postgres routes

## Acceptance criteria

- [x] `GET /projects/:name/pg-table-sizes` returns `{ tables: [{ name, totalBytes, rowEstimate }] }` sorted descending by totalBytes
- [x] Returns 404 when `project.config.postgres` is not set
- [x] Returns 503 on SSH failure
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/postgres.ts` with `GET /projects/:name/pg-table-sizes`. Uses `docker compose exec -T postgres psql` to query the top-10 tables by `pg_total_relation_size` with tab-separated output. Guards on `project.config.postgres`, returns 404 when unconfigured, 503 on SSH failure. 60s TTL cache with negative caching. Registered in `index.ts`.

### Files changed
- (new) `apps/api/src/routes/postgres.ts` — pg-table-sizes route
- `apps/api/src/index.ts` — registered `postgresRoutes`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `reltuples` estimate may be stale if ANALYZE hasn't run recently; acceptable for display but worth noting

## Out of scope

- Dashboard UI (sprint 132)
- Per-index breakdown
- Vacuum/bloat stats
- Support for non-Docker Postgres installs
