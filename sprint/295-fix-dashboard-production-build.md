# Fix the dashboard production build's /404 prerender failure
**Difficulty:** 3

> _Promoted from backlog: sprint-04 follow-up and the 2026-08-21 infra finding._

## Goal
`pnpm nx build dashboard` succeeds **in the ambient environment of this
machine**, with no `env -u` prefix required by the caller. The dashboard can be
built for production again, rather than being the one project in the repo whose
build is known-broken.

## Reason
`nx build dashboard` fails:

```
Error: <Html> should not be imported outside of pages/_document.
Error occurred prerendering page "/404".
Export encountered an error on /_error: /404, exiting the build.
```

First filed at sprint 04 (2026-06-03) as an upstream Next.js bug and marked
`[hold]`. **That framing was wrong and cost roughly two and a half months.**
It is not an upstream bug at all — it is two independent environment variables
leaking in from the calling shell, each of which alone reproduces the failure.
Measured 2026-08-22 on this machine, whose shell sets both:

| ambient env | `nx build dashboard` |
|---|---|
| `NODE_ENV=development` set | fails |
| `TURBOPACK=1` set | fails |
| both unset | exits 0 |

A first pass closed the `NODE_ENV` leak (`env -u NODE_ENV next build`) and
added a 404 page. The build **still fails**, because `TURBOPACK=1` is set by
default here and breaks it the same way. Verified: with `TURBOPACK=1` the
build exits 1 with three `<Html>` errors; with it unset, exit 0.

This is the same class of bug as tastease's 2026-08-22 blocked deploy — a
build target whose result depends on the caller's environment rather than on
the code — and the same fix applies: make the target self-sufficient.

## Context

### What is already done — do not redo it
A prior pass on this sprint (commit `3965bfc`) landed:
- `apps/dashboard/project.json`'s `build` target changed to
  `env -u NODE_ENV next build`
- `apps/dashboard/app/not-found.tsx` added — a styled 404 page. The dashboard
  genuinely had none, so this is worth keeping, **but it was not the fix.**
  Sprint 04's `not-found.tsx` hypothesis is disproven: the page exists now and
  the build still fails when `TURBOPACK=1`.

### The remaining work
One line. Extend the same `env -u` to the second leaked variable:

```json
"command": "env -u NODE_ENV -u TURBOPACK next build"
```

**This exact command has been verified** to exit 0 with *both* leaks present
in the parent shell, with zero prerender errors — run 2026-08-22 as
`TURBOPACK=1 NODE_ENV=development sh -c 'env -u NODE_ENV -u TURBOPACK npx next build'`
from `apps/dashboard`.

### Why the previous acceptance criterion let this through
It read `env -u TURBOPACK pnpm nx build dashboard --skip-nx-cache exits 0` —
which bakes the workaround into the check. The build passed *because the
criterion unset the very variable that breaks it*. Criteria for this class of
bug must run the command the way a normal caller would, with no scrubbing
prefix, or they verify nothing. The criteria below are rewritten accordingly.

### Repo facts
- `apps/dashboard` is a pure app-router Next.js app; routes live in
  `apps/dashboard/app/` (not `src/app/`). Installed Next is **15.5.19**.
  `next.config.ts` sets `output: 'standalone'`.
- `TURBOPACK=1` being set in this environment is documented elsewhere in the
  fleet as masking Next build errors — this is that trap, biting for real.
- This is a build-only failure with no runtime symptom, which is why it stayed
  invisible: the dev server works, so day-to-day use never hits it.

## Tasks
1. Confirm the failure first, with **no scrubbing prefix**:
   `pnpm nx build dashboard --skip-nx-cache` in a shell where `TURBOPACK=1`.
   It should fail with the `/404` prerender error.
2. Change the `build` target in `apps/dashboard/project.json` to
   `env -u NODE_ENV -u TURBOPACK next build`.
