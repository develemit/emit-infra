# Sprint 135 — UFW firewall rules viewer

**Difficulty:** 2

## Goal

Add a `GET /projects/:name/ufw-rules` API route and a read-only dashboard panel showing active UFW firewall rules and overall status (active/inactive) for the project's server.

## Reason

Firewall rules accumulate silently — a port opened for a debugging session, a rule added for a third-party service, a leftover from a decommissioned feature. Having visibility into the firewall state without SSHing in is a basic security hygiene win, especially before deploying new services or opening ports.

## Context

- This sprint combines the API and UI since both are small.
- API: create `apps/api/src/routes/ufw.ts`. Register in `apps/api/src/index.ts`.
- SSH command: `sudo ufw status numbered 2>/dev/null`
  - First line: `Status: active` or `Status: inactive`
  - Numbered rule lines: `[ 1] 22/tcp                     ALLOW IN    Anywhere`
  - Parse with a regex: `/^\[\s*(\d+)\]\s+(\S+)\s+(ALLOW|DENY|REJECT)\s+(IN|OUT|FWD)?\s+(.+)$/i`
  - Return type: `{ status: 'active' | 'inactive'; rules: { num: number; to: string; action: string; from: string }[] }`
- TTL cache 120_000ms.
- On SSH failure return 503.
- Dashboard:
  - Add `getUfwRules(name)` to `apps/dashboard/src/lib/api.ts`.
  - Component: `apps/dashboard/src/components/detail/ufw-panel.tsx`. Card with title "Firewall" and `shield` icon.
  - Header row: UFW status badge (`active` → ok/green, `inactive` → warn/yellow).
  - Rules table: Num | To | Action | From. Action colored: ALLOW → ok green, DENY/REJECT → err red.
  - If no rules: show "No rules configured".
  - Refresh button.
  - Mount in `apps/dashboard/app/projects/[name]/page.tsx` after `CronPanel`, guarded by `status !== null && !status?.error`.

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 1–15 and `apps/api/src/index.ts` to confirm import and registration patterns.
2. Create `apps/api/src/routes/ufw.ts` with route + parsing logic.
3. Register `ufwRoutes` in `apps/api/src/index.ts`.
4. Add `getUfwRules(name)` and `UfwRule` / `UfwStatus` types to `apps/dashboard/src/lib/api.ts`.
5. Create `apps/dashboard/src/components/detail/ufw-panel.tsx`.
6. Mount `<UfwPanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx` after CronPanel, guarded by `status !== null && !status?.error`.
7. Run `pnpm nx typecheck api --skip-nx-cache` and `pnpm nx typecheck dashboard --skip-nx-cache`. Fix errors.

## Files involved

- new file: `apps/api/src/routes/ufw.ts` — ufw-rules route + parser
- `apps/api/src/index.ts` — register ufw routes
- `apps/dashboard/src/lib/api.ts` — add types and fetch function
- new file: `apps/dashboard/src/components/detail/ufw-panel.tsx` — panel component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] `GET /projects/:name/ufw-rules` returns `{ status, rules: [{ num, to, action, from }] }`
- [x] `status: 'inactive'` returns an empty rules array (not an error)
- [x] Panel shows status badge and rules table
- [x] ALLOW rules styled green, DENY/REJECT red
- [x] Refresh works with loading state
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/ufw.ts` with `GET /projects/:name/ufw-rules` — SSHes `sudo ufw status numbered`, parses status line and numbered rule lines with regex, returns `{ status, rules }`. Inactive status returns empty rules array, not an error. 120s TTL cache. Created `UfwPanel` dashboard component with status badge (green/yellow), rules table (Num/To/Action/From) with ALLOW green and DENY/REJECT red, empty state, and Refresh button.

### Files changed
- (new) `apps/api/src/routes/ufw.ts` — ufw-rules route + parser
- `apps/api/src/index.ts` — registered `ufwRoutes`
- `apps/dashboard/src/lib/api.ts` — added `UfwRule`, `UfwStatus`, `getUfwRules`
- (new) `apps/dashboard/src/components/detail/ufw-panel.tsx` — firewall rules panel
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `UfwPanel` after CronPanel

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- `[defer]` IPv6 rules in `ufw status numbered` appear as separate blocks (v6 suffix); currently captured if they match the regex, which is acceptable

## Out of scope

- Adding or removing firewall rules from the dashboard
- ip6tables / IPv6-specific parsing
