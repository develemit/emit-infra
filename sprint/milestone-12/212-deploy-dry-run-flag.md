# Sprint 212 — Deploy --dry-run flag

> _Promoted from backlog: sprint-203 follow-up, 2026-07-10._

## Goal
Add a `--dry-run` flag to the deploy command that validates generated configs and shows what would happen without making any SSH connections or changes.

## Context
Sprint 203 (new project onboarding) noted that the deploy command has no way to validate generated configs without actually deploying. A `--dry-run` mode would let the user verify that:
- The project config resolves correctly
- Compose files, nginx configs, and Ansible vars would be generated as expected
- The deploy plan (blue-green slot selection, services list, etc.) is correct

The deploy command lives in `apps/cli/src/commands/deploy.ts`.

## Tasks
1. Read `apps/cli/src/commands/deploy.ts` to understand the current deploy flow.
2. Add a `--dry-run` / `-n` flag to the CLI command definition.
3. In dry-run mode:
   - Resolve project config and display it
   - Generate all deploy artifacts (compose files, nginx config, Ansible vars) to a temp directory
   - Print the file contents or paths so the user can review
   - Show the deploy plan (target server, strategy, services, active/inactive slot if blue-green)
   - Skip all SSH/Ansible execution
4. Print a clear "DRY RUN — no changes made" banner.
5. Test the flag manually against an existing project config.

## Acceptance criteria
- [x] `emit-infra deploy <project> --dry-run` runs without SSH connections and prints the deploy plan + generated configs.
- [x] Without `--dry-run`, deploy behavior is unchanged.
- [x] The flag is documented in `--help` output.

## Completed

**Date:** 2026-07-10

### Summary
Added `-n, --dry-run` flag to `emit-infra deploy`. When set, the command resolves the project config and builds all Ansible extra-vars exactly as normal, but instead of invoking Ansible, prints a structured deploy plan: strategy, inventory path, blue-green service table, artifact file existence checks (compose files, env file, extra files), and the full set of extra-vars that would be passed to Ansible. The `checkBackupEnv` guard is skipped in dry-run mode since no actual deploy occurs. Normal deploy flow is entirely unchanged.

### Files changed
- `apps/cli/src/commands/deploy.ts` — added `printDryRunPlan` helper, `-n, --dry-run` option, and conditional branch before `runAnsible`
- `apps/cli/dist/index.js` — rebuilt bundle (esbuild)
- `sprint/212-deploy-dry-run-flag.md` — sprint completion

### Verification
- `emit-infra deploy --help`: `-n, --dry-run` flag visible in output
- `emit-infra deploy --dry-run` (emit-vision, blue-green, 4 services): printed full plan with all artifact paths resolved and file-existence ✓ checks — no SSH made
- `emit-infra deploy --dry-run` (diner-decider, blue-green, 2 services): same result
- Build: `pnpm nx build cli` — clean
- Normal deploy path: unchanged (conditional wraps only the dry-run exit)

### Follow-ups
- `[defer]` Could suppress the `GHCR_TOKEN not set` warning in dry-run mode since no docker pull occurs
