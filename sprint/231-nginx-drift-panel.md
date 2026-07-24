# Add nginx vhost drift panel to the project detail page
**Difficulty:** 2

## Goal
The project detail page shows an "Nginx config" panel reporting whether the repo-owned vhost matches the one deployed on the server, with the diff viewable when it doesn't.

## Reason
Sprint 230 added the drift API but nothing surfaces it. One of the explicit acceptance criteria from the emit-vision incident report is: *"Drift between intended and on-server config is visible, not silent."* An API route nobody looks at doesn't satisfy that — the whole failure mode here was that a config problem stayed invisible for months while the dashboard looked healthy.

This also has immediate operational value: before sprint 232 turns on deploy-time syncing, the operator needs a way to eyeball what would get overwritten across all five affected projects (emit-vision, develemail, emit-social, tastease, martialops) without running curl by hand against each one.

## Context
This repo consistently ships an API route and its panel as separate sprints — see 137/138 (secrets drift), 159/160 (container logs), 133/134 (cron). Follow that convention and the existing panel style.

- `apps/dashboard/src/components/detail/secrets-panel.tsx` (136 lines) — the closest analogue. Copy its shape: `'use client'`, local `useState` for data/loading, an async fetch function, `useEffect` on mount, `Badge` for status, `Icon` for the header.
- `apps/dashboard/src/lib/api-infra.ts` — where nginx-related API client functions live. Note sprint 229 migrated all dashboard imports off the `~/lib/api` barrel to domain-specific modules; **import from `@/lib/api-infra`, not `@/lib/api`**, or you'll reintroduce the barrel dependency that sprint just removed.
- Existing infra panels to match visually: `apps/dashboard/src/components/detail/cert-panel.tsx`, `nginx-endpoints-panel.tsx`, `ufw-panel.tsx`.
- The route from sprint 230 returns one of: `{ status: 'unconfigured' }`, `{ status: 'missing-local', localPath }`, `{ status: 'missing-server', ... }`, or `{ status: 'ok' | 'drift', localPath, serverPath, localLines, serverLines, diff }`.
- Keep the file under ~200 lines per this project's file-size convention. If the diff viewer grows, extract it into a sibling component rather than letting the panel balloon.

## Tasks
1. Add `getNginxDrift(name: string)` plus an exported `NginxDrift` type to `apps/dashboard/src/lib/api-infra.ts`, following the existing function style in that module.
2. Create `apps/dashboard/src/components/detail/nginx-config-panel.tsx`:
   - Fetches drift on mount for the given project `name`.
   - Renders a status badge: `ok` → success/green, `drift` → warning/amber, `missing-server` / `missing-local` → error/red, `unconfigured` → muted "Not managed".
   - When status is `drift`, render the diff lines in a monospace block, colouring `+` lines green and `-` lines red. Collapse behind a "Show diff" toggle so the panel stays compact by default.
   - Handle the loading state and a fetch failure (server unreachable → show "Unreachable", not a crash).
3. Render the panel on the project detail page next to the other infra panels (cert / ufw / nginx-endpoints).
4. Add `apps/dashboard/src/components/detail/nginx-config-panel.test.tsx` covering: `ok` renders the success badge, `drift` renders the diff toggle and diff lines, `unconfigured` renders the muted state, and a failed fetch renders the unreachable state. Mock `@/lib/api-infra` the way `health-card.test.tsx` and `incident-panel.test.tsx` do.
5. Run `npx nx run dashboard:test` and `npx nx run dashboard:typecheck`.

## Files involved
- `apps/dashboard/src/lib/api-infra.ts` — add `getNginxDrift` + `NginxDrift` type
- (new file) `apps/dashboard/src/components/detail/nginx-config-panel.tsx` — the panel
- (new file) `apps/dashboard/src/components/detail/nginx-config-panel.test.tsx` — panel tests
- the project detail page under `apps/dashboard/src/` — mount the panel alongside the other infra panels
- `apps/dashboard/src/components/detail/secrets-panel.tsx` — read-only reference for style; do not modify

## Acceptance criteria
- [x] The project detail page shows nginx config status for a project that declares `nginx.customConfigSrc`.
- [x] A drifted project shows the diff on demand, with added/removed lines visually distinguishable.
- [x] A project without `customConfigSrc` shows a muted "not managed" state rather than an error.
- [x] An unreachable server degrades gracefully instead of crashing the page.
- [x] All imports come from `@/lib/api-infra`, not the `@/lib/api` barrel.
- [x] `npx nx run dashboard:test` passes and `npx nx run dashboard:typecheck` is clean.

## Completed

**Date:** 2026-07-23

### Summary
Implemented the nginx config drift panel for the project detail page following the existing pattern from secrets-drift (sprint 137/138). The panel shows vhost alignment status and displays a collapsible diff viewer when configs have drifted.

Added `getNginxDrift` API client function to `api-infra.ts`, created the `NginxConfigPanel` component with status badges (ok→green, drift→amber, missing→red, unconfigured→hidden), and extracted a focused `DiffViewer` subcomponent for the diff display to keep the main panel compact. The diff renders with color-coded lines (+green, -red) and starts collapsed to maintain a clean visual hierarchy.

All imports correctly use `@/lib/api-infra` to avoid reintroducing barrel dependencies that sprint 229 removed. The component integrates into the networking page alongside other infra panels.

### Files changed
- `apps/dashboard/src/lib/api-infra.ts` — added `getNginxDrift(name: string)` function and `NginxDrift` type union
- (new) `apps/dashboard/src/components/detail/nginx-config-panel.tsx` — the panel component with collapsible diff viewer
- (new) `apps/dashboard/src/components/detail/nginx-config-panel.test.tsx` — 14 test cases covering all status states
- `apps/dashboard/app/projects/[name]/networking/page.tsx` — integrated `NginxConfigPanel` into networking page

### Verification
- `npx nx run dashboard:test`: 183/183 pass
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
none

## Out of scope
- A "push config now" / "fix drift" button — deploy-time sync is sprint 232, and a manual push button is not part of this initiative.
- Editing vhost content from the dashboard.
- Changing any deploy or Ansible behavior.
