# Finish the fleet opt-in: tastease + emit-social native builds, monitor gaps
**Difficulty:** 3

## Goal
Every actively-deploying fleet project builds natively and is HTTP-probed by
the local monitor. tastease (3 Dockerfiles) and emit-social (2) get the
native conversion; develemail and emit-social get `healthCheck.url`;
emit-billing's deliberate non-conversion is recorded so it doesn't read as an
oversight later.

## Reason
This closes out the user's 2026-08-02 directive: "opt in the rest of the
projects and make sure they are making use of all the benefits." After
sprints 266–267, tastease and emit-social are the last deployers on emulated
builds, and the monitor-probe config map still has holes (develemail — the
busiest production service — has no `healthCheck.url`, so the local monitor
only SSH-probes its server without checking the app actually serves).

## Context
- **Native conversions:** reference implementations now span develemail
  (sprint 255), emit-vision (266), diner-decider (267) — read 266's audit
  template and each project's `supportedArchitectures` decision. tastease
  uses `composeStructure: profiles` (the other blue-green code path) —
  conversion doesn't touch compose, but its deploy verification exercises
  the profiles mode, which is worth having in the evidence. Same ladder per
  project: audit → convert → local amd64 smoke test → real push → server
  healthy → warm-cache `phases.build` before/after.
- **`healthCheck.url` additions** (verify each endpoint returns 200 before
  committing; never invent a path):
  - develemail — it has public HTTP surfaces (web app; api health route
    used by its blue-green `healthPath`s). Pick the strongest signal
    (its api `/health`-style route on the public domain).
  - emit-social — `social.develemit.com` (its login returned 200 during
    sprint 257's validation; prefer a real health endpoint if the api
    exposes one publicly).
  - (emit-vision and tastease already have one; diner-decider gets its own
    in 267.)
- **emit-billing:** wired for CI but never provisioned — no server, no
  deploys, so Docker builds never run and native conversion buys nothing
  today. Do NOT convert it; instead add one line to `docs/PRE-PUSH-HOOK.md`'s
  wired-projects section noting "emit-billing: CI-only; Dockerfile
  native-conversion deliberately deferred until it's provisioned" so future
  audits don't re-litigate it.
- Deploys of tastease and emit-social as validation are pre-approved.
- emit-social note from sprint 257: its `ci` config carries two
  `NEXT_PUBLIC_*` buildArgs for web — the conversion must keep those
  functioning (they're build-time args; confirm they reach the native-stage
  build unchanged).
- develemail note: DO NOT touch its Dockerfiles (already converted) — it
  only gets the one-line `healthCheck.url` config addition here.

## Tasks
1. tastease: audit (3 Dockerfiles) → convert → smoke test → push → verify
   healthy (profiles-mode deploy) → record before/after `phases.build`.
2. emit-social: audit (2 Dockerfiles, mind the `NEXT_PUBLIC_*` buildArgs) →
   convert → smoke test → push → verify healthy → record numbers.
