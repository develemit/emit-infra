# Sprint 92 — CI page polish: auto-refresh + project links

> _Promoted from sprint-87 backlog items, 2026-06-27._

**Difficulty:** 2

## Goal

Two small UX gaps on the CI overview page (`/ci`): add 60-second auto-refresh so the page stays live without a manual reload, and make project names link to the project detail page.

## Context

The CI overview page is a Next.js client component at `apps/dashboard/app/ci/page.tsx`. It loads data once in a `useEffect` (no polling interval) and renders project names as plain `<div>` text — no navigation on click.

Two backlog items from sprint 87:
1. No auto-refresh — page shows a static snapshot; users must manually reload to see fresh CI results.
2. Project name column isn't linked — clicking a project name should go to `/projects/<name>` for drill-down to the health + history detail page.

## Tasks

1. Read `apps/dashboard/app/ci/page.tsx`.
2. Add a 60-second polling interval inside `useEffect`:
   - Re-run `load()` every 60 seconds using `setInterval`.
   - Clear the interval in the cleanup function (alongside the `cancelled = true`).
3. Wrap the project name in a `<Link>` (from `next/link`) pointing to `/projects/${encodeURIComponent(s.name)}`.
   - Apply this in **both** the desktop table row (`<div className="w-36 ...">`) and the mobile card (`<span className="text-[13px] ...">`) so both layouts benefit.
   - Style: keep the same text styling but add `hover:underline cursor-pointer` (or `hover:text-fg-link` if that token exists in the design system — check adjacent Link usages first).

## Files involved

- `apps/dashboard/app/ci/page.tsx` — the only file to change

## Acceptance criteria

- [x] Page re-fetches CI data every 60 seconds without full reload
- [x] Project name in the desktop table row links to `/projects/<name>`
- [x] Project name in the mobile card links to `/projects/<name>`
- [x] No TypeScript errors (`pnpm nx typecheck dashboard`)

## Completed

**Date:** 2026-06-27

### Summary
Added 60-second auto-refresh polling and project name links to the CI overview page. The `useEffect` now starts a `setInterval(load, 60_000)` after the initial load, with proper cleanup via `clearInterval`. Project names in both the desktop table row and mobile card are wrapped in `next/link` `<Link>` components pointing to `/projects/<name>`, styled with `hover:underline` to match the existing design system conventions.

### Files changed
- `apps/dashboard/app/ci/page.tsx` — added `Link` import, 60s polling interval in useEffect, wrapped project names in both desktop and mobile layouts

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- Code inspection: `setInterval` + `clearInterval` properly paired; `Link` hrefs use `encodeURIComponent`

### Follow-ups
- none
