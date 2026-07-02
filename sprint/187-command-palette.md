# Build a Cmd+K command palette for fleet-wide navigation
**Difficulty:** 4

## Goal
Pressing Cmd+K (Ctrl+K on non-Mac) anywhere in the dashboard opens a palette that fuzzy-filters across all projects and their sub-pages plus top-level pages, and Enter navigates there.

## Reason
The dashboard now spans 20+ pages across multiple projects (overview + six sub-pages each, plus health/ops/ci/logs/provision). Every navigation currently goes through the home list or the overview's summary cards. A command palette makes fleet context-switching instant and is the highest cool-per-effort item from the 2026-07-02 scan.

## Context
- Next.js 15 App Router, client components with `'use client'`. Router navigation via `useRouter()` from `next/navigation`.
- Project list is available from `getProjects()` in `@/lib/api` (returns `ProjectSummary[]` with `config.name`). Fetch it lazily when the palette first opens, not on every page load.
- Global mount point: `apps/dashboard/app/layout.tsx` — read it first; if it's a server component, create a small client wrapper component and render it inside the body.
- Icon set: `@/components/icon` (`Icon name="..."`). Sub-page icons used elsewhere: globe (networking), database (storage), zap (pipelines), shield (reliability), lock (data), settings (admin).
- Static entries: Home `/`, Health `/health`, Ops `/ops`, CI `/ci`, Logs `/logs`, Provision `/provision`. Dynamic entries per project: overview `/projects/<name>` plus the six sub-pages.
- Styling conventions: `bg-card`, `border-border`, `text-fg`/`text-subtle`, `rounded-xl`, font-mono for identifiers. Overlay: fixed inset with backdrop, palette centered near top.
- Keep the palette in ONE new file ≤300 lines; extract a `use-command-palette.ts` hook or a `palette-items.ts` helper if it grows past that (per repo convention).
- No new dependencies — write simple subsequence/substring fuzzy matching inline.

## Tasks
1. Read `apps/dashboard/app/layout.tsx` to determine mounting strategy.
2. Create `apps/dashboard/src/components/command-palette.tsx` (client): global `keydown` listener (Cmd/Ctrl+K toggles, Escape closes) with proper cleanup; input autofocused on open; list of matched items; ArrowUp/ArrowDown selection; Enter navigates via `router.push` and closes.
3. Build the item list: static pages + per-project entries from `getProjects()` (fetched on first open, cached in state). Item label format: `project-name → Storage` etc.
4. Fuzzy filter: case-insensitive subsequence match, rank substring matches above subsequence matches.
5. Accessibility: `role="dialog"` + `aria-modal`, input `aria-label`, `role="option"`/`aria-selected` on items, focus returns to previous element on close.
6. Mount it in the root layout so it works on every page.
7. Typecheck.

## Files involved
- new file: `apps/dashboard/src/components/command-palette.tsx`
- `apps/dashboard/app/layout.tsx` — mount the palette (or a client wrapper)
- possibly new file: `apps/dashboard/src/lib/use-command-palette.ts` if the component nears 300 lines

## Acceptance criteria
- [x] Cmd/Ctrl+K opens the palette from any page; Escape closes; focus managed correctly
- [x] Typing filters projects and pages; arrows + Enter navigate
- [x] Works for project names needing URI encoding
- [x] Keydown listener cleaned up on unmount
- [x] `npx nx run dashboard:typecheck` clean

## Out of scope
- Actions in the palette (restart container, trigger backup) — navigation only for now
- Recent/frecency ranking

## Completed

**Date:** 2026-07-02

### Summary
New `CommandPalette` client component mounted directly in the root layout (server component importing a `'use client'` component — no wrapper needed). Global `keydown` listener toggles on Cmd/Ctrl+K (`preventDefault` to beat browser search) and closes on Escape (functional `setOpen(o => o ? false : o)` so a closed palette never re-renders or swallows Escape semantics elsewhere); listener removed on unmount. On open: previous `document.activeElement` is captured and restored via the effect cleanup when the palette closes, query/selection reset, input focused via `requestAnimationFrame`. Project list fetched lazily on first open only (`projectItems === null` guard), cached in state; fetch failure degrades to static items.

Item construction and fuzzy matching live in a separate `palette-items.ts` helper (keeps the component at ~140 lines and the logic unit-testable): six static pages + seven entries per project (overview + six sub-pages, labels `name → Storage` style, hrefs built with `encodeURIComponent`). Filtering is case-insensitive with substring matches ranked above subsequence matches. Accessibility: `role="dialog"` + `aria-modal`, labelled input, `role="listbox"`/`role="option"` + `aria-selected`, selected option kept in view via `scrollIntoView({ block: 'nearest' })`. Backdrop click and option click also close/navigate; mouse hover moves selection.

### Files changed
- (new) `apps/dashboard/src/components/command-palette.tsx` — palette component: shortcut handling, focus management, list rendering
- (new) `apps/dashboard/src/lib/palette-items.ts` — static/dynamic item builders + substring-over-subsequence fuzzy filter
- `apps/dashboard/app/layout.tsx` — mount `<CommandPalette />` inside ToastProvider

### Verification
- `npx nx run dashboard:typecheck`: clean
- Code inspection: keydown listener cleanup returned from effect; `encodeURIComponent` on all project hrefs; Escape/backdrop/navigate all close and restore focus

### Follow-ups
- `[defer]` palette-items `filterItems` is pure and would be a cheap first target when dashboard component tests land (sprint 194)
