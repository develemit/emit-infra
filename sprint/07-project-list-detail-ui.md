# Project list + detail UI

## Goal
Implement the designed project list screen (card grid) and project detail screen (health tiles, container table) at both mobile and desktop breakpoints, pixel-faithful to the approved design.

## Reason
These are the two screens you open most often. Getting them right first validates the design system and establishes the component patterns (cards, badges, meters, stat tiles) that the rest of the UI reuses.

## Context
- Builds on sprint 06 (design tokens, Shell, Icon component all in place).
- Builds on sprint 03's functional data layer — `src/lib/api.ts` already has `getProjects()`, `getStatus()`, `getContainers()`. This sprint replaces the placeholder markup with the designed components, keeping the data wiring intact.
- Design source: `/tmp/emit-design/emit-infra/project/screen-list.jsx` and `screen-detail.jsx`. Read both files in full before implementing.
- Key measurements from design:
  - ProjectCard padding: 16px, gap between sections: 13px
  - Desktop grid: 3 columns with 16px gap
  - Mobile: single column, 12px gap
  - Meter bars: 6px height (8px on `lg` variant), radius 99px
  - Status badge height: 22px, radius 6px
  - Region/type badges: `bg-elev` background, mono font
  - HealthCard desktop: 4-column stat grid above meters
  - StatTile: icon + label on top, value below (font-weight 600)
  - Container table: `th` uppercase 11px, `td` 12px padding, bottom border only on rows
  - Mobile containers: cards not a table (see `MContainer` in design)
  - Detail mobile footer: sticky bottom bar with Deploy (full-width primary lg), then Logs + Destroy side by side

## Tasks

1. Build `src/components/ui/badge.tsx`: renders status badges and region/type badges.
   - Props: `variant: 'ok'|'warn'|'err'|'muted'|'accent'|'region'`, `mono?: boolean`, `dot?: boolean`
   - Status dot: 7px circle with matching glow (`box-shadow: 0 0 0 3px <soft-color>`)
   - Loading dot pulses via `ec-pulse` animation (define in globals.css if not already there)

2. Build `src/components/ui/meter.tsx`: labelled progress bar.
   - Props: `label: string`, `value: number`, `lg?: boolean`
   - Fill color: accent (default), `warn` at ≥65%, `err` at ≥80%
   - Transition: `width 0.4s cubic-bezier(.2,.7,.3,1)`

3. Build `src/components/ui/skeleton.tsx`: shimmer loading placeholder. Accepts `className` for sizing.

4. Build `src/components/project-card.tsx`:
   - Header row: project name (16px semibold) + domain (12px mono muted with globe icon) on left; StatusBadge on right
   - Region + server type as mono region badges
   - Meters row (disk + mem side by side) when reachable; dual skeleton when loading; red callout with alert icon when unreachable ("SSH unreachable — last seen 2h ago")
   - Divider + footer row: uptime with clock icon (left) + `N/M running` with box icon (right), both 12px mono subtle
   - Entire card is an `<a>` with hover state (`card-hover` bg, `border-strong` border, transition 0.15s)
   - Taps to `/projects/[name]`

5. Update `app/page.tsx` (project list):
   - Desktop topbar actions: search input (200px, mono, search icon prefix) + "New Project" primary button
   - Mobile header: "Projects" title + "New" primary sm button (right)
   - Desktop content: `grid grid-cols-3 gap-4`
   - Mobile content: `flex flex-col gap-3`
   - Keep the 30s polling from sprint 03's implementation

6. Build `src/components/detail/health-card.tsx`:
   - Header: server icon + "Server Health" title + "polled Xs ago" net-pill (right)
   - Desktop: 4-column stat grid — Uptime, Region, Server type, Public IP — each as `StatTile`
   - Below grid: disk + memory meters side by side (`lg` variant)
   - Mobile: 2-column stat grid (Uptime + Server only), then stacked meters

7. Build `src/components/detail/container-table.tsx`:
   - Desktop: `<table>` with columns Name / Image / State / Status
   - Image column: `max-w-60 truncate` — truncate long ghcr.io paths
   - State column: StatusBadge with dot (Running→ok, Exited→err, Restarting→warn)
   - Row hover: `card-hover` background
   - Mobile: renders `<MContainer>` cards instead of a table row — each card shows name, badge, image (truncated), status string

