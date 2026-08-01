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
- [ ] Both projects: pushing a feature branch runs nx-affected CI via the
      shared hook (observed output, `.ci-status.json` written)
- [ ] Both projects: `git push --dry-run origin main` triggers no GHCR auth
      and no builds
- [ ] emit-social: existing `.githooks` contents and `ci.sh` accounted for in
      writing (what was kept, folded in, or retired, and why) — nothing
      load-bearing silently dropped
- [ ] If either project deploys: envFile verified against server state
      **before** the first deploy; deploy completes healthy with a `phases`
      history entry
- [ ] If emit-billing is CI-only: push to main exits with the documented
      skip message, not an error
- [ ] martialops untouched
- [ ] Test coverage: hook behavior is covered by the existing
      `scripts/lib/deploy-plan.test.sh` (must still pass); any `.emit-infra.json`
      schema addition needed along the way gets a case in
      `packages/types` tests — expected: none
- [ ] `docs/PRE-PUSH-HOOK.md` wired-projects list current

## Out of scope
- martialops (back burner, per explicit decision)
- Building deploy infrastructure for emit-billing if it has none (server,
  blueGreen config, Dockerfiles) — that's its own initiative; this sprint
  wires CI and documents the gap
- Converting either project's Dockerfiles to the sprint 255 pattern
- test-smoke and any other unwired project
