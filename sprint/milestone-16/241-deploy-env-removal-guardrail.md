# Guard the deploy env copy: pre-flight key diff, opt-in removal, server backup
**Difficulty:** 4

## Goal
A deploy that would remove keys from a server's `/opt/<name>/.env` must fail loudly by default, naming the keys. Removing a production secret should require an explicit `--allow-env-removal`. The resolved `env_src` and a key-count delta should be visible in **normal** deploy output, not only `--dry-run`.

## Reason
`ansible/roles/app-deploy/tasks/main.yml:29-36` copies `{{ env_src }}` wholesale over `{{ app_dir }}/.env` with **no comparison** against what is already on the server, and `apps/cli/src/commands/deploy.ts:143` picks `env_src` from `[config.ci?.envFile, '.env.prod', '.env']` — first match wins. A config-precedence detail nobody would think to check therefore controls whether production secrets survive a deploy.

**Verified nuance — this is latent, not currently firing.** An audit of all four live projects on 2026-07-24 found every project's resolved `env_src` is a superset of its server `.env` (the only server-extra key is `BUILD_NUMBER`, which Ansible adds *after* the copy at `main.yml:37-43`). Nothing would lose secrets on today's next deploy. But the hazard is one rename away: emit-vision's `ci.envFile` is `infra/secrets.prod.env` (36 keys) while the repo also contains a `.env.prod` with only **9** keys. If `ci.envFile` were unset, renamed, or removed, the deploy would silently select the 9-key file and destroy 27 server keys — `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET`, `CLICKHOUSE_PASSWORD`, `SSO_ENCRYPTION_KEY`, all Stripe and R2 credentials. Total outage from an invisible precedence detail. The emit-vision team only caught it by running `deploy --dry-run` and reading the resolved `env_src` — which is exactly why the resolution needs to be visible by default.

## Context
- **The Ansible copy** (`ansible/roles/app-deploy/tasks/main.yml`, "Copy .env file", ~lines 29-36): `copy: src: "{{ env_src | default('.env') }}" dest: "{{ app_dir }}/.env"`, mode `0600`, gated on `when: copy_env | default(false)`. Immediately after it, "Set BUILD_NUMBER in server .env" uses `lineinfile` (~37-43) — that is why `BUILD_NUMBER` is server-only and must be excluded from any removal comparison.
- **The CLI resolution** (`apps/cli/src/commands/deploy.ts`): `buildDeployExtraVars(config, cwd, env, existsFn)` (~line 99) is a **pure function** — that is where `env_src` / `copy_env` are set (~lines 143-150) and it is directly unit-testable. Existing tests live in `apps/cli/src/commands/deploy.test.ts`.
- **Where the pre-flight check belongs.** The comparison needs the server's current keys, which means SSH — so it cannot live inside the pure `buildDeployExtraVars`. Put it in the deploy command's action path (before Ansible runs), or as an Ansible pre-task. **Prefer the CLI**: it fails faster, produces a better error message, and keeps the logic unit-testable. Extract the pure part (given local keys + server keys → keys that would be removed) as an exported helper with its own tests, and keep the SSH read thin.
- **Sprint 238 precedent.** Sprint 238 solves the same "don't destroy server keys" problem for the `secrets-apply` API route by switching to merge semantics. This sprint deliberately keeps the deploy path as **replace + guard**, not merge: a deploy's env file is meant to be the declared source of truth, so silently merging would hide genuine intent to remove a key. Fail loudly, allow explicit override. Read 238's `## Completed` section if it has landed, and reuse its backup-naming convention for consistency.
- **Existing dry-run output** already reports the env file with an existence check (`deploy.ts`, in the "Deploy artifacts:" block: `Env file:    ${extraVars.env_src} ✓/✗ missing`). The gap is that this only prints under `--dry-run` (`-n, --dry-run` at ~line 212). Normal deploys should print the resolved `env_src` plus a key-count delta (`local N keys → server M keys`).
- **Flag naming:** `--allow-env-removal`, added to the deploy command's options alongside `--dry-run`. Keep it off by default. This mirrors the sprint 232 convention of shipping risky behavior behind an explicit opt-in.
- **Backup before overwrite:** back up the server `.env` to a timestamped file before the copy. An Ansible task before the copy is the natural home (`copy` with `remote_src: true`, gated on the file existing) — mirror the backup/validate/rollback shape already used by `ansible/roles/app-deploy/tasks/sync-vhost.yml` from sprint 232.
- **⚠️ CLI dist rebuild is mandatory** — this repo runs `apps/cli/dist`. Run `npx nx run cli:build` and verify the new flag string appears in the built output. Stale dist has silently broken deploys here before.
- **Full typecheck required.** Sprint 232 broke `api:typecheck` by touching `packages/types` while only checking `cli` and `types`. Run `pnpm typecheck` across all 5 projects.
- **Do not run a live deploy** as verification. Use `--dry-run` against a real project plus unit tests. A real deploy would mutate production.