3. Re-run without any prefix and confirm exit 0.
4. Confirm it also passes with both variables explicitly set
   (`TURBOPACK=1 NODE_ENV=development pnpm nx build dashboard --skip-nx-cache`)
   — that is the real regression test, since it proves the target no longer
   cares what the caller's environment holds.
5. Confirm the 404 page still renders in `pnpm nx dev dashboard`. The dev
   target must keep working — do not scrub variables the dev server needs.
6. Grep for other Next build targets in the repo
   (`"command": ".*next build"` across `project.json` files) and note whether
   any need the same treatment. Fixing them is optional; naming them is not.
7. Update the two backlog entries that describe this — the sprint-04 `[hold]`
   and the 2026-08-22 incomplete-fix item — to reflect the real cause.

## Files involved
- `apps/dashboard/project.json` — the one change: `build` target becomes
  `env -u NODE_ENV -u TURBOPACK next build`
- `apps/dashboard/app/not-found.tsx` — already added in `3965bfc`; keep it (the
  dashboard genuinely had no 404 page), but it is not the fix
- other `project.json` files — read-only survey for task 6; change only if a
  second `next build` target turns out to need the same treatment
- `backlog.md` — update the sprint-04 `[hold]` and the 2026-08-22
  incomplete-fix entries (task 7)

## Acceptance criteria
- [ ] `pnpm nx build dashboard --skip-nx-cache` exits 0 with **no `env -u`
      prefix**, in a shell where `TURBOPACK=1` and `NODE_ENV=development` are
      set — the ambient state of this machine
- [ ] `TURBOPACK=1 NODE_ENV=development pnpm nx build dashboard --skip-nx-cache`
      exits 0, proving the target is immune to the caller's environment
- [ ] The 404 page still renders in `pnpm nx dev dashboard` — the dev target is
      not collateral damage
- [ ] Any other `next build` target in the repo is either given the same
      treatment or explicitly named as not needing it
- [ ] `pnpm typecheck`, `pnpm test`, `pnpm lint` green
- [ ] Static generation for `/404` is still enabled — the fix must not disable
      prerendering to make the error go away
- [ ] The sprint's Completed section states the real cause (two leaked env
      vars), so sprint 04's "upstream Next bug" framing is not repeated

## Out of scope
- Redesigning the dashboard's error or 404 experience beyond what's needed to
  make the build pass and the page render sensibly.
- The develemit-hq Turbopack crash — a different project and a different bug.
- Upgrading Next across a major version.

## In Progress (reopened 2026-08-22)

**Reopened:** the first pass fixed only one of two env leaks; the build still
fails in the ambient environment. The record below is that pass's report — its
`env -u NODE_ENV` change and `not-found.tsx` are committed in `3965bfc` and
should be kept. Everything it claims about the build passing was true only
under `env -u TURBOPACK`, which the old acceptance criterion wrongly specified.


**Date:** 2026-08-23

### Summary (first pass)
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

### Files changed (first pass, committed in 3965bfc)
- (new) `apps/dashboard/app/not-found.tsx` — styled 404 page matching
  `app/error.tsx`'s conventions (same `Icon` component, error-soft styling
  tokens); links back to `/`
- `apps/dashboard/project.json` — `build` target now runs
  `env -u NODE_ENV next build` instead of `next build`, so a polluted
  `NODE_ENV` in the caller's environment can't break the prerender of `/404`
  again

### Verification (first pass — ran under `env -u TURBOPACK`, which is why it read green)
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

### Follow-ups (from the first pass — already filed to backlog.md)
- `[defer]` `env -u NODE_ENV` on the `build` target is a targeted fix for this
  one symptom. If other Next-based build targets in this repo (or future ones)
  get added, they'd benefit from the same treatment — worth a grep for
  `"command": ".*next build"` across `project.json` files next time one's
  added.
- `[defer]` The ESLint warning "The Next.js plugin was not detected in your
  ESLint configuration" appears on every dashboard lint/build run. Unrelated
  to this bug and out of scope here, but cheap to fix if someone's touching
  `apps/dashboard/eslint.config.*` anyway.
