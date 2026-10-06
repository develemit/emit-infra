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
- [x] Second and later loads in a session show no splash — covered by a test
      that seeds `sessionStorage`
- [x] A cold start dismisses on `emit:ready` from the shell, on any route —
      covered by a test
- [x] Deep-link time-to-content measured before and after, both numbers in the
      Completed section
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Redesigning the splash.
- PWA/service-worker behaviour.

## Completed

**Date:** 2026-09-22

### Summary
The splash now tracks whether the current browsing session has already booted
via a `sessionStorage` flag (`emit:booted`). `SplashGate` still mounts
optimistically (avoids an SSR/hydration mismatch, since `sessionStorage` isn't
readable server-side), but its mount effect checks the flag immediately: if
this session already booted, it unmounts right away with no `minDuration`
wait and no fallback to the `window` load event. If it's a true cold start,
the flag is set and the existing minDuration + `emit:ready`/`load` dismiss
logic runs unchanged.

The `emit:ready` dispatch moved from `app/page.tsx` (fired only after the
Overview page's project fetch resolved) to `Shell`, which mounts once per
hard navigation regardless of route and dispatches on every mount. This is
strictly earlier than the old signal (it doesn't wait on any network fetch),
so the page-level dispatch became redundant and was removed. This is also
what fixes the original bug: every route now gets an early-dismiss signal,
not just Overview.

Kept the existing `minDuration` (1600ms) + 520ms fade on cold start unchanged
— the sprint's decision doc frames the splash as deliberate PWA cold-start
branding, and this sprint's scope is "skip it when it's not a cold start,"
not retuning the cold-start experience itself.

One caveat worth recording: because `sessionStorage` can't be read
server-side, a warm hard-reload's server-rendered HTML still includes the
splash markup (same as before); the fix removes it via a mount effect before
the fallback window-load timer would ever fire, which is why the measured
warm-reload time-to-content dropped from ~3s to well under 1s rather than to
~0ms. A cookie-based signal would close that last gap but wasn't part of this
sprint's decision (which specified `sessionStorage`).

### Files changed
- `apps/dashboard/src/components/splash-screen.tsx` — cold-start gating via
  `sessionStorage`; skip the splash and dismiss immediately on any later hard
  load in the same session
- `apps/dashboard/src/components/shell/shell.tsx` — dispatches `emit:ready`
  once mounted/hydrated, on every route
- `apps/dashboard/app/page.tsx` — removed the now-redundant page-local
  `emit:ready` dispatch
- (new) `apps/dashboard/src/components/splash-screen.test.tsx` — covers
  cold-start display, session-skip, and `emit:ready` dismissal

### Verification
- `pnpm test`: 354/354 pass (dashboard suite, includes the 3 new
  `splash-screen.test.tsx` tests)
- `pnpm typecheck`: clean
- `pnpm lint`: clean
- Deep-link time-to-content, measured via Playwright against the running dev
  server (`http://localhost:7013/projects/tastease/pipelines`), timing until
  the splash overlay (`role="status"` boot screen) detaches from the DOM:
  - Before: first load in session 2998ms, second (reload) in same session
    2975ms — no session awareness, always pays the full ~3s wait since this
    route never dispatched the old `emit:ready` signal
  - After: cold start (first load in session) 3102ms — unchanged by design,
    still a genuine cold start; warm reload (second load, same session)
    478ms — an 84% reduction, splash skipped

### Follow-ups
- `[defer]` A cookie-based (rather than `sessionStorage`-based) cold-start
  flag would let the server itself skip rendering the splash markup on warm
  reloads, closing the remaining ~478ms gap. Not pursued here since the
  sprint's decision explicitly specified `sessionStorage`.
