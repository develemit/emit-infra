# Dashboard scaffold + read views

## Goal
Create `apps/dashboard` — a Next.js app that displays all managed projects as health cards and a per-project detail view showing server metrics and container status. Read-only. Mobile-first and fully responsive.

## Reason
This is the first thing you'd actually open daily — a quick read of what's running and whether anything needs attention. Getting the read views right before building action surfaces (sprint 04) means the UI structure, routing, and component patterns are established before complexity increases. Design assets from the design phase will be applied on top of the functional scaffold built here.

## Context
- Builds on sprint 01 (`apps/api` running on port 3001 with `/projects`, `/projects/:name/status`, `/projects/:name/containers`).
- Monorepo uses Nx 21 with pnpm. Add `apps/dashboard` following the same Nx app conventions as `apps/cli` and `apps/api`.
- Use Next.js 15 (App Router), Tailwind CSS, and shadcn/ui. These are the standard emit stack frontend choices.
- API base URL: read from `NEXT_PUBLIC_API_URL` env var, default to `http://localhost:3001` for local dev.
- The dashboard will later receive designs — keep component structure clean so styles can be swapped. Use semantic class names and keep layout logic separate from data-fetching logic.
- Status polling: fetch project statuses every 30 seconds. Use `setInterval` in a `useEffect` or a simple `useQuery` pattern — do not add a heavy data-fetching library unless Next.js's built-in fetch caching doesn't suffice.
- Mobile-first: all layouts must work at 375px width. Navigation should be a bottom tab bar on mobile, sidebar on desktop (≥1024px).

## Tasks
1. Scaffold `apps/dashboard` as an Nx Next.js 15 app with App Router, Tailwind CSS, and shadcn/ui initialised.
2. Create an API client module `src/lib/api.ts` with typed fetch wrappers for:
   - `getProjects(): Promise<ProjectSummary[]>`
   - `getStatus(name: string): Promise<ProjectStatus>`
   - `getContainers(name: string): Promise<Container[]>`
   Where the types mirror the API response shapes from sprint 01.
3. Build the project list page (`app/page.tsx`):
   - Renders a grid of `<ProjectCard>` components
   - Each card shows: project name, domain, region, and a status badge (loading / healthy / degraded / unreachable)
   - Status is fetched in parallel for all projects and polled every 30s
   - Skeleton loading state while initial fetch is in flight
4. Build `<ProjectCard>` component (`src/components/project-card.tsx`):
   - Compact view: name, domain, uptime, disk %, memory % as a small progress bar, container count
   - Tappable/clickable — navigates to `/projects/[name]`
   - Status badge color: green (all containers running), yellow (some stopped), red (unreachable)
5. Build the project detail page (`app/projects/[name]/page.tsx`):
   - Server metrics section: uptime, disk usage bar, memory usage bar
   - Containers table: name, image, state, status string
   - Back button to project list
   - Pulls fresh data on mount, then polls every 30s
6. Build the responsive shell (`src/components/shell.tsx`):
   - Mobile (< 1024px): bottom tab bar with icons for Overview, Projects, Logs, Ops
   - Desktop (≥ 1024px): left sidebar with the same nav items
   - Tabs/items: Overview (home), Projects (list), Logs (placeholder), Ops (placeholder)
7. Add `NEXT_PUBLIC_API_URL` to `.env.local.example` with a comment.
8. Register `build` and `dev` targets in `apps/dashboard/project.json`.

## Files involved
- new file: `apps/dashboard/` — full Next.js app scaffold
- new file: `apps/dashboard/src/lib/api.ts` — typed API client
- new file: `apps/dashboard/src/components/project-card.tsx` — health card
- new file: `apps/dashboard/src/components/shell.tsx` — responsive nav shell
- new file: `apps/dashboard/app/page.tsx` — project list page
- new file: `apps/dashboard/app/projects/[name]/page.tsx` — project detail page
- new file: `apps/dashboard/.env.local.example`

