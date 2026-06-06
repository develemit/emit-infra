# Sprint 12 — Dashboard Build Number Display

**Difficulty:** 2

## Goal

Show the deployed build number on the project card (home page) and the
project detail page so you can see what's running at a glance.

## Reason

This is the payoff for sprints 09-10. The whole point of build numbers is
visibility — "what exactly is deployed right now?" The dashboard is where
you look first, so the version should be front and center. Without this,
build numbers exist in the registry and on the server but aren't surfaced
where you'd actually see them.

## Context

- Sprint 10 adds `buildNumber: string | null` to the `/projects/:name/status`
  API response and the `ProjectStatus` type.
- `apps/dashboard/src/components/project-card.tsx` — card on the home page.
  Shows name, domain, region, health badge, disk/memory meters. Uses
  `ProjectSummary` and `ProjectStatus` props.
- `apps/dashboard/src/components/detail/health-card.tsx` — detail page health
  section. Shows stat tiles for uptime, server type, region, IP, disk, memory,
  containers, and HTTP status. Uses a `StatTile` subcomponent.
- `apps/dashboard/src/lib/api.ts` — defines `ProjectStatus` type that the
  dashboard uses. Sprint 10 adds `buildNumber` here.
- The dashboard uses the `Icon` component from `@/components/icon` for
  inline icons (Lucide icon names).

## Tasks

1. [x] Verify that `ProjectStatus` in `apps/dashboard/src/lib/api.ts` includes
   `buildNumber: string | null` (added in sprint 10). If not present, add it.
2. [x] In `apps/dashboard/src/components/project-card.tsx`:
   - Show the build number next to the domain, e.g., `v42` in a muted
     mono-styled span. Only render when `status?.buildNumber` is truthy.
   - Keep it subtle — small text, same row as domain or near the badge.
3. [x] In `apps/dashboard/src/components/detail/health-card.tsx`:
   - Add a `StatTile` for the build number: icon `hash`, label "Build",
     value `status.buildNumber ?? '—'`.
   - Place it logically near the server info tiles (server type, region, IP).
4. [x] Typecheck the dashboard project.

## Files involved

- `apps/dashboard/src/lib/api.ts` — verify `buildNumber` in `ProjectStatus`
- `apps/dashboard/src/components/project-card.tsx` — add version display
- `apps/dashboard/src/components/detail/health-card.tsx` — add build stat tile

## Acceptance criteria

- [x] Project card on home page shows `v<N>` when `buildNumber` is present
- [x] Project card gracefully omits version when `buildNumber` is null
- [x] Detail page health card shows a Build stat tile with the build number
- [x] Typecheck clean

## Completed

**Date:** 2026-06-06

### Summary
Added build number display to both the project card and health detail card.
The project card shows `v<N>` in a muted mono span next to the domain,
conditionally rendered only when `buildNumber` is truthy. The health card adds
a `StatTile` with the `hash` icon in both desktop (4-col grid) and mobile
(2-col grid) layouts, displaying `buildNumber ?? '—'`.

### Files changed
- `apps/dashboard/src/components/project-card.tsx` — added `v{buildNumber}` span next to domain
- `apps/dashboard/src/components/detail/health-card.tsx` — added Build stat tile to desktop and mobile grids

### Verification
- Typecheck (dashboard): clean
- Code inspection: conditional rendering and fallback confirmed

### Follow-ups
none

## Out of scope

- Linking the build number to the git commit (would need the SHA too — future enhancement)
- Build history / version timeline on the detail page
- Any API changes (handled in sprint 10)
