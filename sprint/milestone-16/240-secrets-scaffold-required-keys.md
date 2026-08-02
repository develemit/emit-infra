# Add `emit-infra secrets scaffold-required-keys` to bootstrap requiredEnvKeys
**Difficulty:** 3

## Goal
A new CLI subcommand reads a project's live server `/opt/<name>/.env`, and writes the discovered key names into `requiredEnvKeys` in that project's `.emit-infra.json` — turning a 36-key manual authoring chore into one command.

## Reason
`requiredEnvKeys` is the switch that activates secrets-drift detection, and **6 of 7 projects have never set it** (verified 2026-07-24; only emit-vision, whose team hand-authored 36 keys after their outage). The reason is friction: nobody types out three dozen key names by hand, so the drift check has sat inert fleet-wide since it shipped. The emit-vision team named this directly — *"Manual authoring is exactly why nobody did it."*

This command is also the hard prerequisite for the fleet audit (sprint 243). That audit asks "which projects are missing env the app needs," and a local-vs-server key comparison **cannot** answer it — it only proves both sides agree, not that either is complete (verified: all four live projects currently agree). Only declared keys make the question answerable. So this sprint is the adoption unlock for the whole initiative.

## Context
- **Command registration gotcha.** `apps/cli/src/commands/secrets-sync.ts:10` is the **only** place that creates the `secrets` command group (`program.command('secrets')`), and `apps/cli/src/index.ts` calls `registerSecretsSync(program)`. A new file must **not** call `program.command('secrets')` again — commander would create a duplicate group. Instead: create `apps/cli/src/commands/secrets-scaffold.ts` exporting `registerSecretsScaffold(secretsCmd: Command)`, and have `registerSecretsSync` call it with its existing `secretsCmd` handle. This keeps both files small (secrets-sync.ts is currently 89 lines) and avoids the duplicate-group bug.
- **Subcommand name:** `scaffold-required-keys [name]`, so usage is `emit-infra secrets scaffold-required-keys <project>`. Match the sibling `sync [name]` signature and its `--config <path>` option.
- **Reading the server.** Follow the pattern in `apps/api/src/routes/secrets.ts:40` for the remote command, and the CLI's own SSH usage for the call. Key extraction: `grep -v '^#' /opt/<name>/.env 2>/dev/null | grep '=' | cut -d= -f1 | tr -d ' '`. Resolve the SSH key from `config.sshKeyName` and the host from `config.serverIp ?? config.domain` — the same precedence used elsewhere in the CLI and API.
- **Exclude deploy-managed keys.** `BUILD_NUMBER` is written onto the server by Ansible *after* the env copy (`ansible/roles/app-deploy/tasks/main.yml:37-43`) and is not a declared secret — it must be filtered out, or every project would immediately report spurious drift. Define the exclusion list as a named constant so it is easy to extend.
- **Writing the config.** `requiredEnvKeys` is `z.string().array().optional()` in `packages/types/src/project-config.ts`. Write keys **sorted** for a stable diff. Preserve the file's existing formatting as much as practical — read, parse, set the field, write back with `JSON.stringify(obj, null, 2)` plus a trailing newline (match what the other CLI commands that write `.emit-infra.json` do; check `init-deploy.ts` for the established shape).
- **Safety and UX.**
  - `--dry-run` prints the key list and the count without writing. Model the output on `secrets sync`'s dry-run block (`secrets-sync.ts:34-38`).
  - If `requiredEnvKeys` is already set, do not silently clobber it: print a diff (keys that would be added / removed) and require `--force` to overwrite. Declared keys may have been curated deliberately, as emit-vision's were.
  - Fail clearly if the server is unreachable or `/opt/<name>/.env` is absent — do not write an empty array.
