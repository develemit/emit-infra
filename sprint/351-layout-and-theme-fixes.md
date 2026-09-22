# Fix the audit's layout, overflow and light-theme defects
**Difficulty:** 2

## Goal
Eight small layout defects from the UI audit are gone: an overflowing dropdown,
a truncated caveat, an unreadable light-theme chart, a clipped axis label, a
tiny touch target, a cramped textarea and two mobile wraps.

## Reason
UI-07 (broken), UI-13, UI-14, UI-15 (degraded), UI-27, UI-28, UI-29 (polish) in
`qa/ui-audit-2026-09-22.md`. Each is small, but two hide information at the
moment it matters. The Add Project list's lower entries can't be clicked, and
the provisioning review truncates "(no bucket set)" right before you create a
server.

## Context
Each item has its evidence screenshot named in the report. They live under
`.ui-audit/runs/2026-09-22/` (gitignored, local).

1. **UI-07 Add Project dropdown overflow** —
   `apps/dashboard/src/components/add-project-dropdown.tsx`. The panel (≈line 72)
   is `absolute … overflow-hidden`; an inner list (≈line 83) already has
   `max-h-[240px] overflow-auto`, yet with ~20 unregistered folders the audit saw
   rows painting over project cards and `elementFromPoint` hitting the card
   behind. Find which list is unbounded (the UNREGISTERED PROJECTS section may be
   a different element from the one at line 83) and bound it with its own scroll.
2. **UI-13 Provision review truncation** —
   `src/components/provision/step-review.tsx:21`: values are
   `max-w-[240px] truncate`. Let values wrap (`break-words`, no truncate) so
   `enabled · backup → (no bucket set)` is fully visible.
3. **UI-14 Incident timeline in light theme** —
   `src/components/fleet-incident-timeline.tsx:46` fills row bands with
   `var(--card)` / `var(--elev)`, yet the audit saw near-black bands with
   unreadable labels in light theme. **Find the real cause before changing
   anything.** Candidates: the SVG reading variables before `data-theme`
   flips, a hardcoded background elsewhere in the component or its wrapper, or
   label fill contrast. Check `apps/dashboard/app/globals.css` `:root[data-theme="light"]`.
4. **UI-15 Deploy Cadence first label clipped** —
   `src/components/detail/deploy-cadence-chart.tsx`: "Aug 24" renders "ug 24" in
   every theme and viewport. Add left padding to the axis/plot or anchor the
   first tick `start`.
5. **UI-27 Annotate button 13×13 px** — the per-incident Annotate icon button in
   the reliability page's incident panel (`src/components/detail/incident-panel*.tsx`).
   Pad it to at least 24×24 hit area, matching the adjacent export button (29×28).
6. **UI-28 Required env keys textarea** — project settings panel
   (`src/components/detail/project-settings-panel*.tsx`): fixed 3 rows,
   `resize-none`, with 37 keys for tastease. Auto-grow to a sensible max
   (e.g. 12 rows) and scroll beyond it.
7. **UI-29 cx42 spec wraps mid-unit on mobile** — provisioning step 2
   (`src/components/provision/step-infrastructure.tsx`): `160` / `GB` split at 390px.
   `whitespace-nowrap` on each spec fragment.

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- Verify visually with before/after screenshots taken **only** through
  `tools/ui-audit/read-only-guard.mjs` (`newGuardedContext` + `assertGuardActive`);
  save them under `.ui-audit/` (gitignored). Theme: set `localStorage['ec-theme']`
  in an init script. Wait ≥2.5s after navigation (boot splash).

## Tasks
1. Fix each of the seven items above.
2. Take a guarded after-screenshot of each, in the dimension where it was found.

## Files involved
- `apps/dashboard/src/components/add-project-dropdown.tsx`
- `apps/dashboard/src/components/provision/step-review.tsx`, `step-infrastructure.tsx`
- `apps/dashboard/src/components/fleet-incident-timeline.tsx` (and/or `app/globals.css`)
- `apps/dashboard/src/components/detail/deploy-cadence-chart.tsx`
- `apps/dashboard/src/components/detail/incident-panel*.tsx`, `project-settings-panel*.tsx`

## Acceptance criteria
- [ ] Every Add Project entry is reachable by scrolling inside the dropdown —
      covered by a component test asserting the list container is scroll-bounded,
      plus a guarded screenshot
- [ ] Provision review shows full values (no truncation class) — covered by a test
- [ ] Incident timeline labels readable in light theme; root cause named in the
      Completed section; guarded light screenshot
- [ ] First cadence-chart label fully visible; guarded screenshot
- [ ] Annotate hit area ≥24×24, env-keys textarea grows, cx42 spec doesn't split
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- The "N" circle over the Tailscale pill: it's the Next.js dev indicator, not our UI.
- Any redesign beyond these specific fixes.
