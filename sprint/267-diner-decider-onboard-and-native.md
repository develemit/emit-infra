# Bring diner-decider fully onto the new pipeline: triage, push, native builds
**Difficulty:** 4

## Goal
diner-decider's month of unpushed work ships safely through the new pipeline,
its two Dockerfiles build natively, and it gains a `healthCheck.url` so the
local monitor HTTP-probes it like the rest of the fleet. It ends the sprint
with a verified smart-build deploy and a recorded phase breakdown.

## Reason
diner-decider is the most behind of the wired projects: **3 dirty files, 34
unpushed commits** (as of 2026-08-02), no `healthCheck.url`, and 0/2 native
Dockerfiles. It's symlinked to the shared hook, so its next push already gets
smart builds and the dry-run guard — but nobody has pushed since the overhaul
landed, the dirty tree is unexplained, and a month of accumulated change
deserves a shepherded first push rather than a surprise one (develemail's
sprint-252 near-miss — an unpushed leftover commit bundling into a "safe"
test push — is the cautionary tale).

## Context
- **Triage before anything** (this is the risky part; be a historian first):
  `git status` / `git diff` the 3 dirty files and `git log origin/main..HEAD`
  the 34 commits in `~/projects/diner-decider`. Classify the dirty files:
  ambient machine-written (`.emit-infra.json` counters, `.incidents.jsonl`
  etc. — leave), abandoned experiment (stash with a note), or unfinished real
  work (STOP and report as `blocked` naming the files — do not guess-commit
  someone's half-done work). The 34 commits are presumably finished work
  (sprint 258's syncOnDeploy enablement is among them); verify the most
  recent ones look complete (no "WIP" subjects) before pushing.
- **First push mechanics:** its `.deploy-status.json`/history may be stale
  the same way emit-vision's was (any CLI-side deploys since the last hooked
  push don't record history — known gap, backlogged). Expect a full rebuild
  on the first push; that's correct-but-slow, and it resets `LAST_SHA` so
  later pushes are smart. CI runs its `ci.prePush` targets — run them
  locally FIRST (`pnpm nx affected -t <targets> --base=origin/main`) so a
  failure surfaces before, not during, the push.
- **Native conversion:** 2 Dockerfiles, reference pattern in
  `docs/PRE-PUSH-HOOK.md` + develemail/emit-vision implementations (sprint
  266 lands before this one — read its completion notes for the audit
  template and the `supportedArchitectures` decision framework). Same
  ladder: audit native deps → convert → local amd64 smoke test → real push →
  server healthy.
- **healthCheck.url:** add to `~/projects/diner-decider/.emit-infra.json`
  following emit-vision's shape (`healthCheck.url` pointing at its public
  health endpoint — find the real route: check its nginx vhost/API for
  `/healthz`-style paths; don't invent one, verify it returns 200 first).
  This enables the local monitor's HTTP probing (`status-monitor.ts`).
- diner-decider deploys as validation are pre-approved by the user.
- Baseline for the record: capture the first push's `phases` and note it in
  `docs/DEPLOY-FLOOR.md` only if it reveals something new (different
  composeStructure behavior etc.); otherwise the sprint notes suffice.

## Tasks
1. Triage the dirty tree per the classification above; resolve or halt.
2. Run its CI targets locally against `origin/main`; fix nothing here — if
   CI fails on existing commits, halt as `blocked` with the failure (a month
   of foreign work is not this sprint's to debug).
3. Shepherded first push: watch CI, the build/retag split decision, and the
   deploy through; verify server healthy + `.deploy-status.json` `deployed`
   + a `phases` history entry.
4. Native conversion of both Dockerfiles (audit first, per sprint 266's
   template); local amd64 smoke tests.
5. Add `healthCheck.url` (verified-200 endpoint only).
6. Second push (the conversion commit): verify smart build behavior kicked
   in correctly for what changed, deploy healthy, record before/after
   `phases.build`.

## Files involved
- `~/projects/diner-decider` — triage, pushes
- `~/projects/diner-decider/apps/*/Dockerfile` (2) — conversion
- `~/projects/diner-decider/.emit-infra.json` — `healthCheck.url`
- `docs/PRE-PUSH-HOOK.md` — only if something new is learned

## Acceptance criteria
- [ ] Dirty-file triage documented per file (ambient / stashed / halted-on);
      nothing guess-committed
- [ ] First push: CI green (locally pre-verified), deploy `deployed`, server
      healthy, `phases` recorded
- [ ] Both Dockerfiles converted; native-dep audit in notes; amd64 smoke
      tests before deploy
- [ ] `healthCheck.url` added and its endpoint verified 200 before commit
- [ ] Conversion push shows correct smart-build split and healthy deploy;
      before/after `phases.build` recorded
- [ ] Test coverage: diner-decider's own CI green on every push (that is its
      test gate); emit-infra untouched expected, `pnpm test:hooks` still
      green
- [ ] No `[blocker]`-worthy surprises left undocumented

## Out of scope
- Debugging failures inside the 34 pre-existing commits (halt instead)
- The CLI-deploy history-recording gap (backlogged separately)
- Other projects