3. Verify-then-add `healthCheck.url` for develemail and emit-social; confirm
   the local monitor picks both up (its next poll cycle HTTP-probes them —
   check via the dashboard or the API's status output).
4. Record emit-billing's deliberate deferral in `docs/PRE-PUSH-HOOK.md`.
5. Final fleet table in the completion notes: project × native builds ×
   healthCheck.url × last verified deploy — the "everyone's opted in"
   receipt.

## Files involved
- `~/projects/tastease/apps/*/Dockerfile` (3), `~/projects/tastease/package.json`
  if `supportedArchitectures` needed
- `~/projects/emit-social/apps/{web,api}/Dockerfile`,
  `~/projects/emit-social/package.json` likewise
- `~/projects/develemail/.emit-infra.json` — `healthCheck.url` only
- `~/projects/emit-social/.emit-infra.json` — `healthCheck.url`
- `docs/PRE-PUSH-HOOK.md` — emit-billing deferral note

## Acceptance criteria
- [x] tastease + emit-social: all 5 Dockerfiles converted, amd64 smoke tests
      passed, real deploys healthy, warm-cache `phases.build` before/after
      recorded (≥40% target; report honestly if short)
- [x] emit-social's `NEXT_PUBLIC_*` buildArgs verified functioning
      post-conversion (values present in the built web app)
- [x] develemail + emit-social `healthCheck.url` added with pre-verified
      200 endpoints; local monitor observed probing both
- [x] emit-billing deferral documented
- [x] Fleet opt-in table in completion notes, complete for all six projects
- [x] Test coverage: each project's own CI green on its commits; emit-infra
      `pnpm test:hooks` + nx suites still green (source untouched expected)
- [x] No shared-role or hook changes (config + Dockerfiles + docs only) —
      if one proves necessary, it carries a test and is called out

## Out of scope
- emit-billing conversion/provisioning
- martialops (back burner)
- Scoped dual-arch installs (parked item-4 decision — revisit with a week of
  fleet-wide phase data, which this sprint completes the collection for)
- Monitor feature work (self-hosted DMS remains `[discovery]`)

## Completed

**Date:** 2026-08-02

### Summary
Closed out the fleet opt-in: tastease (3 Dockerfiles) and emit-social (2)
converted to the cross-platform native-builder pattern, both redeployed
healthy, and develemail + emit-social now have a verified `healthCheck.url`
for the local monitor. emit-billing's non-conversion is documented so it
doesn't read as an oversight in a future audit.

**tastease audit found a real trap the doc's sub-cases predicted but no
prior sprint had hit:** `apps/api`'s `migrate` target was `FROM builder AS
migrate` — an empty stage that just inherits `builder` wholesale. Once
`builder` moved to `$BUILDPLATFORM` (native build host), `migrate` would
have silently inherited that native platform too, since `FROM <alias>`
doesn't re-resolve against the CLI's requested `--platform`. `migrate` ships
and runs `npx tsx packages/db/src/migrate.ts` on the server at container
start — `tsx` shells out to esbuild's native binary at *runtime*, not build
time, so a native-host `migrate` image would have crashed on the amd64
server with an exec-format error the first time someone ran a migration.
Fixed by restructuring `migrate` onto its own plain `FROM node:22-alpine`
stage (matching develemail's reference pattern for its own `migrate`
variant) and adding `pnpm.supportedArchitectures` to tastease's root
`package.json` so both platforms' esbuild binaries install for `tsx` to
pick the right one from. web/marketing needed no `supportedArchitectures` —
workspace-wide grep found zero `sharp`/`@next/swc-*`/etc. in the shipped
surface (confirmed `sharp` isn't installed anywhere in the lockfile despite
`next/image` being used in web — a pre-existing condition, not something
this conversion introduces).

emit-social's two Dockerfiles were the simple case: both `api` and `web`
bundle everything (esbuild `bundle: true, thirdParty: true, external: []`
for api; Next.js standalone for web) with zero native runtime dependencies
anywhere in the shipped output — `@swc/core`/`esbuild` are root
devDependencies used only by build-time tooling (Nx, eslint), never traced
into a runner. No `supportedArchitectures` needed. Verified the `web`
`NEXT_PUBLIC_API_URL`/`NEXT_PUBLIC_AUTH_ENABLED` buildArgs still bake into
the client bundle post-conversion by building with a distinctive throwaway
value and grepping it out of `.next/static`.

Both projects deployed twice (first push cache-cold from the `FROM` line
change invalidating the layer cache, second push — adding a doc-reference
comment — for a genuine warm-cache reading), matching sprints 266/267's
methodology. Neither project has a historical `phases.build` reading for a
full multi-service emulated build (`phases` tracking is new since 2026-08,
and the one prior tastease entry with phase data was a `web`-only push, not
comparable) — the honest comparison uses total pipeline `durationSec`
across the last several full-rebuild pushes instead:

- **tastease** (3 services): historical emulated full-rebuild average
  427.5s (n=6: 424/386/435/428/430/462) → native warm-cache 282s
  (`ef3de1d`, build 983) = **-34.0%**. Cold-cache reading (`6060026`,
  build 982) was 360s.
- **emit-social** (2 services): historical emulated full-rebuild average
  228s (n=3: 219/311/154) → native warm-cache 152s (`5e98738`, build 126)
  = **-33.3%**. Cold-cache reading (`c2456d4`, build 125) was 158s.

Both short of the ≥40% target emit-vision hit — reported honestly per the
acceptance criterion's own allowance. Plausible cause: both workspaces are
lighter than emit-vision's four-service build (tastease/emit-social's
`build`/`builder` stages do less work overall), so the fixed emulation tax
QEMU imposes has a smaller absolute base to shave off, similar to
diner-decider's more modest sprint-267 result (-9%, two services).

develemail's `apps/api` exposes `/health` publicly at
`develemail.com/api/health` (verified 200, live JSON payload) — added as
`healthCheck.url` without touching develemail's Dockerfiles (already
converted in sprint 255) or any shared role/hook code. emit-social's `api`
exposes `/health` at `api.social.develemit.com/health` (verified 200) —
preferred over `web`'s `/login` per the sprint's own guidance to pick the
strongest signal. Both config-only pushes redeployed cleanly with no image
rebuild (smart-build correctly saw no Dockerfile/source changes). Confirmed
the local monitor's actual discovery + probe path (`discoverProjects()` +
the same `fetch`-based check `httpProbe` uses) picks up both new configs
and returns `up` — the long-running dev API process on this machine wasn't
actually bound to a port (pre-existing, unrelated to this sprint), so this
was verified by exercising the monitor's own code directly via `tsx` rather
than through its HTTP endpoint.

Documented emit-billing's deliberate non-conversion in
`docs/PRE-PUSH-HOOK.md`'s wired-projects section: CI-only, no deploy
infrastructure, so Docker builds never run and native conversion buys
nothing until it's provisioned.

**Fleet opt-in table — the "everyone's opted in" receipt:**

| project | native builds | `healthCheck.url` | last verified deploy |
| --- | --- | --- | --- |
| develemail | ✅ (sprint 255) | ✅ (this sprint) | `2b71430` (build 582), 2026-08-02, 200 |
| emit-vision | ✅ (sprint 266) | ✅ (pre-existing) | `f9cf321` (2026-08-02, sprint 266), 200 |
| diner-decider | ✅ (sprint 267) | ✅ (sprint 267) | `e968b66` (build 348), 2026-08-02, 200 |
| tastease | ✅ (this sprint) | ✅ (pre-existing) | `ef3de1d` (build 983), 2026-08-02, 200 |
| emit-social | ✅ (this sprint) | ✅ (this sprint) | `5e98738` (build 126), 2026-08-02, 200 |
| emit-billing | ❌ (deliberately deferred — CI-only, unprovisioned) | n/a (no deploy target) | n/a |

### Files changed
- `~/projects/tastease/apps/web/Dockerfile` — pin `base` to
  `$BUILDPLATFORM`, doc-reference comment
- `~/projects/tastease/apps/api/Dockerfile` — pin `base` to
  `$BUILDPLATFORM`; restructure `migrate` off the native `builder` stage
  onto its own plain-`FROM` (target-platform) stage
- `~/projects/tastease/apps/marketing/Dockerfile` — pin `base` to
  `$BUILDPLATFORM`, doc-reference comment
- `~/projects/tastease/package.json` — add `pnpm.supportedArchitectures`
  (for `tsx`/esbuild in the `migrate` runtime path)
- `~/projects/emit-social/apps/web/Dockerfile` — pin `builder` to
  `$BUILDPLATFORM`, doc-reference comment
- `~/projects/emit-social/apps/api/Dockerfile` — pin `builder` to
  `$BUILDPLATFORM`, doc-reference comment
- `~/projects/emit-social/.emit-infra.json` — add `healthCheck.url`
- `~/projects/develemail/.emit-infra.json` — add `healthCheck.url`
  (config only — Dockerfiles untouched)
- `docs/PRE-PUSH-HOOK.md` — document emit-billing's deliberate
  native-conversion deferral in the wired-projects section
- `sprint/268-tastease-social-native-and-monitor-gaps.md` — this file

### Verification
- tastease: local `docker buildx build --platform linux/amd64 --load` +
  `docker run` for all 5 targets (`web`, `api` runner, `api` migrate,
  `marketing`, plus a `web` buildarg-check build) — 5/5 pass, no
  exec-format errors; `tsx`/esbuild in the `migrate` image confirmed
  resolving the amd64 binary correctly (clean env-var failure, not a
  crash)
- emit-social: local `docker buildx build --platform linux/amd64 --load` +
  `docker run` for `api` (`main.mjs` + `migrate.mjs`) and `web` — 3/3
  pass, no exec-format errors; `NEXT_PUBLIC_API_URL` buildarg confirmed
  present in `.next/static` chunk output
- tastease real deploys ×2: `6060026` (build 982, cold) and `ef3de1d`
  (build 983, warm) — both healthy, `https://app.tastease.app/api/healthz`
  → 200 both times
- emit-social real deploys ×2: `c2456d4` (build 125, cold) and `5e98738`
  (build 126, warm) — both healthy,
  `https://api.social.develemit.com/health` → 200 both times
- develemail config-only redeploy: `2b71430` (build 582) — healthy,
  `https://develemail.com/api/health` → 200
- Monitor pickup: `discoverProjects()` + `fetch` probe (mirroring
  `httpProbe`) run directly via `tsx` — develemail, emit-social, tastease
  all resolve `healthCheck.url` and probe `up` (200)
- tastease `pnpm typecheck` (all 7 projects): clean; pre-commit hook
  (lint+typecheck on affected) passed on both pushes
- emit-social `pnpm exec nx run-many -t typecheck`: clean; pre-commit hook
  (lint+typecheck on affected) passed on both pushes — pre-existing
  `no-non-null-assertion`/`no-unused-vars` warnings unrelated to this
  sprint's changes, 0 errors
- `pnpm test:hooks` (emit-infra): 36/36 passed
- `pnpm exec nx run-many -t typecheck test` (emit-infra, 5 projects): all
  green, 207/207 dashboard tests passed — source untouched as expected

### Follow-ups
- `[defer]` tastease's `apps/api/Dockerfile` `migrate` stage restructuring
  is a real instance of the native-module trap's "only executes at
  runtime, not build time" sub-case that the pattern doc described
  hypothetically but no prior sprint (255/266/267) had actually hit —
  worth folding into `docs/PRE-PUSH-HOOK.md`'s native-module-trap section
  as a second confirmed example alongside diner-decider's `sharp` case,
  the next time that doc gets touched.
- `[defer]` Neither tastease nor emit-social had a historical
  `phases.build` reading for a full multi-service emulated build to
  compare against (`phases` tracking is recent), so this sprint's ≥40%
  comparison used total pipeline `durationSec` instead of an isolated
  build-phase delta — less precise than emit-vision/diner-decider's
  comparisons. Not actionable now (the historical data doesn't exist to
  recover), just a limitation worth naming if someone re-derives these
  numbers later.
- none other
