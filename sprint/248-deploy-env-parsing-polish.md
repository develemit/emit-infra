# Show the env key count in --dry-run and unify the two env-file parsers
**Difficulty:** 2

> _Promoted from sprint-244 follow-ups, 2026-08-01._

## Goal
`emit-infra deploy --dry-run` reports how many keys the resolved env file contains, and the line-parsing logic shared by the deploy and secrets-sync paths lives in one place instead of two.

## Reason
Two follow-ups from sprint 244, both in the same area.

**1. `--dry-run` hides the one number that matters.** Sprint 244 fixed a parser that silently dropped every env key containing a digit (`R2_ACCESS_KEY_ID`, `R2_BUCKET`, `R2_ENDPOINT`, `R2_SECRET_ACCESS_KEY` on emit-vision — 4 of 36 keys). That bug was only ever visible through the key count, and the count is printed at `deploy.ts:248` *inside* `enforceEnvRemovalGuard`, which `--dry-run` returns before (`deploy.ts:285-286`). So the safe, read-only, no-SSH command shows `Env file: <path> ✓` and nothing more, while the count only appears during a real deploy. Sprint 244 had to leave one acceptance criterion unchecked as unsatisfiable for exactly this reason.

The local key count needs no SSH — it is a pure read of a local file — so it belongs in `printDryRunPlan` (`deploy.ts:29`). Only the *server* count requires SSH, and that can stay behind the guard. This preserves `--dry-run`'s documented "no SSH connections" promise while making the number visible.

**2. Two parsers, two shapes.** There are two functions named `parseEnvFile`:

- `apps/cli/src/commands/deploy.ts:16` — `(path: string) => Record<string, string>`, reads the file itself
- `apps/cli/src/commands/secrets-sync.ts:138` — `(content: string) => [string, string][]`, takes already-read content

They are **not** straight duplicates — different inputs, different return shapes — so this is not a delete-one-and-repoint job. What is genuinely duplicated is the line-filtering and key/value splitting. Both were digit-safe as of sprint 244 (secrets-sync already was; deploy was fixed), but keeping two copies of that regex is how they drift apart again, and the digit bug is precisely what that drift looks like.

## Context
- **⚠️ CLI dist rebuild is mandatory.** This repo executes `apps/cli/dist`, not source. Run `npx nx run cli:build` and confirm the change is present in the built output. Stale dist has silently broken deploys here before — it is the single most common failure mode in this repo.
- **Extract the shared part, keep the wrappers.** The natural shape is one exported helper doing line-filtering plus key/value splitting (returning entries), with each call site keeping its own signature on top. Do not force both call sites onto one signature just to remove a function; that trades a small duplication for a worse API.
- **The digit-safe pattern is `/^\s*[A-Za-z_][A-Za-z0-9_]*=/`.** Whatever helper emerges must keep it, and the existing sprint-244 regression tests must still pass.
- **Where the count goes.** `printDryRunPlan(config, inventory, extraVars)` at `deploy.ts:29` already prints `Env file:    ${extraVars.env_src} ✓`. Add the local key count there. Read the file defensively — a missing or unreadable env file must not crash the dry run, which already handles the missing case with a `✗ missing` marker.
- **Don't run a live deploy as verification.** Use `--dry-run` against a real project (read-only) plus unit tests. Sprint 244 verified against emit-vision, whose `ci.envFile` is `infra/secrets.prod.env` with 36 keys — a good target, and the expected number.
- Read sprint **244**'s `## Completed` section for the parser fix and exactly why criterion 4 was left unchecked. Sprint **241** added the guard and the count line; read its `## Completed` too.

## Tasks
1. Extract the shared line-filtering / key-value-splitting logic into one exported helper, and have both `deploy.ts` and `secrets-sync.ts` use it while keeping their existing external signatures.
2. Print the resolved env file's local key count in `printDryRunPlan`, tolerating a missing or unreadable file without crashing.
3. Keep the server-side count where it is — it needs SSH and must not run during `--dry-run`.
4. Add unit tests: the shared helper stays digit-safe and skips comments and blank lines; the dry-run output includes the local count; a missing env file still renders the existing `✗ missing` path without throwing.
5. Confirm sprint 244's existing regression tests still pass unchanged.
6. Rebuild the CLI (`npx nx run cli:build`) and confirm the new dry-run output string is present in `apps/cli/dist`.
7. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across all 5 projects.
8. Verify with a real read-only `emit-infra deploy emit-vision --dry-run` that the output reports **36 keys**.

## Files involved
- `apps/cli/src/commands/deploy.ts` — `printDryRunPlan` local key count; consume the shared parser
- `apps/cli/src/commands/deploy.test.ts` — dry-run count coverage, missing-file case
- `apps/cli/src/commands/secrets-sync.ts` — consume the shared parser
- `apps/cli/src/commands/secrets-sync.test.ts` — confirm behavior is unchanged
- `apps/cli/dist/*` — rebuilt; must contain the new output

## Acceptance criteria
- [ ] `emit-infra deploy <project> --dry-run` prints the resolved env file's local key count.
- [ ] `--dry-run` still makes no SSH connections; the server-side count remains behind the guard.
- [ ] A missing or unreadable env file renders the existing `✗ missing` path without throwing.
- [ ] One shared helper provides the line-filtering / splitting logic for both call sites, each keeping its own signature.
- [ ] The digit-safe pattern is preserved and sprint 244's regression tests pass unchanged.
- [ ] `apps/cli/dist` rebuilt and contains the new dry-run output.
- [ ] Live read-only `emit-infra deploy emit-vision --dry-run` reports 36 keys.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- Changing which file `env_src` resolves to, or collapsing the `.env.prod` / `ci.envFile` split — that is the `[design]` item in `backlog.md`.
- Exporting `checkBackupEnv` for testability (separate sprint-244 follow-up).
- Running a real production deploy.
