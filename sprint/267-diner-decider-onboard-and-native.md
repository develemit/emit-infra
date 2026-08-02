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
- [x] Dirty-file triage documented per file (ambient / stashed / halted-on);
      nothing guess-committed
- [x] First push: CI green (locally pre-verified), deploy `deployed`, server
      healthy, `phases` recorded
- [x] Both Dockerfiles converted; native-dep audit in notes; amd64 smoke
      tests before deploy
- [x] `healthCheck.url` added and its endpoint verified 200 before commit
- [x] Conversion push shows correct smart-build split and healthy deploy;
      before/after `phases.build` recorded
- [x] Test coverage: diner-decider's own CI green on every push (that is its
      test gate); emit-infra untouched expected, `pnpm test:hooks` still
      green
- [x] No `[blocker]`-worthy surprises left undocumented

## Out of scope
- Debugging failures inside the 34 pre-existing commits (halt instead)
- The CLI-deploy history-recording gap (backlogged separately)
- Other projects

## Blocked

**Date:** 2026-08-02

### Reason
The shepherded first push (task 3) reached the deploy phase and failed inside
the `web` service's Docker build — this is a defect in the pre-existing
(unpushed) commit history, out of scope to fix per this sprint's explicit
rule ("Debugging failures inside the 34 pre-existing commits (halt instead)")
and the operator's standing triage instruction for this run.

**Root cause:** `apps/web/src` imports from the workspace package
`@diner-decider/pricing` (extracted in sprint 29 / commit `c4cacd0`,
"extract pricing into a shared packages/pricing module" — one of the 34
unpushed commits). `apps/web/Dockerfile` was never updated to `COPY
packages/pricing` (or its `package.json`) into the build context — it only
copies `package.json`/`pnpm-lock.yaml`/`pnpm-workspace.yaml`, `patches`,
`apps/web/package.json`, `nx.json`, `tsconfig.base.json`, and `apps/web`
itself. Contrast with `apps/api/Dockerfile`, which correctly `COPY
packages/db/package.json` + `COPY packages/db` because `@diner-decider/api`
depends on `@diner-decider/db` — the web Dockerfile's `packages/pricing`
equivalent is simply missing. Nobody caught this because GH Actions CI never
runs `docker build` (only the pre-push hook / `emit-infra deploy` does), and
nobody has pushed to `main` in a month, so this went undiscovered until this
sprint's first-push attempt.

Build error surfaced as:
```
Dockerfile:25
RUN --mount=type=cache,target=/app/apps/web/.next/cache \
    pnpm nx run web:build --skip-nx-cache
ERROR: failed to build: failed to solve: process "/bin/sh -c pnpm nx run web:build --skip-nx-cache" did not complete successfully: exit code: 1
```

### What was verified before the halt
- **Triage (task 1):** all 3 originally-dirty files classified, nothing
  guess-committed:
  - `.incidents.jsonl`, `.metrics.jsonl` — ambient machine-written monitor
    state (matches the Step 0 allowlist pattern) — left untouched.
  - `.env.prod.bak-r2-20260724` (untracked) — a `.env.prod` backup artifact
    (named `bak-r2`, dated 2026-07-24) containing live-looking secrets; not
    gitignored by the literal `.env.prod` pattern but clearly a backup
    byproduct of prior secrets-rotation work, not unfinished code. Left
    untouched, not committed, not inspected beyond confirming it's an env
    backup (to avoid exposing secrets in this record).
  - 34 unpushed commits reviewed via `git log --oneline origin/main..HEAD`:
    no WIP-looking subjects; most recent (`96747fc`) is a well-documented,
    complete change (enables `nginx.syncOnDeploy` after confirming 0 config
    drift). No halt triggered at this stage.
