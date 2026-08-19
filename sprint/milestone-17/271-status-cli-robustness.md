# Sprint 271 — `emit-infra status` robustness + checkBackupEnv coverage

> _Promoted from sprint-258 and sprint-259 follow-ups, 2026-08-02._

## Goal
`emit-infra status <name>` works even when terraform prints warnings, and
`checkBackupEnv`'s exit path finally has direct unit coverage.

## Context
(1) `status` concatenates raw `terraform output` text into the SSH hostname;
a "No outputs found" warning becomes part of the hostname → "hostname
contains invalid characters" (observed on diner-decider, sprint 258). Fix:
`terraform output -json` and parse, treating empty/no-outputs as absent —
find the call site in `apps/cli/src/commands/status.ts` (or wherever the
terraform read lives; grep `terraform output`). (2) `checkBackupEnv` in
`apps/cli/src/commands/deploy.ts` is module-private with a
`process.exit(1)` path verified only by inspection (open since sprint 244).
Export it (or extract to a testable helper per house style) and test both
branches — mock `process.exit` per existing CLI test conventions
(see `deploy.test.ts`).

## Tasks
1. Fix the terraform parse with a unit test covering: normal outputs,
   no-outputs warning, malformed JSON.
2. Test `checkBackupEnv` both branches.
3. Verify `emit-infra status diner-decider` (the known repro) now works.

## Acceptance criteria
- [x] `status` on a project with no terraform outputs returns a sane result
      (no hostname corruption); test covers the warning case
- [x] `checkBackupEnv` has direct tests incl. the exit path
- [x] CLI suite + typecheck/lint green; dist rebuilt if hooks consume it

## Completed

**Date:** 2026-08-02

### Summary
`emit-infra status`'s terraform read used `terraform output -raw <key>`, which — when a project's state has no outputs at all — prints a "Warning: No outputs found" banner to **stdout** with exit code 0 (confirmed by hand with a throwaway `terraform init -backend=false && terraform apply` in an empty config: `-raw` dumps the multi-line ANSI-coded warning to stdout, `-json` cleanly returns `{}`). The old code did `result.stdout.trim() || null`, so that warning text became the "host" and `sshExec` failed downstream with "hostname contains invalid characters" — the exact failure observed on diner-decider in sprint 258.

Fixed `getTerraformOutput` in `apps/cli/src/commands/status.ts` to run `terraform output -json`, `JSON.parse` the result, and look up `outputs[key]?.value`, returning `null` for a missing key, a non-string value, an empty state (`{}`), or a JSON parse failure. Exported the function and added `status.test.ts` with `execa` mocked to cover all three requested cases (normal output, no-outputs/empty-object, malformed JSON) plus two more (key absent from a non-empty outputs object, terraform command itself failing).

`checkBackupEnv` in `deploy.ts` was module-private and only exercised the `process.exit(1)` path via the `postgres.backupBucket` config plus whichever `.env`/`.env.prod`/`ci.envFile` happened to exist in `process.cwd()` — not directly testable. Exported it and added a `cwd` parameter (default `process.cwd()`, matching `buildDeployExtraVars`'s existing pattern) so tests can point it at a `mkdtempSync` fixture directory instead of stubbing the process's real cwd. Added five direct tests: no-op when `postgres.backupBucket` is unset, no-op when all three R2 keys are present, exits 1 and names the missing keys (and doesn't miscount a present key as missing), exits 1 when no env file exists at all, and confirms `ci.envFile` takes precedence over `.env` (a decoy incomplete `.env` sits alongside a complete `ci.envFile`-declared file to prove which one is actually read).

**Real repro verified.** diner-decider's terraform state genuinely has no outputs (`terraform output -json` in `~/projects/diner-decider/terraform` returns `{}`). Before this fix that would have produced the "hostname contains invalid characters" crash; after rebuilding dist, `emit-infra status diner-decider` (run from `~/projects/diner-decider`) now cleanly prints "Could not determine server IP. Pass --host or run provision first." and exits — the sane result the acceptance criterion asks for, not a corrupted hostname.

### Files changed
- `apps/cli/src/commands/status.ts` — `getTerraformOutput` now uses `terraform output -json` + `JSON.parse` instead of `-raw <key>`; exported for direct testing
- (new) `apps/cli/src/commands/status.test.ts` — 5 tests: normal output, empty-state/no-outputs, malformed JSON, key absent, terraform command failure
- `apps/cli/src/commands/deploy.ts` — `checkBackupEnv` exported and takes an optional `cwd` param (default `process.cwd()`) instead of hardcoding `process.cwd()` internally
- `apps/cli/src/commands/deploy.test.ts` — new `checkBackupEnv` describe block (5 tests); added `checkBackupEnv` to the import and `afterEach` to the vitest import
- `apps/cli/dist/*` — rebuilt via `npx nx run cli:build` (gitignored, not committed)

### Verification
- `npx nx run cli:test`: 144/144 pass (was 132; +5 status.ts, +5 checkBackupEnv, +2 unaccounted for by other sprints landed since 259)
- `pnpm test` (all 4 testable projects): 207/207 dashboard (cached) + cli 144/144 + core/api cached green — `pnpm test` reports success for all 5 projects
- `pnpm typecheck`: clean, 5/5 projects
- `pnpm lint`: clean, 5/5 projects
- `npx nx run cli:build`: success; `apps/cli/dist/index.js` rebuilt and contains the `-json`-based parse
- **Live, read-only repro:** `terraform output -json` in diner-decider's `terraform/` dir returns `{}` (genuinely no outputs); `emit-infra status diner-decider` run from `~/projects/diner-decider` now reports "Could not determine server IP..." instead of a corrupted-hostname crash

### Follow-ups
- `[defer]` `apps/cli/src/commands/logs.ts` has an identical local `getTerraformOutput` copy-pasted from the pre-fix `status.ts` (same `-raw <key>` bug, same "No outputs found" corruption risk for `emit-infra logs` on a project with no terraform outputs). Out of this sprint's stated scope (only `status.ts` was named as the repro), but it's the same latent bug living in a second file. Worth either applying the same `-json` fix directly or extracting one shared, tested helper into `@emit-infra/core` (which already has a `getTerraformOutput`, also `-raw`-based and also affected — see next item) and having `status.ts`/`logs.ts` both consume it.
- `[defer]` `packages/core/src/terraform.ts`'s exported `getTerraformOutput` (used by `setup.ts`) also uses `-raw` and has no try/catch — it would surface the same warning-as-value bug (or throw) for a project with no terraform outputs, just in a different call path (initial setup, before any outputs normally exist). Lower urgency since `setup.ts` is provisioning a fresh server where an eventual real `server_ip` output is expected soon after, but the same root cause applies.