- **⚠️ CLI dist rebuild is mandatory.** This repo executes `apps/cli/dist`, not the TypeScript source. A source change that isn't rebuilt means the command silently doesn't exist at runtime. Run `npx nx run cli:build` as an explicit task and grep the built output to confirm the new subcommand string is present. This has bitten this project before.
- **Tests:** add `apps/cli/src/commands/secrets-scaffold.test.ts`. Study `apps/cli/src/commands/secrets-sync.test.ts` for the mocking conventions (it mocks `execa` and the fs layer). Prefer extracting the pure logic — key filtering, sorting, and the added/removed diff against existing keys — into small exported functions so they can be unit-tested without SSH or a real config file. That is the house style: pure helpers, thin command shell.

## Tasks
1. Create `apps/cli/src/commands/secrets-scaffold.ts` exporting `registerSecretsScaffold(secretsCmd: Command)`, registering a `scaffold-required-keys [name]` subcommand with `--config <path>`, `--dry-run`, and `--force`.
2. Extract pure, exported helpers for the testable logic: filtering excluded keys (`BUILD_NUMBER` and any future additions), sorting, and diffing a proposed key list against an existing `requiredEnvKeys` array (returning added/removed).
3. Implement the SSH read of `/opt/<name>/.env` using `config.sshKeyName` and `config.serverIp ?? config.domain`. Error clearly on unreachable host or missing file; never write an empty array.
4. Implement the write: set `requiredEnvKeys` (sorted) in `.emit-infra.json`, preserving formatting conventions used by the other CLI writers.
5. Guard existing values: if `requiredEnvKeys` is already present, print the added/removed diff and refuse to write without `--force`.
6. Implement `--dry-run` to print the resolved key list and count without writing.
7. Wire it up: import and call `registerSecretsScaffold(secretsCmd)` from inside `registerSecretsSync` in `secrets-sync.ts` — do **not** create a second `program.command('secrets')`.
8. Add `apps/cli/src/commands/secrets-scaffold.test.ts` covering the pure helpers (exclusion filtering, sorting, diff-vs-existing) and the refuse-without-`--force` behavior.
9. Rebuild the CLI: `npx nx run cli:build`, then confirm `scaffold-required-keys` appears in `apps/cli/dist`.
10. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across **all 5 projects**.
11. Live sanity check (read-only): run with `--dry-run` against one project that has no `requiredEnvKeys` (e.g. `develemail`) and confirm it lists a plausible key set with `BUILD_NUMBER` excluded. Do **not** write any project's config in this sprint.

## Files involved
- (new file) `apps/cli/src/commands/secrets-scaffold.ts` — the subcommand plus pure helpers
- (new file) `apps/cli/src/commands/secrets-scaffold.test.ts` — unit tests for the helpers and the `--force` guard
- `apps/cli/src/commands/secrets-sync.ts` — call `registerSecretsScaffold(secretsCmd)` from the existing group
- `apps/cli/dist/*` — rebuilt output; must contain the new subcommand
- `packages/types/src/project-config.ts` — read-only reference for the `requiredEnvKeys` shape

## Acceptance criteria
- [x] `emit-infra secrets scaffold-required-keys <project> --dry-run` prints the server's key list and count without writing.
- [x] Without `--dry-run`, it writes sorted `requiredEnvKeys` into that project's `.emit-infra.json`.
- [x] `BUILD_NUMBER` is excluded from the generated list.
- [x] An existing `requiredEnvKeys` is not overwritten without `--force`; the added/removed diff is printed instead.
- [x] Unreachable host or missing server `.env` fails clearly and writes nothing.
- [x] Only one `secrets` command group exists (no duplicate commander group).
- [x] `apps/cli/dist` rebuilt and verified to contain `scaffold-required-keys`.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Completed

**Date:** 2026-07-24

