# Sprint 103 — Reliability polish (retry, silent catches, HTTP fallback)

**Difficulty:** 2

## Goal

Add exponential backoff retry to `apiFetch`, replace silent `.catch(() => null)` in the two trend hooks and projects.ts config reader, and add a fallback return value when the HTTP check times out.

## Reason

Transient network glitches or a brief API restart currently cause hard failures visible to the user — the status card goes blank, charts stop updating, and no recovery happens until the next poll cycle. These are all defensive fixes with no user-facing behavior change under normal conditions; they only matter when something is flaky.

## Context

- `apps/dashboard/src/lib/api.ts` — the `apiFetch` helper is the single fetch wrapper used by every dashboard call. Wrap it with a simple retry loop (max 2 retries, doubling delay starting at 300ms) that retries on network errors or 5xx responses. Do NOT retry 4xx — those are client errors.
- `apps/dashboard/src/lib/use-disk-trend.ts` and `use-memory-trend.ts` — both have `.catch(() => null)` that silently drops fetch failures. Replace with `.catch((err) => { console.warn('disk-trend fetch failed:', err); return null })` so failures are at least visible in devtools.
- `apps/api/src/routes/projects.ts` — `readProjectConfig()` at line ~52 already has a try/catch that returns null. That's fine. But the HTTP status check in `checkHttp()` (lines ~33–43) returns null on timeout with no logging; add a `console.warn` so the server log shows which domain is failing the HTTP probe.
- Keep retry logic minimal — a simple `for` loop with `await new Promise(r => setTimeout(r, delay))` is enough. No external retry library.

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` fully. Add a retry wrapper inside `apiFetch`: on network error or 5xx status, wait 300ms then 600ms and retry up to 2 times before throwing.
2. Read `apps/dashboard/src/lib/use-disk-trend.ts` and `use-memory-trend.ts`. Replace bare `.catch(() => null)` with a version that logs the error to `console.warn` before returning null.
3. Read `apps/api/src/routes/projects.ts`. In `checkHttp()`, add a `console.warn(\`HTTP check failed for \${domain}: \${err}\`)` in the catch block.
4. Run `pnpm nx typecheck dashboard --skip-nx-cache` and `pnpm nx typecheck api --skip-nx-cache`.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add retry loop in `apiFetch`
- `apps/dashboard/src/lib/use-disk-trend.ts` — replace silent catch
- `apps/dashboard/src/lib/use-memory-trend.ts` — replace silent catch
- `apps/api/src/routes/projects.ts` — add console.warn in `checkHttp` catch

## Acceptance criteria

- [x] `apiFetch` retries up to 2 times on network error or 5xx, with 300ms / 600ms delays
- [x] `apiFetch` does NOT retry on 4xx responses
- [x] `use-disk-trend` and `use-memory-trend` log errors before swallowing
- [x] `checkHttp` logs a warning when the HTTP probe fails
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean
- [x] `pnpm nx typecheck api --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Added retry logic to `apiFetch` in `api.ts`: a `for` loop up to 2 retries with 300ms then 600ms delays, retrying on 5xx responses or `TypeError` (network error), passing through 4xx unchanged. The two trend hooks (`use-disk-trend.ts`, `use-memory-trend.ts`) now log via `console.warn` before returning null, making transient failures visible in devtools without changing the null-return contract. The `checkHttp()` function in `projects.ts` now logs which domain failed so the API server log captures HTTP probe failures.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added retry loop in `apiFetch` (max 2 retries, 300ms/600ms delays, retries on 5xx or TypeError only)
- `apps/dashboard/src/lib/use-disk-trend.ts` — replaced silent `.catch(() => null)` with warn-logging catch
- `apps/dashboard/src/lib/use-memory-trend.ts` — replaced silent `.catch(() => null)` with warn-logging catch
- `apps/api/src/routes/projects.ts` — added `console.warn` in `checkHttp` catch block

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` SSE streaming endpoints (deploy, ops chat, rollback, secrets-sync) still have no retry — those need a different transport strategy if reliability is needed

## Out of scope

- Retry on the SSE streaming endpoints (deploy, ops chat) — those require different handling
- Circuit breaker or backpressure logic
- Surfacing retry state to the user in the UI
