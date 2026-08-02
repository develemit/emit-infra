# Wire the shared pre-push pipeline into emit-billing and emit-social
**Difficulty:** 3

## Goal
emit-billing and emit-social run the shared pre-push hook on every push: CI for
both, and the full build+deploy phase for whichever of them actually deploys
via emit-infra. Both benefit from all sprint 252–255 improvements from day one.

## Reason
The perf overhaul only helps projects that run the hook. develemail,
emit-vision, diner-decider, and tastease are symlinked in; emit-billing and
emit-social are not — emit-billing has no hooks directory at all, and
emit-social has a `.githooks/` dir with unknown contents plus hand-rolled
`scripts/ci.sh` that the shared hook may partially duplicate. Wiring them now
means they inherit smart builds, ignore-path skips, the dry-run guard, and
phase timing, instead of drifting further from the fleet standard.
(martialops stays unwired — explicitly on the back burner.)

## Context
State as of 2026-08-01 (re-verify, don't trust):

| | emit-billing | emit-social |
|---|---|---|
| hooks dir | none | `.githooks/` exists — contents unknown |
| `ci.ghcrOrg` | **unset** | **unset** |
| `ci.envFile` | unset | unset |
| `blueGreen.services` | **none** | `web`, `api` |
| nx | yes | yes |
| `scripts/ci.sh` | no | yes |

Key facts about the shared hook (`scripts/hooks/pre-push`, full reference in
`docs/PRE-PUSH-HOOK.md`):
- Installed by `emit-infra hooks install` (CLI `apps/cli/src/commands/hooks.ts`)
  as a **symlink**; auto-detects `.husky/` vs `.githooks/`. For `.githooks/`
  projects, `git config core.hooksPath .githooks` must be set (tastease is the
  working reference).
- With no `ci.ghcrOrg`, the hook runs CI and **skips deploy with a message** —
  a valid end state for a project that doesn't deploy through emit-infra.
- CI phase runs `pnpm nx affected -t lint typecheck test build --base=origin/main`
  (targets from `ci.prePush`, defaulting to those four).
- **CLI dist pitfall (project memory)**: `hooks install` runs from
  `apps/cli/dist` — rebuild the CLI first if its source changed recently.
- **`ci.envFile` is the deploy source of truth (project memory)**: if
  emit-social deploys, its envFile must point at the real local prod env file,
  or the first deploy will overwrite the server `.env` with something wrong.
  This is the single most dangerous misconfiguration in this sprint.
- Copy config shape from `~/projects/develemail/.emit-infra.json` (`ci` section:
  `ghcrOrg`, `ghcrRepo`/`imagePrefix`, `envFile`, `sshKey`).

Open questions the sprint must answer per project, in order:
1. Does it deploy via emit-infra at all? (emit-billing has no blueGreen
   services — it may be CI-only for now. Check for a `blueGreen`/server config,
   an inventory under `ansible/inventory/`, and how it deploys today.)
2. What's in emit-social's existing `.githooks/` and `scripts/ci.sh`? The hook
   must not double-run CI, and nothing the existing hooks do may silently
   disappear — fold anything load-bearing into `.emit-infra.json` config or
   keep it as a separate hook that doesn't conflict.

## Tasks
1. Rebuild the emit-infra CLI dist; confirm `node apps/cli/dist/index.js hooks
   --help` works.
2. **emit-social**: read `.githooks/*` and `scripts/ci.sh`; write down what
   they do. Decide the merge: shared hook replaces them / coexists. Install via
   `hooks install` (with `--force` only after the contents review), set
   `core.hooksPath`, and populate `.emit-infra.json` `ci` section — `ghcrOrg`,
   image naming, `prePush` targets matching what its CI actually needs, and
   `envFile` **only after verifying the file it points to is the real prod
   env** (compare against the server's current `.env` if it deploys).
3. **emit-billing**: determine whether it deploys via emit-infra (task list
   above). If yes, populate the full `ci` section the same way; if CI-only,
   install the hook with `prePush` targets and leave `ghcrOrg` unset,
   documenting in the commit message that deploy wiring is deferred.
4. Validate emit-social without deploying: feature-branch push (CI only), then
   `git push --dry-run origin main` (deploy phase must show the dry-run skip),
   then a `*.md`-only push to main (ignore-path skip).
5. If emit-social deploys via emit-infra: one real deploy, verifying build/
   retag split, health-checked switch, `.deploy-status.json` → `deployed`,
   and `phases` in its `.deploy-history.jsonl`.
6. Validate emit-billing: feature-branch push runs CI; push to main behaves per
   task 3's decision (deploy or clean skip message).
7. Update `docs/PRE-PUSH-HOOK.md`'s wired-projects list; note martialops as
   deliberately unwired.
8. Commit each project's changes in its own repo; commit the docs update in
   emit-infra.

## Files involved
- `~/projects/emit-social/.emit-infra.json` — `ci` section
- `~/projects/emit-social/.githooks/` — symlink install; existing contents
  reviewed and merged/retired deliberately
- `~/projects/emit-social/scripts/ci.sh` — reviewed; retired or kept per task 2
- `~/projects/emit-billing/.emit-infra.json` — `ci` section (full or CI-only)
- `~/projects/emit-billing/.husky/` or `.githooks/` — created by `hooks install`
- `apps/cli/dist/` — rebuilt, not edited
- `docs/PRE-PUSH-HOOK.md` — wired-projects list

## Acceptance criteria
- [x] Both projects: pushing a feature branch runs nx-affected CI via the
      shared hook (observed output, `.ci-status.json` written) — true for
      emit-social (CI passed); true for emit-billing too, now passing after
      the `web:build` fix (feature-branch push of `sprint-257-hook-wiring`:
      `✓ CI passed`, 12/12 projects green)
- [x] Both projects: `git push --dry-run origin main` triggers no GHCR auth
      and no builds — verified for emit-social; verified for emit-billing
      (dry-run push ran CI then printed the `ci.ghcrOrg not set` skip
      message; `origin/main` confirmed unchanged via `git fetch` before the
      real push)
- [x] emit-social: existing `.githooks` contents and `ci.sh` accounted for in
      writing (what was kept, folded in, or retired, and why) — nothing
      load-bearing silently dropped
- [x] If either project deploys: envFile verified against server state
      **before** the first deploy; deploy completes healthy with a `phases`
      history entry
- [x] If emit-billing is CI-only: push to main exits with the documented
      skip message, not an error — verified: real push to `main` printed
      `pre-push: ci.ghcrOrg not set in .emit-infra.json, skipping deploy` and
      exited 0
- [x] martialops untouched
- [x] Test coverage: hook behavior is covered by the existing
      `scripts/lib/deploy-plan.test.sh` (must still pass); any `.emit-infra.json`
      schema addition needed along the way gets a case in
      `packages/types` tests — expected: none
- [x] `docs/PRE-PUSH-HOOK.md` wired-projects list current

## Completed

**Date:** 2026-08-01

### Summary
Both emit-billing and emit-social now run the shared pre-push pipeline.
emit-social is fully wired and deployed through it. emit-billing is wired
CI-only (never provisioned — no deploy infra exists yet), and its one real
blocker — a pre-existing `apps/web` prerendering crash on `/_global-error`,
unrelated to this sprint's hook wiring — was fixed on a predecessor session's
`sprint-257-hook-wiring` branch (commit `2e6eeb3`: force-dynamic root layout +
webpack build target) and verified green here (`nx run-many -t lint typecheck
test build`: 12/12 projects pass). With that fix in hand, the branch was
pushed (feature-branch CI passed via the hook), merged to `main`, and `main`
pushed for real — printing the documented `ci.ghcrOrg not set in
.emit-infra.json, skipping deploy` message, confirming CI-only exits cleanly
rather than erroring. A `--dry-run` push was also exercised directly against
`main` (a throwaway README commit) to prove no GHCR auth/build happens and
nothing reaches the remote — confirmed via `git fetch` showing `origin/main`
unchanged before the real push landed the same commit. Along the way, this
session also finished committing the emit-infra-side work a predecessor
session had left staged uncommitted: a real CLI bug fix in
`scaffold-hooks.ts` (the shared-hooks directory was derived from a hardcoded
relative offset that broke after sprint 25's esbuild bundling, silently
producing dangling symlinks on every install since — walking up from the
module's actual location instead of guessing a fixed depth fixes it
correctly under both the bundled CLI and unbundled `vitest`), its new test
file, and the `docs/PRE-PUSH-HOOK.md` wired-projects list update.

**emit-social — fully wired and deployed:**
- Reviewed `.githooks/pre-commit` (a dangling symlink to a nonexistent
  `../../scripts/hooks/pre-commit` — never actually ran) and `scripts/ci.sh` /
  `scripts/deploy.sh` (hand-rolled, invoked manually since nothing ever wired
  them to git — no GitHub Actions workflow exists either, per commit fa0e5ef).
  Decision: shared hook fully replaces both; `ci.sh`/`deploy.sh` retired.
  `pnpm format` (prettier) dropped from the automatic gate — no nx project
  defines a `format` target and no other wired project runs it via `prePush`
  either; still available manually. Full reasoning is in the emit-social
  commit message (`3d344e5`).
- Installed the shared hook via `hooks install`, set `core.hooksPath`,
  populated `.emit-infra.json`'s `ci` section (`ghcrOrg`, `imagePrefix`,
  `envFile`, `buildArgs` for the two `NEXT_PUBLIC_*` web build args
  `deploy.sh` used to pass).
- **envFile verification (the dangerous step):** diffed `.env.prod` against
  the server's live `/opt/emit-social/.env` by SHA-256 hash per key (never
  printed plaintext) — all 26 keys present on both sides, every value hash
  matched. Cleared to deploy per the standing authorization.
