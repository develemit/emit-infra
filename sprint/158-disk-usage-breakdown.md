# Sprint 158 — Disk usage breakdown

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 2

## Goal

Add a `GET /projects/:name/disk-breakdown` API route that SSHes `du -sh` on the major disk consumers, then render the results as a category breakdown alongside the existing disk meter in the project detail page.

## Reason

The current disk display shows "42% used (18G of 40G)" but gives no hint of *where* space is going. Docker image accumulation is the most common culprit but looks identical to a full log directory. Showing the breakdown by category ("Docker: 14G, App: 2G, Logs: 1G") takes the guesswork out.

## Context

- Existing disk display is in `apps/dashboard/src/components/detail/health-card.tsx`. Before touching it, check whether `apps/dashboard/src/components/detail/disk-dirs-panel.tsx` or `docker-usage.tsx` already provide partial breakdown — read those files first. If they do, extend or companion them rather than duplicating.
- SSH command: `du -sh /var/lib/docker /opt/${name} /var/log /home 2>/dev/null || true`
  - Output: lines like `14G\t/var/lib/docker`
  - Parse with: `line.split('\t')` → `[humanSize, path]`
- Use `sshExec(host, cmd, key)` from `@emit-infra/core`.
- TTL: 300_000ms (5 minutes — `du` is expensive).
- Return: `{ categories: Array<{ path: string; humanSize: string }> }`.
- Dashboard: a compact list of `path → humanSize` rows, shown below the disk meter in `HealthCard` or as a toggle/expand (prefer always-visible if it fits, but don't let it dominate the card).

## Tasks

1. Read `apps/dashboard/src/components/detail/disk-dirs-panel.tsx` and `apps/dashboard/src/components/detail/docker-usage.tsx` to understand what disk info already exists. Note overlaps.
2. In `apps/api/src/routes/` create a new file `apps/api/src/routes/disk.ts` with `diskRoutes(app)` exporting `GET /projects/:name/disk-breakdown`:
   - `findProject`, `sshKeyPath`, TTL cache, `sshExec`.
   - Parse `du -sh` output into `{ categories }`.
   - 503 on SSH failure; 404 if project not found.
3. Register `diskRoutes` in `apps/api/src/index.ts`.
4. In `apps/dashboard/src/lib/api.ts`, add `DiskCategory`, `DiskBreakdown`, and `getDiskBreakdown(name)`.
5. Add the breakdown display to the project detail page — either inline below the existing disk meter in `HealthCard` (pass it as a prop) or render a small companion panel. Keep it to ≤6 rows.
6. Run both typechecks.

## Files involved

- (new) `apps/api/src/routes/disk.ts` — `diskRoutes` with `GET /projects/:name/disk-breakdown`
- `apps/api/src/index.ts` — register `diskRoutes`
- `apps/dashboard/src/lib/api.ts` — `DiskCategory`, `DiskBreakdown`, `getDiskBreakdown`
- `apps/dashboard/src/components/detail/health-card.tsx` or a new companion component — render breakdown rows
- `apps/dashboard/app/projects/[name]/page.tsx` — fetch + pass down

## Acceptance criteria

- [ ] `GET /projects/:name/disk-breakdown` returns a `categories` array with `path` and `humanSize`
- [ ] SSH failure returns 503, missing project returns 404
- [ ] Categories render inline near the existing disk meter
- [ ] Both typechecks pass clean

## Out of scope

- Sorting by size (show in the same order `du` returns them)
- Numeric bytes (humanSize only)
- Alerting when a category exceeds a threshold
