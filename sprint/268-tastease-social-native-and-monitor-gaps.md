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
- [ ] tastease + emit-social: all 5 Dockerfiles converted, amd64 smoke tests
      passed, real deploys healthy, warm-cache `phases.build` before/after
      recorded (≥40% target; report honestly if short)
- [ ] emit-social's `NEXT_PUBLIC_*` buildArgs verified functioning
      post-conversion (values present in the built web app)
- [ ] develemail + emit-social `healthCheck.url` added with pre-verified
      200 endpoints; local monitor observed probing both
- [ ] emit-billing deferral documented
- [ ] Fleet opt-in table in completion notes, complete for all six projects
- [ ] Test coverage: each project's own CI green on its commits; emit-infra
      `pnpm test:hooks` + nx suites still green (source untouched expected)
- [ ] No shared-role or hook changes (config + Dockerfiles + docs only) —
      if one proves necessary, it carries a test and is called out

## Out of scope
- emit-billing conversion/provisioning
- martialops (back burner)
- Scoped dual-arch installs (parked item-4 decision — revisit with a week of
  fleet-wide phase data, which this sprint completes the collection for)
- Monitor feature work (self-hosted DMS remains `[discovery]`)
