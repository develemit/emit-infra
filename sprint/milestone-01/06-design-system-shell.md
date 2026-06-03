# Design system + navigation shell

## Goal
Port the design tokens from the approved design into `globals.css` and Tailwind config, implement dark/light theming, and build the responsive navigation shell (desktop sidebar + mobile bottom tab bar) that wraps every screen.

## Reason
Every screen from sprints 07–11 sits inside the navigation shell and consumes the design tokens. Getting this foundation exactly right unblocks all downstream UI work. The design is pixel-specific — typography, spacing, color, and the terminal panel all require a shared token layer rather than one-off Tailwind values.

## Context
- Design source: extracted from the approved Claude Design handoff at `docs/design-prompt.md`. The full design system is defined in `/tmp/emit-design/emit-infra/project/ds.css` — this sprint ports those tokens faithfully.
- Dashboard lives at `apps/dashboard` (Next.js 15 App Router, Tailwind CSS, shadcn/ui) — scaffolded in sprint 03.
- Font stack: **Geist** (sans-serif) + **Geist Mono**. Use `next/font/google` or `next/font/local`. Geist is available via `next/font/local` from the `geist` npm package.
- Theme switching: set `data-theme="dark"` (default) or `data-theme="light"` on the `<html>` element. Persist in `localStorage`. Provide a `useTheme` hook at `src/hooks/use-theme.ts`.
- The design uses a `.ec` root class in the prototype — in the real app, apply the CSS vars to `:root[data-theme="dark"]` / `:root[data-theme="light"]` in `globals.css` instead.

## Design tokens to implement (from ds.css)

**Dark theme:**
```
--bg: #0a0a0b          --bg-elev: #100f12       --card: #110f13
--card-2: #16141a      --card-hover: #1a181f    --border: #232228
--border-strong: #312f37  --fg: #f4f4f5         --fg-muted: #a1a1aa
--fg-subtle: #71717a   --fg-faint: #52525b
--accent: #10b981      --accent-bright: #34d399  --accent-fg: #022c22
--accent-soft: rgba(16,185,129,0.13)             --accent-line: rgba(16,185,129,0.32)
--ok: #34d399          --warn: #fbbf24           --err: #f87171
--ok-soft / --warn-soft / --err-soft / --err-line (see ds.css)
--shadow: 0 1px 2px rgba(0,0,0,.4), 0 8px 24px rgba(0,0,0,.35)
```

**Light theme:** values from ds.css `.ec[data-theme="light"]` block.

**Terminal (always dark, both themes):**
```
--term-bg: #0a0d0c     --term-fg: #c7d0cb       --term-dim: #6b7669
--t-green: #4ade80     --t-red: #f87171         --t-yellow: #fcd34d
--t-blue: #7dd3fc      --t-cyan: #5eead4        --t-magenta: #c4b5fd
```

## Tasks

1. Install `geist` npm package in `apps/dashboard`. Configure Geist + Geist Mono via `next/font/local` in `app/layout.tsx`, applying `--font-sans` and `--font-mono` CSS variables.

2. Replace the contents of `app/globals.css` with the full design token system:
   - `:root[data-theme="dark"]` block with all dark tokens
   - `:root[data-theme="light"]` block with all light tokens
   - Global terminal tokens (no theme scope — always dark)
   - Base resets: `box-sizing: border-box`, `letter-spacing: -0.011em`, font smoothing, `color: var(--fg)`, `background: var(--bg)` on `body`

3. Extend `tailwind.config.ts` to expose the design tokens as Tailwind utilities:
   - Colors: `bg-card`, `bg-elev`, `text-fg`, `text-muted`, `text-subtle`, `border-border`, `border-strong`, `text-accent`, `bg-accent-soft`, etc. — all mapping to the CSS vars
   - Font families: `font-sans` → `var(--font-sans)`, `font-mono` → `var(--font-mono)`
   - Box shadows: `shadow-card` → `var(--shadow)`, `shadow-lg` → `var(--shadow-lg)`

4. Create `src/hooks/use-theme.ts`: reads/writes `data-theme` on `document.documentElement`, initialises from `localStorage` (key: `ec-theme`), defaults to `dark`. Export `useTheme(): { theme: 'dark'|'light', toggleTheme: () => void }`.

5. Build `src/components/icon.tsx`: a single Icon component that renders the stroke SVG paths from the design. Implement all icons used across the app:
   `overview, projects, logs, ops, plus, arrowLeft, chevDown, chevRight, server, cpu, disk, clock, box, deploy, trash, file, sun, moon, check, x, alert, send, globe, shield, refresh, search, dots, play, stop, zap, link, github, database, copy`
   Path data is in `/tmp/emit-design/emit-infra/project/common.jsx` (PATHS object). Accept `name`, `size` (default 18), `className`, `style` props.