## Tasks
1. Add an exported pure helper (in `deploy.ts` or a sibling lib file) that takes the local env file's key list and the server's key list and returns the keys that would be removed, excluding `BUILD_NUMBER` and any other deploy-managed keys (use a named constant).
2. In the deploy action path, before invoking Ansible and only when `copy_env` is true, read the server's current `/opt/<name>/.env` key names over SSH (tolerate absence — a first deploy has no server file and must not be blocked).
3. If the removal set is non-empty and `--allow-env-removal` was not passed, abort the deploy with a clear error listing every key that would be removed and naming the resolved `env_src` that caused it. Exit non-zero.
4. Add the `--allow-env-removal` option to the deploy command. When passed, print a prominent warning listing the keys being removed, then proceed.
5. Print the resolved `env_src` and a key-count delta (`env_src: <path> (N keys) → server (M keys)`) in **normal** deploy output, not just `--dry-run`.
6. Add an Ansible task before the "Copy .env file" task that backs up the existing `{{ app_dir }}/.env` to a timestamped file when it exists, following the backup shape used in `sync-vhost.yml`.
7. Extend `apps/cli/src/commands/deploy.test.ts`: removal set computed correctly; `BUILD_NUMBER` excluded; empty removal set when local is a superset; first-deploy case (no server file) does not block; helper is pure and SSH-free.
8. Rebuild the CLI (`npx nx run cli:build`) and confirm `--allow-env-removal` is present in `apps/cli/dist`.
9. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across **all 5 projects**.
10. Verify with `emit-infra deploy <project> --dry-run` against a real project (read-only) that the resolved `env_src` and key-count delta print. Record output in the completion summary.

## Files involved
- `apps/cli/src/commands/deploy.ts` — pure removal-diff helper, pre-flight SSH check, `--allow-env-removal` flag, normal-output env reporting
- `apps/cli/src/commands/deploy.test.ts` — removal-diff coverage including `BUILD_NUMBER` exclusion and first-deploy
- `ansible/roles/app-deploy/tasks/main.yml` — add the pre-copy backup task
- `ansible/roles/app-deploy/tasks/sync-vhost.yml` — read-only reference for the backup pattern
- `apps/cli/dist/*` — rebuilt; must contain the new flag

## Acceptance criteria
- [x] A deploy whose `env_src` lacks keys present on the server aborts non-zero by default, listing the key names and the resolved `env_src`.
- [x] `--allow-env-removal` permits it, printing a prominent warning naming the removed keys.
- [x] `BUILD_NUMBER` never counts as a removal.
- [x] A first deploy (no existing server `.env`) is not blocked.
- [x] Normal (non-dry-run) deploy output shows the resolved `env_src` and a key-count delta.
- [x] The server `.env` is backed up to a timestamped file before the copy when it exists.
- [x] The removal-diff logic is a pure, unit-tested function with no SSH dependency.
- [x] `apps/cli/dist` rebuilt and contains `--allow-env-removal`.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- Changing which file `env_src` resolves to, or collapsing the two-file split — that's sprint 242's analysis.
- The `secrets-apply` API route — sprint 238 (merge semantics there; replace-plus-guard here, deliberately).
- Empty-value drift detection — sprint 239.
- Running a real production deploy as verification.
- Auto-merging the two env files.

## Completed

**Date:** 2026-07-24

### Summary
Added a pre-flight guard to the `deploy` command that refuses to overwrite server secrets it can't see locally. `computeEnvRemoval(localKeys, serverKeys)` in `apps/cli/src/commands/deploy.ts` is a pure, exported function that returns the server-only keys a deploy would delete, reusing `filterExcludedKeys`/`parseKeyList` from `secrets-scaffold.ts` so the `BUILD_NUMBER` exclusion lives in one place rather than being duplicated. The SSH-dependent half (`readServerEnvKeys`, thin wrapper around `sshExec`) and the orchestration (`enforceEnvRemovalGuard`) are separate so the diff logic stays unit-testable without mocking SSH.

