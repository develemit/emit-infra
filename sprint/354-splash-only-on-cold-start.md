# Stop the boot splash delaying every deep link
**Difficulty:** 3

## Goal
Opening any dashboard URL directly (a bookmark, a push-notification link during
an incident, a reload) shows the page as soon as it's ready, not after a fixed
~2 s splash animation.

## Reason
UI-18 (degraded) in `qa/ui-audit-2026-09-22.md`. The splash's "connecting to
tailnet" animation plays on every hard navigation with a 1.6 s minimum plus a
0.5 s fade. Its early-dismiss signal is only sent from the Overview page, so
every other route always waits the full minimum. The pages hit most urgently
(push-notification deep links to a project during an incident) are exactly the
ones that pay it.

## Context
- `apps/dashboard/src/components/splash-screen.tsx`: `SplashGate({ minDuration = 1600 })`
  (≈line 119); it listens for `window` event `emit:ready` to dismiss early
  (≈lines 138-145). The doc comment (≈line 114) describes the intended contract.
- The only dispatcher is `apps/dashboard/app/page.tsx:44`:
  `window.dispatchEvent(new Event('emit:ready'))`.
- Mounted from `app/layout.tsx`. `splash-screen.module.css` notes the splash has
  a self-contained palette so it looks right before hydration.
- The app is also a PWA (`/offline` fallback page), so the splash may exist for
  the installed-app cold start. Keep that experience.

### Decision to implement
Show the splash **only on a true cold start**: first load in a browsing session,
tracked with `sessionStorage`. Also dispatch `emit:ready` from the shared shell
once it has hydrated (`src/components/shell/shell.tsx`), not from one page, so
even a cold start ends as soon as the app is usable. Drop the fixed minimum on
non-cold loads. Keep a *short* minimum on cold start only if there's a
visual reason (a flash). If you keep one, state the value and why.

Alternative considered: remove the splash entirely. Rejected for now because
it's deliberate branding for the installed PWA and costs nothing once it's
limited to cold start. If you find it adds nothing even then, say so as a
follow-up rather than deleting it here.

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- Browser timing checks only via `tools/ui-audit/read-only-guard.mjs`; measure
  time-to-content on a deep link like `/projects/tastease/pipelines` before and
  after, and record both numbers.

## Tasks
1. Track cold start per session and skip the splash otherwise.
2. Dispatch `emit:ready` from the shell after hydration; keep `app/page.tsx`
   working (remove its dispatch if the shell's makes it redundant).
3. Measure deep-link time-to-content before/after.

## Files involved
- `apps/dashboard/src/components/splash-screen.tsx` — cold-start gating
- `apps/dashboard/src/components/shell/shell.tsx` — dispatch `emit:ready`
- `apps/dashboard/app/page.tsx` — remove the page-local dispatch if redundant
- new or extended test: `apps/dashboard/src/components/splash-screen.test.tsx`

## Acceptance criteria
- [ ] Second and later loads in a session show no splash — covered by a test
      that seeds `sessionStorage`
- [ ] A cold start dismisses on `emit:ready` from the shell, on any route —
      covered by a test
- [ ] Deep-link time-to-content measured before and after, both numbers in the
      Completed section
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Redesigning the splash.
- PWA/service-worker behaviour.
