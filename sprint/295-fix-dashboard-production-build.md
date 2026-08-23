# Fix the dashboard production build's /404 prerender failure
**Difficulty:** 3

> _Promoted from backlog: sprint-04 follow-up and the 2026-08-21 infra finding._

## Goal
`pnpm nx build dashboard` succeeds. The dashboard can be built for production
again, rather than being the one project in the repo whose build is known-broken.

## Reason
`nx build dashboard` fails:

```
Error: <Html> should not be imported outside of pages/_document.
Error occurred prerendering page "/404".
Export encountered an error on /_error: /404, exiting the build.
```

This was first filed at sprint 04 (2026-06-03) as an upstream Next.js bug and
marked `[hold]`. It has sat for roughly two and a half months and **still fails
today** — verified 2026-08-21.

Two things were ruled out during that verification:
- It is **not** caused by recent work. It reproduces identically at `f5c2a04`,
  the pre-session commit, and no sprint from 282–292 touched `apps/dashboard`.
- It is **not** the `TURBOPACK=1` env trap documented elsewhere in this repo. It
  fails with `TURBOPACK` explicitly unset.

Everything else is green — `pnpm typecheck`, `pnpm test`, and `pnpm test:hooks`
all pass. Only the production build is broken, which is why it stayed invisible:
the dev server works, so day-to-day use never hits it.

The `[hold]` was placed on the belief that this was unfixable upstream. That
belief is worth re-testing before accepting another quarter of a broken build —
see the concrete hypothesis below.

## Context
- `apps/dashboard` is a **pure app-router** Next.js app. The routes live in
  `apps/dashboard/app/` (not `src/app/`); `src/` holds components and lib code.
- Installed Next is **15.5.19**. `next.config.ts` sets `output: 'standalone'`
  and a rewrite proxying `/api/:path*` to `API_ORIGIN`.
- **The most likely cause, and the first thing to test:** the app has
  `app/error.tsx` but **no `app/not-found.tsx` and no `app/global-error.tsx`**.
  When an app-router project lacks `not-found.tsx`, Next falls back to its
  internal pages-router error page during static export of `/404` and `/_error`
  — and that fallback imports `<Html>`, producing exactly this error. Adding
  `app/not-found.tsx` (and if needed `app/global-error.tsx`) is the standard
  fix. Try that before concluding it's upstream.
- If that does not fix it, the next candidates in order: a dependency pulling
  `next/document` transitively (grep `node_modules` for `next/document` imports
  reachable from the app graph), and a Next patch-version bump within 15.x.
- Do not "fix" it by disabling static generation for `/404` unless the two
  approaches above both fail — that trades a broken build for a slower one and
  should be a documented last resort, not the first move.
- This is a build-only failure. There is no runtime symptom to reproduce and no
  test that currently covers it, which is why the acceptance criteria below make
  the build itself the check.

## Tasks
1. Reproduce: `env -u TURBOPACK pnpm nx build dashboard --skip-nx-cache`. Confirm
   the same `/404` prerender error before changing anything.
2. Add `app/not-found.tsx` matching the existing `app/error.tsx` conventions
   (same layout, same styling tokens) and rebuild. This is the primary
   hypothesis.
3. If still failing, add `app/global-error.tsx` and rebuild.
4. If still failing, trace where `<Html>` enters the graph — grep the app and its
   reachable dependencies for `next/document`, and check whether a Next 15.x
   patch bump resolves it.
5. Whatever the fix, confirm the 404 page actually renders correctly in
   `pnpm nx dev dashboard` — a build that passes with a broken 404 page is not a
   fix.
6. Add the build to whatever verification the repo runs, so this can't silently
   rot for another quarter. If `pnpm build` doesn't currently cover the
   dashboard, wire it in.
7. Update the two backlog entries: the sprint-04 `[hold]` and the 2026-08-21
   infra item both describe this, and both should be resolved together.

## Files involved
- new file: `apps/dashboard/app/not-found.tsx` — the primary hypothesis
- possible new file: `apps/dashboard/app/global-error.tsx` — if step 3 is needed
- `apps/dashboard/app/error.tsx` — reference for conventions; may not change
- `apps/dashboard/package.json` / `apps/dashboard/next.config.ts` — only if the
  fix turns out to be a version bump or config change

## Acceptance criteria
- [ ] `env -u TURBOPACK pnpm nx build dashboard --skip-nx-cache` exits 0
- [ ] The 404 page renders correctly in the dev server, not just in the build
- [ ] The fix is explained in the sprint's Completed section — specifically
      whether the `not-found.tsx` hypothesis was correct, since sprint 04
      recorded this as unfixable upstream
- [ ] The dashboard build is covered by a repo-level verification command, so a
      regression surfaces without a manual check
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` still green
- [ ] Static generation for `/404` is still enabled, or its disabling is
      documented as a deliberate last resort with the reasoning

## Out of scope
- Redesigning the dashboard's error or 404 experience beyond what's needed to
  make the build pass and the page render sensibly.
- The develemit-hq Turbopack crash — a different project and a different bug.
- Upgrading Next across a major version.
