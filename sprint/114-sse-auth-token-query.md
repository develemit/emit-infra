# Sprint 114 — SSE auth: token in query string

> _Promoted from sprint-102 and sprint-103 follow-ups, 2026-06-28._

**Difficulty:** 3

## Goal

Extend the API auth middleware to accept `?token=<secret>` as a fallback to the `Authorization: Bearer` header, and update all client-side SSE connections to include the token in the URL query string. This closes the auth gap for EventSource connections, which cannot set custom headers.

## Context

Sprint-102 added a shared-secret auth middleware (`apps/api/src/index.ts`) that checks `Authorization: Bearer <API_SECRET>`. This protects all API routes. However, `EventSource` (the browser SSE API) cannot send custom headers — so all SSE streaming endpoints are effectively unprotected when `API_SECRET` is set.

The affected endpoints are SSE-based streams served via Fastify's SSE reply pattern. Find them by looking for `reply.raw.write('data:` or `text/event-stream` in the API routes.

The client side opens these streams using `new EventSource(url)` in components like `DeployPanel`, `RollbackPanel`, `SecretsSyncPanel`, and wherever ops-chat SSE is consumed. Read those components to find the exact URLs being constructed.

### API-side fix
In `apps/api/src/index.ts`, extend the auth check:
```ts
// current
const auth = req.headers['authorization']
if (auth !== `Bearer ${API_SECRET}`) { reply.code(401).send(...) }

// extended — accept token in query string as fallback for EventSource
const auth = req.headers['authorization'] ?? (
  typeof req.query === 'object' && req.query !== null && 'token' in req.query
    ? `Bearer ${(req.query as Record<string, string>)['token']}`
    : undefined
)
```

Fastify parses query params before the hook fires, so `req.query` is available in the `preHandler` hook.

### Client-side fix
`getApiBase()` in `apps/dashboard/src/lib/api.ts` returns the base URL. Add a helper:
```ts
export function getApiBaseWithToken(): string {
  const base = getApiBase()
  const secret = typeof process !== 'undefined' ? process.env['NEXT_PUBLIC_API_SECRET'] : undefined
  if (!secret) return base
  return `${base}?token=${encodeURIComponent(secret)}`
}
```

Wait — query params must be after the path, not the base URL. Instead, expose a helper that appends the token to a full URL:
```ts
export function withToken(url: string): string {
  const secret = process.env['NEXT_PUBLIC_API_SECRET']
  if (!secret) return url
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}token=${encodeURIComponent(secret)}`
}
```

Then in each component that constructs an SSE URL, wrap it: `withToken(url)`.

Read the following files to find SSE URL construction:
- `apps/dashboard/src/components/deploy-panel.tsx`
- `apps/dashboard/src/components/rollback-panel.tsx`
- `apps/dashboard/src/components/secrets-sync-panel.tsx`
- Any other component using `EventSource` or `fetch` with `text/event-stream`

## Tasks

1. Read `apps/api/src/index.ts` fully. Extend the auth hook to accept `?token=` as a fallback to the `Authorization` header.
2. Read `apps/dashboard/src/lib/api.ts`. Add a `withToken(url: string): string` export that appends `?token=<NEXT_PUBLIC_API_SECRET>` when the env var is set.
3. Find all components that construct SSE or streaming URLs. Update each to call `withToken(url)`.
4. Run `pnpm nx typecheck api --skip-nx-cache` and `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.
5. Manually verify the auth middleware is still tested by the existing `?` check — add a test case to `projects.test.ts` or `history.test.ts` that sends a `?token=` param to a protected endpoint and gets 200.

## Files involved

- `apps/api/src/index.ts` — extend auth hook
- `apps/dashboard/src/lib/api.ts` — add `withToken()` helper
- `apps/dashboard/src/components/deploy-panel.tsx` — use `withToken()`
- `apps/dashboard/src/components/rollback-panel.tsx` — use `withToken()`
- `apps/dashboard/src/components/secrets-sync-panel.tsx` — use `withToken()`
- Any other SSE-using component found during read

## Acceptance criteria

- [ ] `?token=<secret>` accepted by auth middleware as equivalent to `Authorization: Bearer <secret>`
- [ ] `withToken()` helper exported from `api.ts`
- [ ] All client-side SSE/streaming URL construction uses `withToken()`
- [ ] At least one test verifies `?token=` auth works on a protected route
- [ ] `pnpm nx typecheck api --skip-nx-cache` clean
- [ ] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Out of scope

- Rotating or expiring tokens (the secret is static per deployment)
- Adding token to non-SSE routes (the header path handles those correctly)
- Changing the SSE transport or reconnect strategy