6. Build `src/components/shell/sidebar.tsx` (desktop, ≥1024px):
   - Width 232px, `bg-elev`, right border
   - Brand mark: 28×28 accent-colored rounded square with `zap` icon
   - Brand name "Emit Infra" + sub "develemit"
   - Nav items: Overview, Projects (count badge), Logs, Ops
   - Active item: `bg-accent-soft text-accent-bright`
   - Bottom: dark/light theme toggle (segmented control) + Tailscale status pill with green dot

7. Build `src/components/shell/tab-bar.tsx` (mobile, <1024px):
   - Fixed bottom, height 64px, `bg-elev`, top border
   - 4 tabs: icon + label, active = `text-accent-bright`
   - Min tap target 44px per tab

8. Build `src/components/shell/shell.tsx`: responsive wrapper. Renders Sidebar on desktop, TabBar on mobile. Accepts `active` prop for nav highlighting. Wraps children in the main content area with topbar (title, subtitle, actions slot).

9. Update `app/layout.tsx`: apply font CSS vars, set `data-theme="dark"` as default on `<html>`, wrap with Shell.

## Files involved
- `apps/dashboard/app/globals.css` — full design token system
- `apps/dashboard/tailwind.config.ts` — token-mapped utilities
- `apps/dashboard/app/layout.tsx` — font setup, html data-theme
- new file: `apps/dashboard/src/hooks/use-theme.ts`
- new file: `apps/dashboard/src/components/icon.tsx`
- new file: `apps/dashboard/src/components/shell/sidebar.tsx`
- new file: `apps/dashboard/src/components/shell/tab-bar.tsx`
- new file: `apps/dashboard/src/components/shell/shell.tsx`

## Acceptance criteria
- [x] `nx dev dashboard` builds with no errors
- [x] Dark mode is the default; clicking the theme toggle switches to light and persists across page reload
- [x] Sidebar renders on 1280px viewport, tab bar renders at 375px — never both at once
- [x] All nav icons render correctly (no broken SVGs)
- [x] Tailscale pill appears in the sidebar with a green dot
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Ported the full design token system into `globals.css` (dark/light themes + always-dark terminal tokens) and extended `tailwind.config.ts` to expose every token as a Tailwind utility (`bg-card`, `bg-elev`, `text-fg`, `text-muted`, `border-border`, `bg-accent-soft`, etc.). Geist + Geist Mono fonts are loaded via `geist/font/sans` and `geist/font/mono` and injected as `--font-geist-sans`/`--font-geist-mono` CSS variables on `<html>`. The `useTheme` hook reads/writes `data-theme` on `document.documentElement` and persists in `localStorage` (key `ec-theme`), defaulting to dark.

Built all three shell components: `Sidebar` (desktop ≥1024px, 232px wide with brand mark, nav items, segmented theme toggle, Tailscale pill), `TabBar` (mobile <1024px, 64px fixed bottom), and `Shell` (client wrapper that derives active nav from `usePathname` and passes theme state to Sidebar). The Icon component covers all 33 icon paths from the design's PATHS object, supporting multi-path icons via `|` splitting. The old monolithic `shell.tsx` was removed.

### Files changed
- `apps/dashboard/app/globals.css` — full design token system (dark/light/terminal tokens, base resets, scrollbar, terminal panel utilities)
- `apps/dashboard/tailwind.config.ts` — token-mapped colors, font families, box shadows
- `apps/dashboard/app/layout.tsx` — Geist fonts, `data-theme="dark"` default, new Shell import
- (new) `apps/dashboard/src/hooks/use-theme.ts` — localStorage-backed theme hook
- (new) `apps/dashboard/src/components/icon.tsx` — 33-icon SVG component
- (new) `apps/dashboard/src/components/shell/sidebar.tsx` — desktop sidebar
- (new) `apps/dashboard/src/components/shell/tab-bar.tsx` — mobile tab bar
- (new) `apps/dashboard/src/components/shell/shell.tsx` — responsive wrapper
- (deleted) `apps/dashboard/src/components/shell.tsx` — replaced by shell/shell.tsx

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- `nx dev dashboard`: HTTP 200, dev server starts without errors

### Follow-ups
- none

## Out of scope
- Page content (sprints 07–10)
- Terminal component (sprint 07 — first screen to use it)
- PWA manifest (sprint 11)