### Summary
Added `emit-infra secrets scaffold-required-keys [name]`, a new subcommand registered inside the existing `secrets` command group (`secrets-sync.ts` now calls `registerSecretsScaffold(secretsCmd)` rather than creating a second `program.command('secrets')`). The command SSHes to the project's server, reads `/opt/<name>/.env` with the same `grep`/`cut` pipeline the API's drift route uses, filters out `BUILD_NUMBER` (kept as a named `Set` constant so it's easy to extend), sorts the result, and either prints it (`--dry-run`) or writes it into `requiredEnvKeys` in `.emit-infra.json`. If `requiredEnvKeys` is already non-empty, it refuses to write and instead prints an added/removed diff, requiring `--force` to proceed. All key filtering, sorting, diffing, and config-path resolution logic is factored into small exported pure functions (`parseKeyList`, `filterExcludedKeys`, `diffKeys`, `resolveConfigPath`) so they're unit-testable without SSH or a real config file, matching the "thin command shell, pure helpers" house style.

One design note: since no existing command both reads config via `loadConfig` *and* writes back to the same resolved file, `resolveConfigPath` reimplements `loadConfig`'s upward directory-walk locally (it isn't exported from `@emit-infra/core`) so the write target matches whatever `--config`/cwd resolution `loadConfig` used for the read. This keeps the change scoped to the new file rather than modifying `packages/core`.

### Files changed
- (new) `apps/cli/src/commands/secrets-scaffold.ts` — the `scaffold-required-keys` subcommand and its pure helpers
- (new) `apps/cli/src/commands/secrets-scaffold.test.ts` — 14 tests covering the pure helpers plus dry-run, write, force-guard, and unreachable-host command behavior
- `apps/cli/src/commands/secrets-sync.ts` — registers `registerSecretsScaffold(secretsCmd)` on the existing `secrets` group instead of creating a new one
- `apps/cli/dist/*` — rebuilt via `npx nx run cli:build`; confirmed `scaffold-required-keys` present in the bundled output

### Verification
- `npx vitest run apps/cli/src/commands/secrets-scaffold.test.ts apps/cli/src/commands/secrets-sync.test.ts`: 22/22 pass
- `pnpm test`: 92/92 pass across cli (types has no test target)
- `pnpm typecheck`: clean across all 5 projects
- `pnpm lint`: clean across all 5 projects
- `apps/cli/dist` rebuild: `grep -c scaffold-required-keys apps/cli/dist/index.js` → 1
- `secrets --help`: shows a single `secrets` group with both `scaffold-required-keys` and `sync` listed — no duplicate commander group
- Live read-only sanity check: `emit-infra secrets scaffold-required-keys develemail --dry-run` against the real develemail server returned 14 plausible keys (`POSTGRES_PASSWORD`, `ENCRYPTION_KEY`, `EMIT_VISION_*`, etc.) with `BUILD_NUMBER` correctly excluded; confirmed `requiredEnvKeys` remained absent from develemail's `.emit-infra.json` afterward (0 matches on grep)

### Follow-ups
- `[defer]` `resolveConfigPath` duplicates `loadConfig`'s directory-walk logic because it isn't exported from `@emit-infra/core`. If a future command needs the same read-then-write-back pattern, consider exporting a shared `resolveConfigPath`/`findConfigFile` helper from core instead of each command reimplementing it.
- `[defer]` The unreachable-host and missing-.env failure paths currently share one error message (both surface as an `sshExec` rejection). Fine for this sprint's acceptance criteria, but a future pass could distinguish "can't SSH in" from "SSH'd in fine, file just isn't there" if that distinction becomes useful for debugging.

## Out of scope
- **Actually declaring `requiredEnvKeys` for any project** — that's sprint 243, which uses this command. This sprint ships the tool and verifies it read-only via `--dry-run`.
- Empty-value detection or dashboard visibility — sprint 239.
- Any change to `secrets sync` behavior or the `secrets-apply` route — sprints 238 / 242.
- Deploy-path guardrails — sprint 241.
- Inferring required keys from application source code. Reading the live server `.env` is the pragmatic, verifiable source; source-scanning is a much larger problem.