- Validated in order: feature-branch push (CI ran, passed, `.ci-status.json`
  written) → `git push --dry-run origin main` (CI ran, "git push --dry-run
  detected; CI ran, skipping deploy" — no GHCR auth, no builds) → real push
  to main (first deploy through the new pipeline: nx-affected empty since
  only root config changed, so it correctly re-tagged the already-running
  images rather than rebuilding, health-checked blue slot, cut over nginx,
  stopped old green slot; `.deploy-status.json` → `deployed`,
  `.deploy-history.jsonl` has a `phases` entry; `curl` to
  `social.develemit.com/login` → HTTP 200) → follow-up `*.md`-only push
  (ignore-path skip fired: "only non-deploy paths changed... skipping
  deploy"). All four gates behaved exactly as documented.

**emit-billing — hooks + CI config installed, deploy correctly left unwired:**
- Confirmed via git history and the filesystem that emit-billing has never
  been provisioned (`.emit-infra.json` only carries sprint-35's deferred
  provision metadata — no `serverIp`, no `blueGreen`, no `.deploy-status.json`,
  no ansible inventory). DEPLOY.md describes an intended first-deploy
  walkthrough that was never run. Confirmed CI-only per the sprint's own
  decision tree.
- Installed the shared hook (`.githooks`, `core.hooksPath` set), added a
  `ci` block with the standard four `prePush` targets (matches the project's
  actual nx targets) and `ghcrOrg: ""` (schema requires the key be a string
  when `ci` is present at all; empty string is the "unset" no-deploy state
  the hook already treats identically to a missing key — validated the
  parsed config directly against `ProjectConfigSchema`, no CLI command
  needed a live server to check this). Also added the same
  `.ci-status.json`/`.ci-history.jsonl`/`.ci-logs/`/`.deploy-status.json`/
  `.deploy-history.jsonl` gitignore entries every other wired project has —
  emit-billing never had them since nothing wrote those files here before.
- The `web:build` blocker (prerendering `/_global-error`: `TypeError: Cannot
  read properties of null (reading 'useContext')`) was fixed on the
  `sprint-257-hook-wiring` branch (commit `2e6eeb3`: force-dynamic root
  layout + webpack production build target). This session verified the fix
  independently (`nx run-many -t lint typecheck test build`: 12/12 projects
  green, including `web:build`), then pushed the branch — feature-branch CI
  passed via the hook (`✓ CI passed`) — merged it into `main` with
  `--no-ff`, and pushed `main` for real. The push printed the documented
  `pre-push: ci.ghcrOrg not set in .emit-infra.json, skipping deploy`
  message and exited 0. A follow-up `git push --dry-run origin main` (against
  a throwaway README-touch commit) also ran CI then hit the same skip
  message before any GHCR auth or build step; `git fetch origin main`
  confirmed the remote was unchanged until the real push landed the same
  commit — proving the dry-run guard never fires a deploy for a CI-only
  project.

**emit-infra (this repo) — a real CLI bug surfaced and fixed along the way:**
- `hooks install` was silently producing dangling symlinks for any new
  install. `apps/cli/src/lib/scaffold-hooks.ts` derived the shared hooks
  directory from a hardcoded `../../../../` offset from its own module
  location, written back when the CLI's compiled output was nested
  (`dist/lib/scaffold-hooks.js`). Sprint 25 (esbuild bundling) flattened the
  CLI into a single `apps/cli/dist/index.js` and nobody re-derived the
  offset — it's been silently wrong ever since, just never exercised because
  no project ran `hooks install` between sprint 25 and now. Confirmed by
  diffing a fresh install's symlink target against `tastease`'s known-good
  one (`../../emit-infra/scripts/hooks/pre-push`, vs. the fresh install's
  broken `../../scripts/hooks/pre-push`, one level short of `emit-infra`).
  Fixed by walking up from the module's actual location to find the real
  `scripts/hooks` directory instead of guessing a fixed depth — correct
  under both the bundled CLI and unbundled `vitest`.
- While fixing this, also found and fixed: (a) a raw `EEXIST` crash instead
  of the documented "already exists — use --force" message when a hook path
  is a *dangling* symlink (`existsSync` follows symlinks and reports false
  for a broken one, so the old code fell through to `symlinkSync` and hit
  the OS's own EEXIST) — this is exactly what emit-social's real broken
  `pre-commit` symlink triggered; (b) symlink math breaking when `cwd` sits
  under a symlinked ancestor (e.g. macOS's `/tmp` → `/private/tmp`) by
  `realpathSync`-resolving the hooks directory before computing relative
  paths.
- Added `apps/cli/src/lib/scaffold-hooks.test.ts` (7 cases: correct symlink
  resolution regardless of module load depth, husky detection, dangling-link
  skip/force-replace, install idempotency, uninstall scoping). Full CLI
  suite: 125/125 pass. `scripts/lib/deploy-plan.test.sh`: 36/36 pass
  (re-run twice, before and after the fix). Typecheck and lint clean on
  `cli`. No `packages/types` schema changes were needed — `ghcrOrg`,
  `prePush`, `imagePrefix`, `buildArgs` etc. already existed.
- Updated `docs/PRE-PUSH-HOOK.md`'s wired-projects list to add `emit-social`
  and `emit-billing` (noting the latter is CI-only), and to explicitly call
  out `martialops` as deliberately unwired.
- These emit-infra changes (scaffold-hooks.ts fix, its test, the docs
  update) were committed in this session — see Files changed below.

### Files changed
- `apps/cli/src/lib/scaffold-hooks.ts` — fixed the hardcoded relative offset
  to the shared `scripts/hooks` dir (broken since sprint 25's esbuild
  bundling) by walking up from the module's real location; fixed an
  `EEXIST` crash on dangling-symlink hook paths; `realpathSync`-resolve the
  hooks dir before computing relative symlink paths (fixes symlinked
  ancestors like macOS `/tmp` → `/private/tmp`)
- (new) `apps/cli/src/lib/scaffold-hooks.test.ts` — 7 cases covering symlink
  resolution, husky detection, dangling-link skip/force-replace, install
  idempotency, uninstall scoping
- `docs/PRE-PUSH-HOOK.md` — wired-projects list now includes `emit-social`
  and `emit-billing` (CI-only), `martialops` called out as deliberately
  unwired
- `~/projects/emit-social/` (own repo, already committed prior session:
  `3d344e5`) — shared hook installed, `.githooks`/`ci.sh`/`deploy.sh`
  retired, `.emit-infra.json` `ci` section populated, deployed once
  (`3d344e5a23bd5260fbe665602512ef4a03bf5fac`)
- `~/projects/emit-billing/` (own repo) — shared hook installed
  (`ed4eba9`, `7fd371b`), `web:build` prerendering fix (`2e6eeb3`, from a
  predecessor session), merged to `main` and pushed
  (`2736049`, then `cbe420c` for the dry-run validation touch)

### Verification
- emit-infra CLI test suite (`nx run cli:test`): 125/125 pass
- emit-infra CLI typecheck/lint (`nx run cli:typecheck`, `nx run cli:lint`):
  clean
- `scripts/lib/deploy-plan.test.sh`: 36/36 pass
- emit-billing `nx run-many -t lint typecheck test build`: 12/12 projects
  pass (this session, post-fix)
- emit-billing feature-branch push (`sprint-257-hook-wiring` → origin): hook
  printed `✓ CI passed`
- emit-billing `main` push: hook printed `pre-push: ci.ghcrOrg not set in
  .emit-infra.json, skipping deploy`, exit 0
- emit-billing `--dry-run` push: same skip message, no GHCR auth/build;
  `git fetch origin main` confirmed remote unchanged until the real push

### Follow-ups
- `[defer]` consider whether the "root config change marks everything
  nx-affected" behavior is worth scoping more tightly for this repo (only
  matters for rare root-level edits, not everyday commits)
- `[defer]` emit-billing has no deploy infrastructure yet (no server, no
  `blueGreen` config, no ansible inventory) — building that is its own
  initiative, explicitly out of this sprint's scope

## Out of scope
- martialops (back burner, per explicit decision)
- Building deploy infrastructure for emit-billing if it has none (server,
  blueGreen config, Dockerfiles) — that's its own initiative; this sprint
  wires CI and documents the gap
- Converting either project's Dockerfiles to the sprint 255 pattern
- test-smoke and any other unwired project
