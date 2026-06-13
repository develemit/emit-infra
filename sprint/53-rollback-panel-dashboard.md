# Sprint 53 — Rollback Panel in Dashboard
**Difficulty:** 4

## Goal
Add a Rollback button to the project detail page that opens a panel listing available timestamped snapshots and lets the operator restore one — without touching the CLI.

## Reason
Sprint 44 (rollback --list / --timestamp) and sprint 46 (multi-image --list) gave the CLI full rollback capability, but the dashboard has no access to it. Operators who use the dashboard as their primary interface can't roll back without dropping to a terminal. The panel follows the exact same SSE streaming pattern as DeployPanel so the implementation risk is low.

## Context

### API: two new endpoints

**1. `GET /projects/:name/rollback/snapshots`**
SSHes in and queries rollback tags, same logic as `listRollbackSnapshots` in `apps/cli/src/commands/rollback.ts` (lines 101–110 post-sprint-46):
```ts
const bases = [...new Set(imageList.map(img => img.split(':')[0]))]
const clauses = bases.map(base =>
  `docker images --format "{{.Repository}}:{{.Tag}}" "${base}" | grep ":rollback-"`)
  .join(';\n  ')
const output = await sshExec(host, `{ ${clauses}; } | sort -u -r`, key)
```
Needs the compose image list first (`docker compose -f <composeFile> config --images`).
Returns `{ snapshots: string[] }` where each entry is e.g. `ghcr.io/org/app:rollback-20260612T033000`.

To get `composeFile` and `appDir` for a project: read the project's `.emit-infra.json` config — `config.deploy?.composeDest ?? 'docker-compose.yml'` and `config.deploy?.appDir ?? '/app'`. The `findProject` helper in `routes/projects.ts` already does this.

**2. `POST /projects/:name/rollback` (SSE)**
Body: `{ timestamp?: string }` — if present, tag `<base>:<timestamp>` as `:latest` for each image then restart; if absent, tag `:rollback` as `:latest` and restart. Mirrors CLI logic.

The SSE pattern to follow: copy the `openSse` / `writeEvent` pattern from `apps/api/src/routes/operations.ts` (lines 20–35). Run the compose up via `sshExec` — no Ansible needed, just SSH commands like the CLI does.

### Dashboard: new panel component

`apps/dashboard/src/components/rollback-panel.tsx` — similar structure to `deploy-panel.tsx` but:
1. On mount, fetches `/projects/:name/rollback/snapshots`
2. If snapshots exist: renders a `<select>` or radio list of timestamps + a "Restore" button
3. On "Restore": fires `POST /projects/:name/rollback` with SSE, streams output just like DeployPanel
4. Also provides "Restore latest :rollback" as a default option (no timestamp body)

In `apps/dashboard/app/projects/[name]/page.tsx`:
- Add `showRollback` state
- Add a "Rollback" button to the topbar (between Logs and Deploy, or next to Deploy)
- Render `<RollbackPanel ... />` when `showRollback` is true

## Tasks
1. Read `apps/api/src/routes/operations.ts` (the deploy endpoint) to understand the SSE pattern fully.
2. Read `apps/api/src/routes/projects.ts` (the docker-usage + containers endpoints) for the SSH exec + JSON response pattern.
3. Add `GET /projects/:name/rollback/snapshots` to `routes/projects.ts`. SSH exec to get image list then run the rollback-list compound command. Return `{ snapshots: string[] }`.
4. Add `POST /projects/:name/rollback` to `routes/operations.ts` as an SSE endpoint. Accept `{ timestamp?: string }` body. Build tag + restart commands per image, run via `sshExec`, stream lines as SSE events. Finish with `done` event.
5. Add `getRollbackSnapshots(name)` and `rollbackProject(name, timestamp?)` to `apps/dashboard/src/lib/api.ts`.
6. Write `apps/dashboard/src/components/rollback-panel.tsx`. On open: show loading → snapshot list (or "no snapshots"). On restore click: stream SSE output in a Terminal component (copy DeployPanel's `useDeploySse` hook structure or move it to a shared hook). Show close button on completion.
7. Read `apps/dashboard/app/projects/[name]/page.tsx` — add Rollback button + `showRollback` state + `<RollbackPanel>` rendering (same pattern as `showDestroy` / `DestroyModal`).
8. Run `pnpm nx run dashboard:typecheck`.

## Files involved
- `apps/api/src/routes/projects.ts` — new `GET /projects/:name/rollback/snapshots`
- `apps/api/src/routes/operations.ts` — new `POST /projects/:name/rollback` (SSE)
- `apps/dashboard/src/lib/api.ts` — add `getRollbackSnapshots()`, `rollbackProject()`
- (new) `apps/dashboard/src/components/rollback-panel.tsx` — snapshot list + SSE terminal
- `apps/dashboard/app/projects/[name]/page.tsx` — Rollback button + panel state

## Acceptance criteria
- [x] `GET /projects/:name/rollback/snapshots` returns a list of rollback-* tags or an empty array
- [x] `POST /projects/:name/rollback` streams SSE and restores the selected snapshot (or latest :rollback)
- [x] Rollback button appears on project detail page topbar (desktop) and mobile footer
- [x] RollbackPanel opens, shows available snapshots, and streams output on restore
- [x] Closing the panel clears state (no stale snapshot list on re-open)
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-13

### Summary
Added two API endpoints: `GET /projects/:name/rollback/snapshots` (SSHes to get compose image list, queries rollback-* tags, returns `{ snapshots: string[] }`) and `POST /projects/:name/rollback` (SSE — tags selected snapshot or `:rollback` as `:latest`, runs compose up, streams status lines). Added `getRollbackSnapshots()` and `rollbackProject()` to the dashboard API lib. Created `rollback-panel.tsx` with a `useRollbackSse` hook following the DeployPanel pattern; shows snapshot select → Restore button → SSE terminal → close button. Added Rollback button to both desktop topbar and mobile footer in the project detail page, with `showRollback` state controlling panel visibility.

### Files changed
- `apps/api/src/routes/projects.ts` — `GET /projects/:name/rollback/snapshots`
- `apps/api/src/routes/operations.ts` — `POST /projects/:name/rollback` SSE endpoint, added `sshExec` import
- `apps/dashboard/src/lib/api.ts` — added `getRollbackSnapshots()` and `rollbackProject()`
- (new) `apps/dashboard/src/components/rollback-panel.tsx` — snapshot list + SSE terminal panel
- `apps/dashboard/app/projects/[name]/page.tsx` — Rollback button + `showRollback` state + `<RollbackPanel>`

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` projects.ts is now ~300 lines — candidate for splitting (snapshots endpoint into a rollback-specific route file) if the file grows further

## Out of scope
- Ansible-based rollback (SSH exec only, same as CLI)
- Blue-green rollback (separate infra, out of scope)
- Rollback history / audit log
