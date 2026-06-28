# Sprint 102 — API auth middleware (shared-secret header)

**Difficulty:** 3

## Goal

Add a Fastify `onRequest` hook that validates an `Authorization: Bearer <secret>` header on every route, with the secret loaded from an env var (`API_SECRET`). Update the dashboard's `apiFetch` to send the header on every request.

## Reason

Every API route is currently fully unauthenticated. Anyone who can reach the network endpoint can trigger SSH operations, destroy infrastructure, read secrets, and push notifications. Adding a shared-secret header gate is the minimal viable auth layer before the dashboard is exposed beyond localhost — it's a single hook in `index.ts` and a single header in `apiFetch`.

## Context

- The API is a Fastify server in `apps/api/src/index.ts`. Add a `fastify.addHook('onRequest', ...)` before any route registration to check for `Authorization: Bearer <value>` header. If `API_SECRET` env var is not set, skip the check (dev mode). If the header is missing or wrong, return 401 `{ error: 'unauthorized' }`.
- `apps/dashboard/src/lib/api.ts` is the single `apiFetch` helper used by all dashboard calls. Read it to understand how it constructs fetch calls, then add the Authorization header using `NEXT_PUBLIC_API_SECRET` env var. If the env var is absent, send the request without the header (dev mode compatibility).
- CORS: `@fastify/cors` is already registered with `origin: '*'` in index.ts. Ensure the `Authorization` header is included in CORS `allowedHeaders` if needed — check whether the current wildcard config already covers it.
- Health check: add a `/health` GET route (or exempt it from auth) so uptime monitors don't get 401s.
- Do not add a UI for managing the secret — this is a static env var set in `.env` / deployment config.

## Tasks

1. Read `apps/api/src/index.ts` to understand the current Fastify bootstrap.
2. Add an `onRequest` hook after CORS but before route registration. If `API_SECRET` is set in env, reject any request missing the matching `Authorization: Bearer` header with 401 `{ error: 'unauthorized' }`. Exempt `OPTIONS` pre-flight requests.
3. Read `apps/dashboard/src/lib/api.ts` fully. Add `Authorization: Bearer ${process.env.NEXT_PUBLIC_API_SECRET}` to the headers of every request when the env var is present.
4. Update `apps/dashboard/app/layout.tsx` or the relevant Next.js config to ensure `NEXT_PUBLIC_API_SECRET` is passed through (check if `.env.example` or similar exists; if not, document in the file what env vars are needed via a comment).
5. Run `pnpm nx typecheck api --skip-nx-cache` and `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any type errors.

## Files involved

- `apps/api/src/index.ts` — add `onRequest` auth hook
- `apps/dashboard/src/lib/api.ts` — add Authorization header to all fetch calls

## Acceptance criteria

- [x] A request to any API route without `Authorization: Bearer <API_SECRET>` returns 401 when `API_SECRET` is set
- [x] When `API_SECRET` is not set, all routes respond normally (dev mode)
- [x] Dashboard's `apiFetch` sends the Authorization header when `NEXT_PUBLIC_API_SECRET` is set
- [x] `OPTIONS` pre-flight requests pass through without auth check
- [x] `pnpm nx typecheck api --skip-nx-cache` clean
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Added shared-secret auth middleware to the API. In `index.ts`, the CORS registration now explicitly allows the `Authorization` header, and an `onRequest` hook is conditionally registered when `API_SECRET` env var is present. The hook skips `OPTIONS` (CORS pre-flight) and `/health` requests, and returns 401 `{ error: 'unauthorized' }` on missing or wrong bearer token. A `/health` GET route was added for uptime monitors. When `API_SECRET` is not set, no hook is registered and all routes work as before (dev mode unchanged).

On the dashboard side, `api.ts` received an `authHeaders()` helper that returns `{ Authorization: 'Bearer <token>' }` when `NEXT_PUBLIC_API_SECRET` is set, or an empty object otherwise. The helper is applied to `apiFetch` and to all 13 direct `fetch()` calls throughout the file — GET requests, POST requests (with `...authHeaders()` spread into the headers object), and the specialized status handlers. EventSource-based SSE connections (`openSseStream`) cannot carry custom headers by spec and are left unchanged.

### Files changed
- `apps/api/src/index.ts` — added `allowedHeaders` to CORS, added conditional `onRequest` auth hook, added `/health` route
- `apps/dashboard/src/lib/api.ts` — added `API_SECRET` constant, `authHeaders()` helper, applied to `apiFetch` and all 13 direct fetch calls

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- `[defer]` SSE connections (deploy, rollback, logs, provision, ops chat) use `EventSource` which cannot send custom headers — if the API is internet-exposed, these endpoints would need a token in the URL query string or a different transport

## Out of scope

- Per-route permissions or role-based access control
- JWT tokens or session-based auth
- A login UI
- Rotating secrets or secret management tooling
