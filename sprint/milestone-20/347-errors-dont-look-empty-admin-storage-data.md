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
- [x] On a 503, the Firewall panel shows an unreachable state, never "Inactive" /
      "No rules configured" — covered by a test (`ufw-panel.test.tsx` or a helper test)
- [x] Same for Cron — covered by a test
- [x] Postgres 404 "not configured" renders differently from an empty table
      list — covered by a test
- [x] Data page shows a not-configured backups state when no bucket is set
- [x] A failed backup delete keeps the row and shows an error — covered in
      `use-backups` tests or `backup-panel.test.tsx`
- [x] The result type's status mapping has unit tests (`fetch-result.test.ts`)
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Networking, live logs and the detail page (sprint 348).
- Adding cron/UFW editing UI (see sprint 353's decision).
- API changes, unless an endpoint gives no way to tell errors apart; if so,
  note it as a follow-up instead of changing the API here.

## Completed

**Date:** 2026-09-22

### Summary
Introduced a shared `FetchResult<T>` discriminated union (`apps/dashboard/src/lib/fetch-result.ts`)
and a boring `<PanelState kind=… />` renderer (`apps/dashboard/src/components/ui/panel-state.tsx`)
that together give panels a way to tell "couldn't reach the server," "not
configured for this project," and "nothing here yet" apart. `fetchResult()`
wraps a fetch promise, maps HTTP 503 to `unreachable`, a 404 whose body's
`error` text matches `/not configured/i` to `not-configured`, and everything
else to a generic `error` (using the body's message when present) — it also
catches a rejected fetch promise (e.g. the dashboard's own API being down) as
`unreachable`, which none of the existing helpers handled.

Confirmed against the actual API routes (`cron.ts`, `ufw.ts`, `postgres.ts`)
that 503 = SSH/unreachable and 404 with `"<x> not configured"` bodies is the
real shape being returned, so the classifier's mapping isn't a guess.

`getCronJobs`, `getUfwRules` (`api-ops.ts`) and `getPgTableSizes` (`api-infra.ts`
— the sprint's file list named `api-ops.ts`, but this helper actually lives in
`api-infra.ts`) now return `FetchResult<T>` instead of silently coercing
errors into empty arrays/objects. `CronPanel`, `UfwPanel` and
`PgTableSizesPanel` track an `errorKind` alongside their existing `loading`
state and render `<PanelState kind={errorKind} />` instead of falling through
to the old "No X found" empty copy. The Firewall panel additionally hides its
Active/Inactive badge whenever `errorKind` is set, since that badge was the
worst offender: an unreachable server previously rendered as "Inactive · No
rules configured," indistinguishable from a genuinely unprotected one.

The Data page now renders a "Backups" panel with a not-configured `PanelState`
when `project.config.postgres?.backupBucket` is unset, instead of mounting
nothing.

For UI-08, `use-backups.ts`'s `deleteBackup` no longer removes the row
optimistically before the DELETE resolves. It now awaits `apiDeleteBackup`
inside a try/catch (the original had none, so a network failure was an
unhandled rejection), refetches the canonical list on success, and on failure
(rejection or `{ ok: false }`) leaves the row in place and sets `deleteError`
— matching the sprint's stated preference for await-then-mutate over
optimistic-then-restore.

### Files changed
- (new) `apps/dashboard/src/lib/fetch-result.ts` — `FetchResult<T>` type + status/body classifier
- (new) `apps/dashboard/src/lib/fetch-result.test.ts` — unit tests for the classifier
- (new) `apps/dashboard/src/components/ui/panel-state.tsx` — shared error/empty renderer
- `apps/dashboard/src/lib/api-ops.ts` — `getCronJobs`/`getUfwRules` return `FetchResult`
- `apps/dashboard/src/lib/api-infra.ts` — `getPgTableSizes` returns `FetchResult`
- `apps/dashboard/src/components/detail/cron-panel.tsx` — renders unreachable/empty distinctly
- (new) `apps/dashboard/src/components/detail/cron-panel.test.tsx`
- `apps/dashboard/src/components/detail/ufw-panel.tsx` — renders unreachable/empty distinctly, hides status badge on error
- (new) `apps/dashboard/src/components/detail/ufw-panel.test.tsx`
- `apps/dashboard/src/components/detail/pg-table-sizes-panel.tsx` — renders not-configured/unreachable/empty distinctly
- (new) `apps/dashboard/src/components/detail/pg-table-sizes-panel.test.tsx`
- `apps/dashboard/app/projects/[name]/data/page.tsx` — not-configured Backups state when no bucket is set
- `apps/dashboard/src/lib/use-backups.ts` — non-optimistic delete, keeps row + shows error on failure
- (new) `apps/dashboard/src/lib/use-backups.test.ts`

### Verification
- `pnpm test`: full run, 4 projects (core 163/163, api 439/439, dashboard 260/260, cli 280/280) — all pass
- `pnpm typecheck`: 5 projects, clean
- `pnpm lint`: 5 projects, clean

### Follow-ups
- `[defer]` `use-backups.ts`'s `deleteBackup`/`triggerBackup`/`getBackupDownloadUrl`
  still use the old throw-or-`{ok:boolean}` conventions rather than
  `FetchResult`. Left as-is since the sprint scoped only the read paths that
  were rendering fake-empty states; worth a follow-up sweep once sprint 348
  establishes whether every mutation path should adopt the same convention.
- `[defer]` `project-backups.ts`'s DELETE/trigger/download routes return
  `{ error: String(err) }` on failure rather than a stable machine-readable
  code, unlike the GET routes' `{ error: 'unreachable' }`. Not a blocker here
  since `deleteBackup`'s consumer only checks `res.ok`, but it means those
  three routes can't cleanly adopt `FetchResult`'s classifier later without an
  API-side change.