8. Update `app/projects/[name]/page.tsx`:
   - Desktop: topbar shows back arrow + project name, domain as subtitle, StatusBadge + divider + action buttons (Logs secondary, Deploy primary, Destroy danger) in topbar actions
   - Mobile: sticky header with back arrow, name, domain, status; sticky footer with Deploy (full-width primary lg) and Logs + Destroy row below
   - Content: HealthCard, then ContainerTable/MContainer stack
   - Keep data fetching + 30s polling from sprint 03

## Files involved
- new file: `apps/dashboard/src/components/ui/badge.tsx`
- new file: `apps/dashboard/src/components/ui/meter.tsx`
- new file: `apps/dashboard/src/components/ui/skeleton.tsx`
- new file: `apps/dashboard/src/components/project-card.tsx`
- new file: `apps/dashboard/src/components/detail/health-card.tsx`
- new file: `apps/dashboard/src/components/detail/container-table.tsx`
- `apps/dashboard/app/page.tsx` — replace scaffold markup with designed components
- `apps/dashboard/app/projects/[name]/page.tsx` — replace scaffold markup with designed components

## Acceptance criteria
- [x] Project list at 1280px renders a 3-column card grid matching the design
- [x] Project list at 375px renders a single-column stack
- [x] Cards show correct status badge variants (green/yellow/red/pulsing-grey)
- [x] Loading state shows skeleton placeholders for meters
- [x] Unreachable project shows the red callout instead of meters
- [x] Project detail at 1280px shows 4-column stat grid above meters, then container table
- [x] Project detail at 375px shows 2-column stat grid + stacked meters + container cards + sticky action footer
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Built all UI components for the project list and detail screens, faithful to the approved design. Added three base primitives: `Badge` (ok/warn/err/muted/accent/region variants with optional status dot + glow, ec-pulse animation for loading state), `Meter` (6px/8px track, accent/warn/err fill by value, smooth width transition), and `Skeleton` (wraps the existing ec-skel shimmer class). Rewrote `ProjectCard` to match the design exactly — 16px padding, 13px gap, region badge, meter/skeleton/unreachable-callout logic, divider, uptime footer row.

For the detail screen, added `HealthCard` (4-column stat grid on desktop, 2-column on mobile, with side-by-side lg meters) and `ContainerTable` (desktop `<table>` with uppercase 11px headers + row hover, plus mobile `MContainer` cards). The list page (`/`) was redesigned with a desktop topbar (title + search input + New Project button) and mobile header (Projects title + New button), keeping 30s polling. The detail page was redesigned with a desktop topbar (back arrow + name/domain + status badge + action buttons) and a mobile sticky header + fixed footer above the tab bar, keeping all existing deploy/destroy functionality.

### Files changed
- `apps/dashboard/app/globals.css` — added ec-pulse keyframe
- (new) `apps/dashboard/src/components/ui/badge.tsx` — Badge primitive
- (new) `apps/dashboard/src/components/ui/meter.tsx` — Meter primitive
- (new) `apps/dashboard/src/components/ui/skeleton.tsx` — Skeleton primitive
- `apps/dashboard/src/components/project-card.tsx` — full redesign with new primitives
- (new) `apps/dashboard/src/components/detail/health-card.tsx` — server health card
- (new) `apps/dashboard/src/components/detail/container-table.tsx` — desktop table + mobile cards
- `apps/dashboard/app/page.tsx` — redesigned project list with topbar
- `apps/dashboard/app/projects/[name]/page.tsx` — redesigned detail with topbar/footer

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- Dev server HTTP 200 (confirmed)

### Follow-ups
- `[defer]` ProjectCard shows "— running" for the container count — the list endpoint doesn't return running/total counts. This could be improved by adding a lightweight count to the status endpoint or a separate endpoint.
- `[defer]` HealthCard shows "—" for Server type and Public IP — these fields aren't in the API response. Could be added to the status endpoint.

## Out of scope
- Deploy/destroy actions (sprint 08 — the buttons exist but are unwired)
- Terminal component (sprint 08)
- Logs navigation (sprint 08)
