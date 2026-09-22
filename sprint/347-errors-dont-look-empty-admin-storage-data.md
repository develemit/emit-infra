# Stop fetch errors masquerading as empty config — admin, storage, data
**Difficulty:** 4

## Goal
When a server can't be reached or a feature isn't configured, the Admin,
Storage and Data pages say so, instead of showing "no rules", "Inactive", "no
tables" or nothing at all. A failed backup delete tells you it failed.

## Reason
UI-03 (broken), UI-08 (broken) and part of UI-11 in
`qa/ui-audit-2026-09-22.md`. The worst instance: on an unreachable server, the
Firewall panel says **"Inactive · No rules configured"**, which is exactly what
a genuinely unprotected server would show. An operator can't tell "couldn't
check" from "wide open". The same pattern (errors swallowed into empty results)
recurs across pages, so this sprint establishes the pattern and applies it to
the three data-heavy pages. Sprint 348 applies it to networking, logs and the
detail page.

## Context

### The root cause
Fetch helpers turn non-OK responses into empty values. `apps/dashboard/src/lib/api-ops.ts`:
```ts
export async function getCronJobs(name) { … if (!res.ok) return [] … }
export async function getUfwRules(name) { … if (!res.ok) return { status: 'inactive', rules: [] } … }
```
So the panels (`src/components/detail/cron-panel.tsx`, `ufw-panel.tsx`) cannot
tell an error from empty.

Other instances in scope:
- `src/components/detail/pg-table-sizes-panel.tsx:70` shows "No tables found"
  when the API returned **404 `postgres not configured`** (seen on develemail).
  "Not configured" and "empty" must read differently.
- `app/projects/[name]/data/page.tsx:23` only mounts `BackupPanel` when
  `project.config.postgres.backupBucket` is set. No project has a bucket today,
  so the panel is simply absent: no "Backups not configured" line, no hint. Show
  a short not-configured state instead of nothing.
- `src/components/detail/docker-usage.tsx`: when `getDockerUsage` fails the
  panel shows "Could not load Docker usage." That one is already honest; use it
  as the wording reference.

### UI-08 — delete backup fails silently
`src/lib/use-backups.ts:34-36`: `deleteBackup` removes the row optimistically
(`setBackups(prev => prev.filter(…))`) and awaits `apiDeleteBackup` with no
try/catch. On failure it's an unhandled rejection and the backup vanishes from
the list with no message. The hook already returns a `deleteError` field. Use
it: restore the row and surface the error. Deleting is destructive, so prefer
awaiting the DELETE before removing the row over optimistic removal.

### Design decision to implement
Introduce one small, boring convention rather than a framework: fetch helpers
return a discriminated result, e.g.
`{ ok: true, data } | { ok: false, kind: 'unreachable' | 'not-configured' | 'error', message }`,
mapping 503 to `unreachable` and the API's explicit "not configured" 404s to
`not-configured`. Check what status codes and bodies the API routes actually
return (`apps/api/src/routes/cron.ts`, `ufw.ts`, `postgres.ts`,
`project-backups.ts`) before choosing the mapping. Put the type and a tiny
`<PanelError kind=… />` (or equivalent) where sprint 348 can reuse them, e.g.
`src/lib/fetch-result.ts` and `src/components/ui/panel-state.tsx`. Keep the
wording consistent: "Couldn't reach the server", "Not configured for this
project", "Nothing here yet".

Existing panels have tests to follow (`backup-panel.test.tsx`,
`container-row.test.tsx`).

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- Visual checks only through `tools/ui-audit/read-only-guard.mjs`. `test-smoke`
  is the natural unreachable project (domain `192.0.2.1`); see
  `docs/qa-page-inventory.md` for stubbing a GET.
- Global preference: files ≤300 lines. Split if a panel grows past it.

## Tasks
1. Read the API routes to learn real error statuses/bodies.
2. Add the result type + shared panel-state component.
3. Convert `getCronJobs`, `getUfwRules` and the pg-table-sizes fetch; render
   unreachable / not-configured / empty distinctly in their panels.
4. Render a "Backups not configured" state on the Data page when no bucket is set.
5. Make backup delete non-optimistic (or restore on failure) and show the error.

## Files involved
- `apps/dashboard/src/lib/api-ops.ts` — helpers return results, not fake empties
- new file: `apps/dashboard/src/lib/fetch-result.ts` — result type + status mapping
- new file: `apps/dashboard/src/components/ui/panel-state.tsx` — shared error/empty renderer
- `apps/dashboard/src/components/detail/cron-panel.tsx`, `ufw-panel.tsx`, `pg-table-sizes-panel.tsx`
- `apps/dashboard/app/projects/[name]/data/page.tsx` — not-configured state
- `apps/dashboard/src/lib/use-backups.ts` — delete error handling

## Acceptance criteria
- [ ] On a 503, the Firewall panel shows an unreachable state, never "Inactive" /
      "No rules configured" — covered by a test (`ufw-panel.test.tsx` or a helper test)
- [ ] Same for Cron — covered by a test
- [ ] Postgres 404 "not configured" renders differently from an empty table
      list — covered by a test
- [ ] Data page shows a not-configured backups state when no bucket is set
- [ ] A failed backup delete keeps the row and shows an error — covered in
      `use-backups` tests or `backup-panel.test.tsx`
- [ ] The result type's status mapping has unit tests (`fetch-result.test.ts`)
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Networking, live logs and the detail page (sprint 348).
- Adding cron/UFW editing UI (see sprint 353's decision).
- API changes, unless an endpoint gives no way to tell errors apart; if so,
  note it as a follow-up instead of changing the API here.
