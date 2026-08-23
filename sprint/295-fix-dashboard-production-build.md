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
- [x] `env -u TURBOPACK pnpm nx build dashboard --skip-nx-cache` exits 0
- [x] The 404 page renders correctly in the dev server, not just in the build
- [x] The fix is explained in the sprint's Completed section — specifically
      whether the `not-found.tsx` hypothesis was correct, since sprint 04
      recorded this as unfixable upstream
- [x] The dashboard build is covered by a repo-level verification command, so a
      regression surfaces without a manual check
- [x] `pnpm typecheck`, `pnpm test`, `pnpm lint` still green
- [x] Static generation for `/404` is still enabled, or its disabling is
      documented as a deliberate last resort with the reasoning

## Out of scope
- Redesigning the dashboard's error or 404 experience beyond what's needed to
  make the build pass and the page render sensibly.
- The develemit-hq Turbopack crash — a different project and a different bug.
- Upgrading Next across a major version.

## Completed

**Date:** 2026-08-23

### Summary
The `not-found.tsx` hypothesis was **wrong** — sprint 04's belief that this was
an unfixable upstream Next.js bug was also wrong, but not for the reason this
sprint's `## Reason` section guessed.

Reproducing with `env -u TURBOPACK pnpm nx build dashboard --skip-nx-cache`
confirmed the failure, then bisecting it turned up the actual cause: `NODE_ENV`
was already set to `development` in the shell before `next build` ran. A clean
env (`env -i zsh -c 'echo $NODE_ENV'`, `env -i zsh -li -c '...'`) showed nothing
sets this in the user's `.zshrc`/`.zprofile` — it's injected by the agent
sandbox this sprint (and `/start-sprint` generally) executes in, alongside
`CLAUDECODE=1`, `CLAUDE_CODE_ENTRYPOINT`, etc. (confirmed via `env`). That
matches an existing pattern already in this repo:
`scripts/lib/deploy-unattended-gate.test.sh` scrubs `CLAUDECODE`,
`CLAUDE_CODE_ENTRYPOINT`, and `CI` for exactly this reason. Because every past
verification of this bug (sprint 04, the 2026-08-21 infra finding, this sprint)
ran inside that same sandbox, the bug looked 100% reproducible and "upstream" —
it's real, but it's environment-triggered, not code- or dependency-triggered.

With `NODE_ENV=development` stripped, `next build` succeeds against the
**original** `next@15.5.19` — no not-found.tsx, no global-error.tsx, no patch
bump required. Isolated each candidate individually to confirm:
- `app/not-found.tsx` alone: build still failed (moved the failure from `/404`
  to `/500`, so it wasn't a no-op, but wasn't sufficient either).
- `app/global-error.tsx` added on top: build still failed.
- Next patched to `15.5.23` (latest 15.5.x): build still failed with
  `NODE_ENV=development` present.
- `NODE_ENV` unset, everything else reverted to original: build passed.

Two changes shipped:
1. `apps/dashboard/app/not-found.tsx` — added anyway per Task 2, since the
   dashboard had no styled 404 page at all (Next's bare default rendered on
   `/_not-found` otherwise). Matches `app/error.tsx`'s layout/tokens. Confirmed
   in the dev server: `GET /this-page-does-not-exist` → `404`, body contains
   "Page not found" / "Back to dashboard".
2. `apps/dashboard/project.json`'s `build` target command changed from
   `next build` to `env -u NODE_ENV next build`. This is the actual fix — it
   makes the dashboard build immune to a polluted `NODE_ENV` regardless of the
   caller (human shell, CI runner, or another agent sandbox), rather than
   requiring every future caller to remember to unset it manually.

`global-error.tsx` was tried during triage but is **not** in the final diff —
it wasn't needed once the real cause was found, and adding it would have been
scope creep past what Task 2's primary hypothesis already covered.

Static generation for `/404` was never disabled — the concern in the sprint
about "trading a broken build for a slower one" didn't come up, since the real
fix required no fallback.

### Files changed
- (new) `apps/dashboard/app/not-found.tsx` — styled 404 page matching
  `app/error.tsx`'s conventions (same `Icon` component, error-soft styling
  tokens); links back to `/`
- `apps/dashboard/project.json` — `build` target now runs
  `env -u NODE_ENV next build` instead of `next build`, so a polluted
  `NODE_ENV` in the caller's environment can't break the prerender of `/404`
  again

### Verification
- `env -u TURBOPACK pnpm nx build dashboard --skip-nx-cache`: exit 0 (verified
  twice — once with `NODE_ENV` scrubbed at the outer shell too, once with the
  polluted `NODE_ENV=development` left in the outer shell to prove the
  `project.json` fix alone is sufficient)
- `pnpm nx dev dashboard` + `curl localhost:7013/this-page-does-not-exist`:
  `404`, custom page renders
- `pnpm typecheck`: clean (5/5 projects, dashboard included)
- `pnpm lint`: clean (5/5 projects, dashboard included)
- `pnpm test`: 215/215 pass (23 test files)
- `pnpm build` (root, `nx run-many -t build`, all 5 projects including
  dashboard): exit 0 — confirms the dashboard build is already covered by the
  repo-level verification command, no new wiring needed

### Follow-ups
- `[defer]` `env -u NODE_ENV` on the `build` target is a targeted fix for this
  one symptom. If other Next-based build targets in this repo (or future ones)
  get added, they'd benefit from the same treatment — worth a grep for
  `"command": ".*next build"` across `project.json` files next time one's
  added.
- `[defer]` The ESLint warning "The Next.js plugin was not detected in your
  ESLint configuration" appears on every dashboard lint/build run. Unrelated
  to this bug and out of scope here, but cheap to fix if someone's touching
  `apps/dashboard/eslint.config.*` anyway.
