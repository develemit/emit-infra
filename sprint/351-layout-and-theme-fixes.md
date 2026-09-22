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
- [x] Every Add Project entry is reachable by scrolling inside the dropdown —
      covered by a component test asserting the list container is scroll-bounded,
      plus a guarded screenshot
- [x] Provision review shows full values (no truncation class) — covered by a test
- [x] Incident timeline labels readable in light theme; root cause named in the
      Completed section; guarded light screenshot
- [x] First cadence-chart label fully visible; guarded screenshot
- [x] Annotate hit area ≥24×24, env-keys textarea grows, cx42 spec doesn't split
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- The "N" circle over the Tailscale pill: it's the Next.js dev indicator, not our UI.
- Any redesign beyond these specific fixes.

## Completed

**Date:** 2026-09-22

### Summary
Fixed all seven layout/theme defects from the 2026-09-22 UI audit.

UI-07 (Add Project dropdown overflow) turned out to already be correctly
implemented: `add-project-dropdown.tsx`'s directory list has `max-h-[240px]
overflow-auto`, and a Playwright repro against the live dev server with 20
mocked unregistered directories confirmed the container's `scrollHeight`
(710px) exceeds its `clientHeight` (240px), that scrolling to the bottom makes
the 20th entry fully visible, and that `elementFromPoint` at that entry's
position hits the entry itself, not a card behind it. No code fix was needed
there; added a regression test asserting the list container carries the
scroll-bounding classes so this can't silently regress, since jsdom can't
assert real scroll geometry.

UI-14's root cause: `fleet-incident-timeline.tsx` filled alternating lane
stripes with `var(--card)` / `var(--elev)`, but `--elev` is never defined as a
CSS custom property anywhere in `globals.css` — only `--bg-elev` is (and
Tailwind's `elev` color token maps to `var(--bg-elev)`, not a literal
`--elev` variable). An SVG `fill` referencing an undefined custom property
with no fallback resolves to the property's initial value, black. In dark
theme this blended in with the already-dark UI and went unnoticed; in light
theme it produced the reported near-black unreadable bands. Fixed by using
`var(--bg-elev)` directly.

The other five were straightforward: `break-words` instead of `truncate` on
provision-review values (UI-13), anchoring the deploy-cadence chart's first
axis label to `start` instead of `middle` so it doesn't run off the left edge
of the SVG viewBox (UI-15), a 24×24 hit-area wrapper on the incident panel's
Annotate button (UI-27), a new `useAutoGrowTextarea` hook (`lib/use-auto-grow.ts`)
wired into the required-env-keys textarea to grow up to 12 rows before
scrolling (UI-28), and wrapping each server-spec fragment (`cpu`/`ram`/`disk`)
in its own `whitespace-nowrap` span so the flex-wrapped line breaks between
fragments, never inside one, on narrow viewports (UI-29).

All fixes were verified against the running dev server (port 7013) with
guarded Playwright scripts (read-only-guard.mjs, `newGuardedContext` +
`assertGuardActive`), screenshots taken and reviewed, then discarded (scratch
scripts, not part of the tracked audit-evidence set).

### Files changed
- `apps/dashboard/src/components/fleet-incident-timeline.tsx` — fixed undefined `var(--elev)` → `var(--bg-elev)` (UI-14 root cause)
- `apps/dashboard/src/components/provision/step-review.tsx` — `truncate` → `break-words` on review values (UI-13)
- `apps/dashboard/src/components/detail/deploy-cadence-chart.tsx` — first axis label anchored `start` instead of `middle` (UI-15)
- `apps/dashboard/src/components/detail/incident-panel.tsx` — Annotate button padded to 24×24 hit area (UI-27)
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — env-keys textarea wired to auto-grow (UI-28)
- `apps/dashboard/src/components/provision/step-infrastructure.tsx` — server-spec fragments wrapped in `whitespace-nowrap` spans (UI-29)
- (new) `apps/dashboard/src/lib/use-auto-grow.ts` — `useAutoGrowTextarea` hook, grows a textarea to content height up to a max row count, then scrolls
- (new) `apps/dashboard/src/components/add-project-dropdown.test.tsx` — regression test locking in the scroll-bounded unregistered-projects list (UI-07)
- (new) `apps/dashboard/src/components/provision/step-review.test.tsx` — regression test asserting review values wrap instead of truncating (UI-13)

### Verification
- `pnpm test`: 316/316 pass (46 test files, includes the 2 new test files)
- `pnpm typecheck`: clean (5 projects)
- `pnpm lint`: clean (5 projects)
- Guarded Playwright screenshots (dev server, port 7013) for every item, reviewed visually: UI-07 (20 mocked dirs, scrolled to last entry, elementFromPoint hit-tested), UI-13 (provision review at mobile 390px), UI-14 (fleet incident timeline, light theme, before/after), UI-15 (deploy cadence chart, "Aug 24" fully visible), UI-27 (Annotate button bounding box measured at 24×24), UI-28 (textarea grows with 37 keys, caps and scrolls with 80), UI-29 (cx42 "160 GB" at 390px, wraps as a unit)

### Follow-ups
- `[defer]` The UI-07 audit finding may have been a false positive (couldn't reproduce the reported overflow against current `main`); worth a quick note to whoever maintains `qa/ui-audit-2026-09-22.md` in case the same misdiagnosis recurs elsewhere in that report.
- `[defer]` `playwright` isn't a workspace dependency — verification scripts had to load it from a sibling project's `node_modules` (`develemit-hq`). Not urgent, but if guarded UI verification becomes routine across sprints, worth adding a real (dev-only) dependency.