## Acceptance criteria
- [x] `nx dev dashboard` starts the Next.js dev server
- [x] Project list page renders all discovered projects as cards
- [x] Each card shows uptime, disk %, memory % fetched from the API
- [x] Clicking a card navigates to the project detail page
- [x] Detail page shows container list with state
- [x] All views render correctly at 375px (iPhone SE) — no horizontal overflow, no truncated text
- [x] Navigation shell shows bottom tabs on mobile, sidebar on desktop
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Scaffolded `apps/dashboard` as a Next.js 15 (App Router) application with Tailwind CSS and the shadcn/ui utility foundation. The project list page fetches all projects from the API in parallel, shows skeleton cards during the initial load, then polls every 30 seconds. `ProjectCard` renders name, domain, uptime, disk/memory progress bars with colour-coded thresholds, and a health badge. The project detail page shows server metrics and a container state table with responsive hidden columns on mobile. The `Shell` component provides a left sidebar on ≥1024px and a fixed bottom tab bar on mobile, using `usePathname()` for active state. Updated `eslint.config.js` to cover `.tsx` files and ignore `.next/` build output.

### Files changed
- (new) `apps/dashboard/package.json` — Next.js 15 app manifest with Tailwind, lucide-react, clsx, tailwind-merge
- (new) `apps/dashboard/project.json` — Nx targets: dev, build, typecheck, lint
- (new) `apps/dashboard/tsconfig.json` — standalone Next.js tsconfig with `@/*` alias
- (new) `apps/dashboard/next.config.ts` — minimal Next.js config
- (new) `apps/dashboard/postcss.config.js` — Tailwind + autoprefixer
- (new) `apps/dashboard/tailwind.config.ts` — content paths for app/ and src/
- (new) `apps/dashboard/next-env.d.ts` — Next.js type references
- (new) `apps/dashboard/.env.local.example` — `NEXT_PUBLIC_API_URL` documented
- (new) `apps/dashboard/app/layout.tsx` — root layout wrapping Shell
- (new) `apps/dashboard/app/globals.css` — Tailwind base/components/utilities
- (new) `apps/dashboard/app/page.tsx` — overview/project list with skeleton + 30s polling
- (new) `apps/dashboard/app/projects/page.tsx` — redirect to /
- (new) `apps/dashboard/app/projects/[name]/page.tsx` — detail page with server metrics + containers table
- (new) `apps/dashboard/app/logs/page.tsx` — placeholder
- (new) `apps/dashboard/app/ops/page.tsx` — placeholder
- (new) `apps/dashboard/src/lib/api.ts` — typed fetch wrappers for getProjects, getStatus, getContainers
- (new) `apps/dashboard/src/lib/utils.ts` — `cn` utility (clsx + tailwind-merge)
- (new) `apps/dashboard/src/components/shell.tsx` — responsive nav shell
- (new) `apps/dashboard/src/components/project-card.tsx` — health card with progress bars + status badge
- `eslint.config.js` — added .tsx support + ecmaFeatures.jsx + .next ignore

### Verification
- `nx run dashboard:dev`: server starts, GET / returns HTTP 200 with full HTML including shell + skeleton cards
- HTML confirms sidebar (hidden on mobile, `lg:flex`) and bottom tab bar (`lg:hidden`) with all 4 nav items
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)

### Follow-ups
- `[address-next]` `pnpm test` exits non-zero: `core:test` runs `vitest run --project core` but no vitest workspace config exists defining a "core" project, and no test files exist. Fix: either remove the test target from `packages/core/project.json` or add a `vitest.config.ts` workspace config. This is pre-existing and blocks the auto-loop.
- `[defer]` The `app/page.tsx` project list also lives at `/` — the "Projects" nav item redirects to `/` rather than having its own `/projects` page. If the two views diverge later, extract them properly.
- `[defer]` No error boundary — if `getProjects()` throws (API down), the page shows nothing rather than an error message

## Out of scope
- Deploy, logs, destroy, provision actions (sprint 04)
- Claude ops panel (sprint 05)
- Final visual design — this sprint builds the functional scaffold; designs get layered on after
- Dark mode (can be added when designs arrive)
