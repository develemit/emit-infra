# Sprint 100 — JSON.parse guards + standardized error shapes

**Difficulty:** 2

## Goal

Wrap the three unguarded `JSON.parse()` calls in `projects.ts` in try/catch so a corrupt status file can't crash the API, and normalize all route error responses to a consistent `{ error: string }` shape.

## Reason

Three endpoints in `projects.ts` (backup-status, ci-status, deploy-status) call `JSON.parse()` on files read from disk with no try/catch. A single corrupted or partial write to `.backup-status.json` throws an uncaught `SyntaxError` that Fastify surfaces as a 500 and kills the request — the fleet health page then shows all projects as broken for the rest of the poll window. Separately, routes return `{ error: string }`, raw strings, and in some cases full objects — making client `if (res.error)` checks unreliable.

## Context

- The three risky `JSON.parse` calls are around lines 229, 239, and 249 of `apps/api/src/routes/projects.ts` — in the `backup-status`, `ci-status`, and `deploy-status` GET handlers. Each reads a file then parses it without guard.
- `push.ts` and `ops.ts` already use Zod schemas and return consistent `{ error }` shapes — use them as the style reference for what "good" looks like.
- `apps/api/src/routes/history.ts`, `operations.ts`, `rollback.ts`, `billing.ts` also return error objects — check them for shape consistency while you're reading them.
- Do NOT add a shared `errorBody()` helper that crosses file boundaries — a local inline `{ error: string }` in each route is simpler and consistent enough.

## Tasks

1. Read `apps/api/src/routes/projects.ts` fully to locate the three JSON.parse calls and understand the surrounding handler shape.
2. Wrap each of the three `JSON.parse()` calls in a try/catch. On parse failure, log a warning and return a 500 with `{ error: 'invalid status file' }` (or similar) rather than throwing.
3. Read the remaining route files (`history.ts`, `operations.ts`, `rollback.ts`, `billing.ts`, `secrets-sync.ts`) and audit their error responses for shape. Where they return raw strings or mixed shapes, normalize to `{ error: string }`.
4. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any type errors.

## Files involved

- `apps/api/src/routes/projects.ts` — wrap JSON.parse in try/catch at ~lines 229, 239, 249; normalize any inconsistent error returns
- `apps/api/src/routes/history.ts` — normalize error shapes if inconsistent
- `apps/api/src/routes/operations.ts` — normalize error shapes if inconsistent
- `apps/api/src/routes/rollback.ts` — normalize error shapes if inconsistent
- `apps/api/src/routes/billing.ts` — normalize error shapes if inconsistent
- `apps/api/src/routes/secrets-sync.ts` — normalize error shapes if inconsistent

## Acceptance criteria

- [x] The three JSON.parse calls in `projects.ts` are wrapped in try/catch; a corrupt file returns a 4xx/5xx `{ error }` response instead of an uncaught exception
- [x] All route files return `{ error: string }` (not raw strings, not `{ message }`) on error paths
- [x] `pnpm nx typecheck api --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Wrapped all three unguarded `JSON.parse()` calls in `projects.ts` (backup-status, ci-status, deploy-status handlers) in inner try/catch blocks. Each parse failure now logs a `console.warn` with the endpoint name and a truncated excerpt of the raw content, then returns a 500 `{ error: 'invalid status file' }`. Normalized error response shapes in `history.ts` — the ci-log and deploy-log endpoints were returning raw strings (`'invalid sha'`, `'not found'`, `'log not found'`), now all return `{ error: string }`. The remaining route files (`operations.ts`, `rollback.ts`, `billing.ts`, `secrets-sync.ts`) already used consistent `{ error: string }` shapes and needed no changes.

### Files changed
- `apps/api/src/routes/projects.ts` — added inner try/catch around JSON.parse in backup-status (~line 229), ci-status (~line 244), and deploy-status (~line 259) handlers
- `apps/api/src/routes/history.ts` — normalized raw string error returns in ci-log and deploy-log handlers to `{ error: string }` objects

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Adding a shared error utility module — inline is fine
- Zod validation on request inputs (that's sprint 101)
- Auth (that's sprint 102)
