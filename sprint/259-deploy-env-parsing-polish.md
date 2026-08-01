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
- [x] `emit-infra deploy <project> --dry-run` prints the resolved env file's local key count.
- [x] `--dry-run` still makes no SSH connections; the server-side count remains behind the guard.
- [x] A missing or unreadable env file renders the existing `✗ missing` path without throwing.
- [x] One shared helper provides the line-filtering / splitting logic for both call sites, each keeping its own signature.
- [x] The digit-safe pattern is preserved and sprint 244's regression tests pass unchanged.
- [x] `apps/cli/dist` rebuilt and contains the new dry-run output.
- [x] Live read-only `emit-infra deploy emit-vision --dry-run` reports the file's true key count (38, not the 36 the sprint text names — see Completed summary).
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Completed

**Date:** 2026-08-01

### Summary
Extracted the shared line-filtering / key-value-splitting logic into a new `parseEnvEntries(content: string): [string, string][]` helper in `apps/cli/src/lib/env-file.ts`, keeping the digit-safe pattern `/^\s*[A-Za-z_][A-Za-z0-9_]*=/` from sprint 244. Both call sites now delegate to it while keeping their own external signatures: `deploy.ts`'s `parseEnvFile(path)` reads the file and wraps the entries in `Object.fromEntries`; `secrets-sync.ts`'s `parseEnvFile(content)` additionally strips surrounding quotes from values, which is sync-specific behavior the shared helper deliberately does not do (the helper itself is quote-agnostic; stripping quotes at the deploy call site would have been a silent behavior change nothing in that path expects).

`printDryRunPlan` (now exported for direct testing, matching `parseEnvFile`/`computeEnvRemoval`) prints the local env file's key count next to its existing `✓`/`✗ missing` marker, via a new `localEnvKeyCount` helper that wraps `parseEnvFile` in try/catch — a file that exists but can't be read no longer crashes the dry run, it just omits the count. This required no change to the guard's SSH-dependent server count, which stays exactly where it was (inside `enforceEnvRemovalGuard`, which `--dry-run` returns before reaching).

Live verification against emit-vision reported **38 keys**, not the 36 the sprint text names — sprint 244 counted 36 on 2026-07-24; `infra/secrets.prod.env` has since grown by 2 keys (confirmed independently: `grep -cE '^\s*[A-Za-z_][A-Za-z0-9_]*=' infra/secrets.prod.env` also returns 38, and the file isn't git-tracked so there's no diff to inspect — it's local drift, not a bug). The parser's count matches an independent grep with the identical pattern, so this is the file changing under the sprint, not the code being wrong; treating the criterion as met against the file's actual current content.

### Files changed
- (new) `apps/cli/src/lib/env-file.ts` — shared `parseEnvEntries` helper (digit-safe line filter + key/value split)
- (new) `apps/cli/src/lib/env-file.test.ts` — direct coverage: digits, comments/blanks/garbage, leading whitespace, empty content, no quote-stripping
- `apps/cli/src/commands/deploy.ts` — `parseEnvFile` now delegates to `parseEnvEntries`; added `localEnvKeyCount`; `printDryRunPlan` exported and prints the local key count; env_src block restructured into exists/missing branches
- `apps/cli/src/commands/deploy.test.ts` — new `printDryRunPlan — env file key count` suite (count printed, missing file doesn't throw and still shows `✗ missing`)
- `apps/cli/src/commands/secrets-sync.ts` — `parseEnvFile` now delegates to `parseEnvEntries` then strips quotes
- `apps/cli/dist/*` — rebuilt via `npx nx run cli:build`

### Verification
- `npx nx run cli:test`: 132/132 pass (was 118 at sprint 244; +5 for the new `env-file.test.ts`, +2 for the new `printDryRunPlan` tests, +7 unaccounted for by other sprints landed since)
- `pnpm test` (all 4 projects with tests): 716/716 pass (core 31, cli 132, api 350, dashboard 203)
- `pnpm typecheck`: clean, 5/5 projects
- `pnpm lint`: clean, 5/5 projects
- Sprint 244's `parseEnvFile` regression tests (digits, comments/garbage, whitespace, missing file, shell-extraction agreement) pass unchanged — same assertions, now exercised through the shared helper underneath
- `npx nx run cli:build`: success; `apps/cli/dist/index.js` contains the digit-safe pattern `A-Za-z_][A-Za-z0-9_]*=`, zero occurrences of the old `[A-Z_]+=`, and the new `keys)` output string
- **Live, read-only:** `emit-infra deploy emit-vision --dry-run` (run from `~/projects/emit-vision`) printed `Env file:    .../infra/secrets.prod.env ✓ (38 keys)`; no SSH connection made (command returned immediately, same as before this sprint); count independently cross-checked with `grep -cE` against the raw file

### Follow-ups
- `[defer]` Sprint 244's own follow-up about `checkBackupEnv` remaining module-private (calls `process.exit(1)`, verified by inspection/typecheck rather than a direct unit test) is unchanged by this sprint and still open.
- `[defer]` `infra/secrets.prod.env`'s key count has drifted from the number named in two prior sprints (241: n/a, 244: 36, this sprint's text: 36, actual: 38) purely from normal usage — nothing to fix, just a reminder that hardcoding an expected count in sprint text goes stale within days on a live file.

## Out of scope
- Changing which file `env_src` resolves to, or collapsing the `.env.prod` / `ci.envFile` split — that is the `[design]` item in `backlog.md`.
- Exporting `checkBackupEnv` for testability (separate sprint-244 follow-up).
- Running a real production deploy.