`enforceEnvRemovalGuard` runs only in the real (non-dry-run) deploy path, right before `runAnsible`, and only when `copy_env` is true. It always prints `Env file:    <env_src> (N keys) → server (M keys)` (satisfying the "visible by default" goal from the sprint's motivating incident), then aborts with `process.exit(1)` and the full list of keys-that-would-be-lost unless `--allow-env-removal` is passed, in which case it prints the same list as a warning and proceeds. An unreachable host during the pre-flight SSH read is treated as a hard abort (not silently tolerated) since Ansible would fail moments later anyway and a clear message here is more useful than a raw SSH stack trace.

Deliberately kept the guard SSH-free during `--dry-run`: the flag's own help text promises "no SSH connections," and the key-count delta requires exactly the SSH read `--dry-run` exists to avoid. Verified the dry-run path still resolves and prints `env_src` correctly against the real emit-vision project (see below) — this is the config that motivated the sprint (`ci.envFile` resolving to the 36-key `secrets.prod.env`, not the 9-key `.env.prod`), confirming the precedence bug is still latent-but-not-firing. The SSH-dependent guard behavior (abort / allow / first-deploy / unreachable-host) is covered instead by `enforceEnvRemovalGuard` unit tests with a mocked `sshExec`, per the sprint's explicit "no live deploy" constraint.

On the Ansible side, added a `stat` + timestamp + `copy remote_src: true` sequence before "Copy .env file" in `ansible/roles/app-deploy/tasks/main.yml`, mirroring the backup shape in `sync-vhost.yml` (sprint 232) and the `.bak-<YYYYMMDDHHMMSS>` naming convention from sprint 238's `secrets-apply` route. The backup task is skipped entirely on a first deploy (`env_stat.stat.exists` false) and skipped when `copy_env` is false. Verified with `ansible-playbook --syntax-check` (no live run, per sprint constraint).

### Files changed
- `apps/cli/src/commands/deploy.ts` — added `computeEnvRemoval`, `readServerEnvKeys`, `enforceEnvRemovalGuard`; wired the guard into the non-dry-run action path; added `--allow-env-removal` option
- `apps/cli/src/commands/deploy.test.ts` — added `computeEnvRemoval` pure-function coverage and `enforceEnvRemovalGuard` coverage (abort, allow-with-warning, first-deploy, `BUILD_NUMBER` exclusion, unreachable host, printed env_src/key-count delta)
- `ansible/roles/app-deploy/tasks/main.yml` — added stat/timestamp/backup tasks before the "Copy .env file" task
- `apps/cli/dist/*` — rebuilt via `npx nx run cli:build`; contains `--allow-env-removal`

### Verification
- `pnpm test` (via `nx run-many -t test`): 646 tests pass across `core` (17), `cli` (104), `api` (337), `dashboard` (188)
- `pnpm typecheck` / `pnpm lint` (via `nx run-many -t typecheck,lint`): clean across all 5 projects (`types`, `core`, `api`, `cli`, `dashboard`)
- `apps/cli/dist/index.js` confirmed to contain `--allow-env-removal` after rebuild
- `ansible-playbook --syntax-check -i ansible/inventory.ini ansible/playbooks/deploy.yml`: passes
- Live `emit-infra deploy emit-vision --dry-run` (read-only, no SSH): resolved `env_src` printed as `/Users/emitdutcher/projects/emit-vision/infra/secrets.prod.env ✓`, matching the 36-key file the sprint's motivating incident was about, not the 9-key `.env.prod`

### Follow-ups
- `[defer]` `enforceEnvRemovalGuard` treats an unreachable SSH host as a hard abort with no distinct message from "server has unexpected removals" beyond the error text; if this pre-flight ever needs to distinguish network failures from auth failures for support purposes, the `catch` block would need the underlying error's detail surfaced rather than a single generic line.
- `[defer]` The Ansible backup task's timestamp comes from a remote `date +%Y%m%d%H%M%S` command (one extra SSH round-trip per deploy with `copy_env` set); could be replaced with `ansible_date_time` if `gather_facts: true` is ever turned on for this playbook, but that's a bigger change than this sprint's scope.
