# Sprint 101 — Zod validation on remaining API routes

**Difficulty:** 3

## Goal

Add Zod schemas to all route handlers in `history.ts`, `operations.ts`, `rollback.ts`, and `secrets-sync.ts` that currently accept path params, query strings, or request bodies with no validation.

## Reason

`push.ts` and `ops.ts` already use Zod for input validation and serve as the model. The remaining four route files trust whatever the client sends: `rollback.ts` embeds the raw `timestamp` string into Docker tag syntax; `operations.ts` passes `projectName` directly to shell commands; `history.ts` reads `hours` and `limit` query params with no bounds beyond inline Math.min. Malformed input causes 500s or, in destructive routes, silently degrades. Zod catches these at the boundary.

## Context

- Look at `apps/api/src/routes/push.ts` and `apps/api/src/routes/ops.ts` for how Zod schemas are declared and used in this codebase. The pattern is: declare a `z.object(...)` schema at the top of the route block, call `.parse(req.body)` or `.parse(req.params)`, and return `{ error }` on `ZodError`.
- `zod` is already in the project's dependencies — no install needed.
- Fastify generic types (`app.get<{ Params: ...; Querystring: ...; Body: ... }>`) can be replaced with inferred Zod output types via `z.infer<typeof schema>`.
- For path params like `:name`, the schema should validate it's a non-empty string. For destructive operations, consider also validating that the value doesn't contain path traversal characters (`..`, `/`) — but don't go overboard.
- History route has `hours` (numeric, 1–720) and `limit` (numeric, 1–200) query params — these are already clamped with Math.min/max but the raw parse is unguarded.

## Tasks

1. Read `apps/api/src/routes/push.ts` and `apps/api/src/routes/ops.ts` to internalize the validation pattern used.
2. Read `apps/api/src/routes/history.ts` fully. Add Zod schemas for path params (`name`) and query strings (`hours`, `limit`) on all three routes.
3. Read `apps/api/src/routes/operations.ts` fully. Add Zod schemas for path params and request bodies on all handlers (deploy, destroy, restart, etc.).
4. Read `apps/api/src/routes/rollback.ts` fully. Add Zod schema for the `timestamp` body field — validate it matches the expected format.
5. Read `apps/api/src/routes/secrets-sync.ts` fully. Add Zod schema for any params or body fields.
6. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/api/src/routes/history.ts` — add Zod schemas for params + querystring
- `apps/api/src/routes/operations.ts` — add Zod schemas for params + body
- `apps/api/src/routes/rollback.ts` — add Zod schema for body (timestamp)
- `apps/api/src/routes/secrets-sync.ts` — add Zod schemas for params + body

## Acceptance criteria

- [x] Every route handler in the four files validates its inputs with a Zod schema
- [x] Invalid input returns a 400 `{ error: string }` response (not a 500)
- [x] No existing runtime behavior changes for valid inputs
- [x] `pnpm nx typecheck api --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Added Zod validation (`zod/v4`, matching the pattern from `push.ts`) to all four route files. Each file received local schema constants at the top — `NameParam`, `ShaParam`, `HoursQuery`, `LimitQuery`, `ProvisionBody`, `LogsQuery`, `RollbackBody`, `SecretsSyncBody` — and every handler was updated to call `.safeParse()` on its inputs, returning 400 `{ error }` on failure. The Fastify generic type annotations (`app.get<{ Params: ... }>`) were removed in favor of Zod-inferred types. The `ShaParam` in `history.ts` uses a regex (`/^[a-f0-9]{7,40}$/`) replacing the manual `/` check that was there before. The `NameParam` in `operations.ts` also validates against a safe character set (`/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/`). The `RollbackBody.timestamp` regex ensures Docker-safe tag strings. The `SecretsSyncBody.envFile` refine blocks path traversal.

### Files changed
- `apps/api/src/routes/history.ts` — added Zod imports + 4 schemas; replaced all Fastify generic types with safeParse on params/query
- `apps/api/src/routes/operations.ts` — added Zod imports + 3 schemas; all 4 handlers (deploy, provision, destroy, logs) now validate inputs
- `apps/api/src/routes/rollback.ts` — added Zod imports + 2 schemas; both handlers validate params and body
- `apps/api/src/routes/secrets-sync.ts` — added Zod imports + 2 schemas; handler validates params and envFile body field

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Auth (sprint 102)
- Adding Zod to `projects.ts` — the status/container routes mostly take `:name` path params; those can be added in a follow-up if needed
- Changing the response payload shape beyond what's needed for validation errors