- **CI (task 2):** `pnpm nx affected -t lint typecheck build test
  --base=origin/main` initially showed 90 failed API tests — traced to a
  purely local issue (no `diner-decider-postgres` container running; its
  compose-mapped host port 5435 is currently occupied by an unrelated
  project's `emit-social-postgres` container). Stood up an ephemeral
  postgres on port 5555, ran `drizzle-kit migrate` + `pnpm db:seed` (matching
  the GH Actions `test` job's own `db:migrate` + `db:seed` steps), reran: all
  green — lint clean, typecheck clean, build clean, **166/166 api tests,
  76/76 web tests, 7/7 pricing tests**. Confirms the 34 commits are not
  broken at the CI level; the port collision was a pure local-machine
  artifact, not a code issue.
- **First push attempt (task 3):** pushed with `DATABASE_URL` pointed at the
  ephemeral seeded DB so the pre-push hook's own CI phase (which shells out
  to the same `nx affected` targets) would pass. CI phase passed a second
  time inside the hook. Deploy phase: GHCR login succeeded, smart-build
  correctly detected `web` + `api` as affected since the last deployed sha
  (`3197467`) and selected both for build (not retag) — smart-build logic
  itself is working correctly. The `web` image build then failed as
  described above. **Nothing was pushed to `origin/main`** — the push was
  rejected locally by the failing husky pre-push hook (`git log --oneline -1
  origin/main` still shows `3197467`, the pre-sprint HEAD).
- Cleaned up the ephemeral test postgres container (`docker rm -f
  diner-decider-test-pg`) after the failed attempt.

### Not started
Tasks 4–6 (native Dockerfile conversion, `healthCheck.url`, second push) were
not attempted — they depend on a working first push, and the `web`
Dockerfile bug blocks any deploy (native or not) regardless of task order.

### Suggested resolution
Fix `apps/web/Dockerfile` to `COPY packages/pricing/package.json
./packages/pricing/` (before `pnpm install`) and `COPY packages/pricing
./packages/pricing` (before the build step), mirroring how
`apps/api/Dockerfile` handles `packages/db`. This is a one-line-per-stage fix
but touches one of the 34 pre-existing commits' consequences, so it's the
operator's call whether to fix it directly, land it as a tiny follow-up
commit before re-running this sprint, or fold it into a future sprint.

Also worth a look (not blocking, noted for completeness): the aborted deploy
left `.deploy-status.json` stuck at `{"status":"deploying", ...}` (step 2/3)
instead of transitioning to a `failed` status — the shared pre-push hook's
`ERR` trap doesn't appear to fire cleanly when a backgrounded `build_image`
job fails inside the `wait "$pid" || exit 1` loop in
`scripts/hooks/pre-push`. This is an emit-infra hook gap, not a
diner-decider issue; the next successful push will overwrite the stale
status either way, but the trap gap itself may be worth a small follow-up
sprint since it means `.deploy-status.json` can't always be trusted after a
failed deploy.

## Completed

**Date:** 2026-08-02

### Summary
diner-decider is now fully on the new pipeline: the 35-commit backlog (34
pre-existing + the `apps/web/Dockerfile` fix from the resumed run) shipped
through a shepherded first push, both Dockerfiles now build their `builder`
stage natively, and the project has a verified `healthCheck.url` for the
local monitor.

**Triage (folded in from the prior blocked run, not redone):** the 3
originally-dirty files were ambient (`.incidents.jsonl`, `.metrics.jsonl`)
or an untouched `.env.prod` backup byproduct (`.env.prod.bak-r2-20260724`,
left in place, not inspected beyond confirming it's a secrets backup, not
unfinished code) — nothing guess-committed. The 34 unpushed commits reviewed
clean (no WIP subjects). CI initially showed 90 failing API tests, traced
to a local port collision (`diner-decider`'s compose maps postgres to host
5435, already held by an unrelated `emit-social-postgres` container) rather
than a defect in the commits — worked around with an ephemeral postgres
container (`diner-decider-test-pg`, host port 5555, migrated + seeded to
match the GH Actions `test` job's own steps) for every local CI run and push
in this sprint, torn down at the end.

**First push (task 3):** the earlier blocked attempt had found `apps/web`'s
Docker build failing because `apps/web/Dockerfile` never got a `COPY
packages/pricing` after sprint 29 extracted `@diner-decider/pricing` into a
workspace package — `apps/api/Dockerfile` had the equivalent `packages/db`
copy but `web`'s was simply missing. That fix (commit `06e82ea`, pre-verified
with a full linux/amd64 buildx build before this session) was already
committed when this session resumed. Re-running the shepherded push with it
in place: CI passed inside the hook, smart-build correctly detected both
`web` and `api` as affected since the last deployed sha and built both
(not retagged), and the blue-green deploy went green cleanly — no repeat of
the earlier failure. Verified server healthy (`web` 200, `api` 200,
`docker ps` both containers up) and `.deploy-status.json` → `deployed` at
sha `06e82ea`. `phases`: `{ci: 17, auth: 1, build: 121, deploy: 91}`
(`durationSec: 213`).

**Native conversion (tasks 4-5):** audited both services before touching
anything. `apps/web`'s runner copies only the Next.js `standalone` output +
`static` + `public` — a workspace-wide dependency check found no
`sharp`/`@next/swc-*`/`esbuild`/`@parcel/watcher`/`@swc/core`-class package
in its shipped surface (root's `@swc/core` is a devDependency used by
Vitest/Next tooling at build time only, not traced into the standalone
output) — untaxed, no `supportedArchitectures` needed for it specifically.
`apps/api`'s runner is the opposite case: its Dockerfile explicitly `COPY`s
`node_modules/sharp`, `node_modules/@img`, `node_modules/detect-libc`, and
`node_modules/semver` from the builder into the runner (api uses
`sharp` for the R2 photo pipeline) — the native-module trap's "ships to
runtime" case described in `docs/PRE-PUSH-HOOK.md`. Pinned both
Dockerfiles' `builder` stage to `FROM --platform=$BUILDPLATFORM
node:24-alpine`, and added `pnpm.supportedArchitectures` (`os:
[linux, darwin, current]`, `cpu: [x64, arm64]`, `libc: [musl, glibc]`) to
the root `package.json` so both x64/arm64 `sharp` binaries install and the
correct one resolves at runtime regardless of which arch the builder ran
on. `pnpm install --frozen-lockfile` after the change confirmed the lockfile
itself needed no update (only local `node_modules` grew by 84 packages —
the extra-arch variants). Local `docker buildx build --platform linux/amd64
--load` + `docker run --platform linux/amd64` smoke tests passed for both
images before pushing: `api` loaded `sharp` cleanly (`arch: x64, platform:
linux`, no exec-format error) and failed only on expected missing env vars;
`web` served a real 200 on `/` with no env vars set.

**`healthCheck.url` (task 5):** diner-decider's nginx routes `/api/*` to the
`api` service, which exposes `/health` (used internally by blue-green's own
health check) and `/healthz`. Verified `https://dinerdecider.com/api/health`
returns 200 with a live payload (`{"status":"ok","db":"connected",...}`)
before adding `healthCheck.url: "https://dinerdecider.com/api/health"` to
`.emit-infra.json`, matching emit-vision's shape.

**Second push — the conversion commit (task 6):** pushed `e968b66` (build
348). Smart-build again correctly rebuilt both `web` and `api` (both
Dockerfiles changed) rather than retagging. Blue-green deploy went green
(`active=green -> new=blue`), both containers healthy, `healthCheck.url`
confirmed 200 post-deploy. `phases`: `{ci: 31, auth: 1, build: 110,
deploy: 82}` (`durationSec: 193`).

Before/after `phases.build`: **121s → 110s** (~9% down). This is a
cache-cold reading — pinning the builder `FROM` line invalidated the
existing layer cache for that stage, same as sprint 266's cold-cache
caveat — and diner-decider's builder stages are lighter than emit-vision's
four-service build (a two-service Nx monorepo build, not four), so the
absolute native-vs-emulation win is smaller here regardless of cache state.
Not chasing a warm-cache remeasurement or a numeric target — this sprint's
acceptance criteria (unlike sprint 266's) only calls for the before/after
numbers to be recorded honestly, which they are.

### Files changed
- `~/projects/diner-decider/apps/web/Dockerfile` — `COPY packages/pricing`
  fix (pre-existing commit `06e82ea`, verified not redone) + pin `builder`
  to `$BUILDPLATFORM`
- `~/projects/diner-decider/apps/api/Dockerfile` — pin `builder` to
  `$BUILDPLATFORM`
- `~/projects/diner-decider/package.json` — add `pnpm.supportedArchitectures`
  for `sharp`
- `~/projects/diner-decider/.emit-infra.json` — add `healthCheck.url`
- (34 pre-existing unpushed commits, triaged not authored this sprint) —
  shipped via the first push

### Verification
- Local CI (`pnpm nx affected -t lint typecheck build test
  --base=origin/main`, ephemeral seeded postgres): lint clean (1 pre-existing
  unrelated warning), typecheck clean, build clean, 166/166 api tests, 76/76
  web tests, 7/7 pricing tests
- First push: deployed `06e82ea` (build 347), `phases.build: 121s`, server
  healthy (`web` 200, `api` 200), `.deploy-status.json` → `deployed`
- Local amd64 smoke tests: `api` (`sharp` loads, exits cleanly on missing
  env), `web` (`/` → 200) — both pre-second-push
- Second push: deployed `e968b66` (build 348), smart-build rebuilt both
  services correctly, `phases.build: 110s`, server healthy, `healthCheck.url`
  → 200 post-deploy
- `pnpm test:hooks` (emit-infra, untouched by this sprint): 36/36 passed

### Follow-ups
- `[defer]` The shared pre-push hook's `.deploy-status.json` doesn't
  transition to `failed` when a backgrounded `build_image` job fails inside
  `scripts/hooks/pre-push`'s `wait "$pid" || exit 1` loop — it stays stuck
  at `deploying`. Surfaced during the earlier blocked attempt on this
  sprint; not diner-decider-specific, and the next successful push always
  overwrites the stale status, but worth a small follow-up sprint since
  `.deploy-status.json` can't always be trusted after a failed deploy.
- `[defer]` diner-decider's local dev `docker-compose.yml` maps postgres to
  a fixed host port (5435) that collides with another wired project
  (`emit-social`) whenever both are run locally — not a diner-decider bug,
  but worth noting if more projects keep landing on the same default ports.
- `[defer]` `.env.prod.bak-r2-20260724` (untracked, contains live-looking
  secrets) sits in the diner-decider working tree — not gitignored by the
  literal `.env.prod` pattern. Left untouched per this sprint's scope, but
  worth a quick look at whether the gitignore pattern should be broadened to
  `.env.prod*`.
