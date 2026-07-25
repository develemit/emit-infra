# Fix the env-file parser dropping keys that contain digits
**Difficulty:** 2

## Goal
`parseEnvFile()` in the deploy command stops silently skipping env keys that
contain a digit (`R2_BUCKET`, `S3_REGION`, …), so sprint 241's env-removal
guard stops false-positiving and blocking legitimate production deploys.

## Reason
Sprint 241 added a genuinely valuable guard: a deploy that would remove keys
from a server's `.env` now aborts unless `--allow-env-removal` is passed. The
very first time it fired in anger, it was wrong.

Deploying emit-vision on 2026-07-24 was blocked with:

```
Env file: .../infra/secrets.prod.env (32 keys) → server (37 keys)
This deploy would remove 4 key(s) present on the server .env but absent from
.../infra/secrets.prod.env:
  - R2_ACCESS_KEY_ID
  - R2_BUCKET
  - R2_ENDPOINT
  - R2_SECRET_ACCESS_KEY
```

All four keys are present in that file. The file has 36 keys, not 32. The
guard compares locally-parsed keys against server keys read over SSH with
`grep '=' | cut -d= -f1` — the shell sees digits, the local regex does not, and
the asymmetry manufactures four phantom removals.

This matters beyond one blocked deploy: the natural operator response is to
start passing `--allow-env-removal` habitually, which permanently defeats the
guard sprint 241 just built. A safety mechanism that cries wolf gets disabled.
Fixing the parser is what keeps the guard trustworthy.

Fleet projects carrying digit-containing env keys that are currently invisible
to this parser: emit-vision (4 — `R2_ENDPOINT`, `R2_BUCKET`, `R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`) and diner-decider (4). martialops also has 3, but it is
shelved and its `serverIp` was removed on 2026-07-24, so it is not deployable
and does not factor in.

## Context

**The bug** — `apps/cli/src/commands/deploy.ts`, around line 17:

```ts
function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => /^\s*[A-Z_]+=/.test(line))   // ← [A-Z_] excludes digits
      .map(line => { /* split on first '=' */ }),
  )
}
```

`R2_ENDPOINT=x` fails `/^\s*[A-Z_]+=/`; `DATABASE_URL=x` passes. Confirm with:

```bash
node -e 'const re=/^\s*[A-Z_]+=/; console.log(re.test("R2_ENDPOINT=x"), re.test("DATABASE_URL=x"))'
# => false true
```

**There is already a canonical correct pattern in this repo.**
`apps/api/src/routes/secrets.ts` (~line 42) uses
`^[A-Za-z_][A-Za-z0-9_]*=` for its empty-value detection. Match that shape
rather than inventing a new one — leading char is a letter or underscore,
subsequent chars may include digits.

**Two callers are affected, both in `deploy.ts`:**

1. `enforceEnvRemovalGuard` (~line 295) builds `localKeys` via
   `Object.keys(parseEnvFile(extraVars.env_src))`. This is the false positive.
2. `checkBackupEnv()` (~line 86–100) checks
   `BACKUP_ENV_KEYS = ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY']`.
   Two of those three contain digits, so they are *always* reported missing.
   Any project with `postgres.backupBucket` set gets a spurious "required R2
   credentials are missing" error. No project currently trips this —
   emit-vision has no `postgres` config and runs its own `pg-backup` compose
   service — so it is latent, not live.

**Parsers that are already fine — do not "fix" them:**

- `apps/cli/src/commands/secrets-sync.ts` (~line 138) has its own
  `parseEnvFile` that splits on `indexOf('=')` with no character-class filter.
  It handles digits correctly today.
- `apps/cli/src/commands/secrets-scaffold.ts` `parseKeyList()` just trims and
  filters empties — no pattern matching.
- The SSH pipelines (`grep -v '^#' … | grep '=' | cut -d= -f1`) in
  `deploy.ts`, `secrets-scaffold.ts`, and `api/src/routes/secrets.ts` are the
  de-facto correct behaviour and are the reference the local parser must agree
  with.

**Secondary inconsistency worth closing in the same pass:** `checkBackupEnv`
resolves its env file from `['.env.prod', '.env']` and ignores
`config.ci?.envFile`, while the deploy path uses
`[config.ci?.envFile, '.env.prod', '.env']`. For a project whose real server
env lives at `ci.envFile` (emit-vision: `infra/secrets.prod.env`), the backup
check reads the wrong file entirely. Sprint 242 documented that this split
exists; this is one place the two resolutions disagree by accident rather than
by design. Make `checkBackupEnv` use the same candidate list as the deploy
path.

**⚠️ Do NOT run a real `emit-infra deploy` as verification — it is not needed.**
`--dry-run` returns early at `deploy.ts:285-286` (`printDryRunPlan(...); return`),
*before* `enforceEnvRemovalGuard` runs, so a dry run genuinely cannot exercise
the guard. But the guard itself is **read-only**: `enforceEnvRemovalGuard`
(`deploy.ts:222-252`) SSHes in to read `/opt/<name>/.env` key names, prints the
key-count line, computes the diff, then either returns or `process.exit(1)`. It
never writes to the server. So call it directly to get the same end-to-end
evidence with zero production mutation — a clean return with
`allowEnvRemoval: false` is the proof. Write a throwaway ESM script and run it
with `npx tsx` (inline `-e` fails to resolve relative imports in this repo):

```ts
// /tmp/check-guard.mts
import { enforceEnvRemovalGuard, parseEnvFile } from '<abs path>/apps/cli/src/commands/deploy.js'
import { homedir } from 'node:os'; import { join } from 'node:path'
const envSrc = join(homedir(), 'projects/emit-vision/infra/secrets.prod.env')
await enforceEnvRemovalGuard({
  host: '178.105.227.175', sshKey: join(homedir(), '.ssh/emit-vision-deploy'),
  projectName: 'emit-vision', envSrc,
  localKeys: Object.keys(parseEnvFile(envSrc)), allowEnvRemoval: false,
})
console.log('guard passed — no removals')
```

emit-vision's SSH key is `emit-vision-deploy` (not the fleet default
`emit-deploy`) and its `serverIp` is `178.105.227.175` — confirm both from
`~/projects/emit-vision/.emit-infra.json` rather than hardcoding blindly.

**Testing** — `apps/cli/src/commands/deploy.test.ts` already exists and imports
`buildDeployExtraVars`, `computeEnvRemoval`, `enforceEnvRemovalGuard` from
`./deploy.js`. `parseEnvFile` is currently module-private; export it so the
regression can be asserted directly. Vitest, `describe`/`it`/`expect`,
`vi.mock('@emit-infra/core', …)` — follow the existing file's style.

## Tasks
1. Change the filter in `parseEnvFile` (`apps/cli/src/commands/deploy.ts`) to a
   pattern that admits digits after the first character, matching
   `apps/api/src/routes/secrets.ts`'s `^[A-Za-z_][A-Za-z0-9_]*=` shape. Keep
   the leading-whitespace tolerance the current regex has.
2. Export `parseEnvFile` so it can be unit-tested.
3. Update `checkBackupEnv` to resolve its env file with the same candidate list
   the deploy path uses — `[config.ci?.envFile, '.env.prod', '.env']`, first
   existing match wins — instead of `['.env.prod', '.env']`.
4. Add regression tests in `apps/cli/src/commands/deploy.test.ts`:
   - `parseEnvFile` parses `R2_BUCKET`, `R2_ACCESS_KEY_ID`, `S3_REGION` and
     other digit-containing keys.
   - `parseEnvFile` still skips comments (`# FOO=bar`) and blank/garbage lines.
   - A guard-level test: given a local file containing digit-keys and a server
     key list containing the same keys, `computeEnvRemoval` returns `[]` (this
     is the exact emit-vision false positive, pinned).
5. Grep the CLI and API for any other character-class key patterns that exclude
   digits (`[A-Z_]+=`, `[A-Za-z_]+=` without a digit class) and fix or
   explicitly note each. Leave the already-correct parsers listed in Context
   alone. **Expect this to find nothing beyond the line fixed in task 1** — this
   grep was run during sprint review on 2026-07-24 and `deploy.ts:17` was the
   only hit across `apps/` and `packages/`. It is a confirmation step, not a
   hunt; if it *does* surface something new, that is a genuine find worth
   reporting.
6. Rebuild the CLI dist (`pnpm build`) — the pre-push hook in consuming repos
   runs `node $EMIT_INFRA_DIR/apps/cli/dist/index.js deploy`, so a source-only
   fix will not reach operators.

## Files involved
- `apps/cli/src/commands/deploy.ts` — fix the `parseEnvFile` regex, export the
  function, reconcile `checkBackupEnv`'s env-file resolution
- `apps/cli/src/commands/deploy.test.ts` — add digit-key regression tests and
  the pinned `computeEnvRemoval` no-false-positive case
- `apps/api/src/routes/secrets.ts` — read-only reference for the canonical
  pattern; no change expected
- `apps/cli/src/commands/secrets-sync.ts`, `secrets-scaffold.ts` — read-only,
  confirm they are already correct; no change expected

## Acceptance criteria
- [x] `parseEnvFile` returns digit-containing keys (`R2_BUCKET`, `S3_REGION`,
      `R2_ACCESS_KEY_ID`) and still skips comments and blank lines
- [x] New regression test fails against the old `[A-Z_]+=` regex and passes
      after the fix (verify by temporarily reverting, or assert the count)
- [x] `checkBackupEnv` honours `config.ci.envFile` when set
- [ ] From `~/projects/emit-vision`, `emit-infra deploy --dry-run` reports the
      env file at **36 keys** (was 32) — **NOT MET AS WORDED, and unsatisfiable:**
      `--dry-run` prints only `Env file: <path> ✓` with no count. The key-count
      line lives at `deploy.ts:248` *inside* `enforceEnvRemovalGuard`, which
      dry-run returns before (`:285-286`) — the same structural fact that drove
      criterion 5's rewrite. Verified: dry-run output contains 0 lines matching
      `N keys`. The **substance** is fully covered by criterion 5, which printed
      `(36 keys) → server (37 keys)`. See follow-ups for the small fix that would
      make this criterion satisfiable.
- [x] `enforceEnvRemovalGuard` invoked directly against emit-vision's **real**
      server (read-only, no deploy — see Context) returns cleanly with
      `allowEnvRemoval: false`, printing `(36 keys) → server (37 keys)` and
      reporting **zero** removals
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` all clean
- [x] `pnpm build` run so `apps/cli/dist/` carries the fix

## Out of scope
- **Running a real `emit-infra deploy` against any project.** The guard is
  read-only and can be exercised directly (see Context), so a live deploy buys
  no extra confidence and would ship whatever is currently built. An earlier
  draft of this sprint required one as acceptance criterion; it was replaced
  during sprint review on 2026-07-24. Do not reintroduce it.
- Redesigning the `.env.prod` vs `ci.envFile` split itself — sprint 242
  documented it deliberately; this sprint only stops one code path from
  disagreeing with the other by accident.
- Changing the SSH-side `grep '=' | cut -d= -f1` pipelines. They are the
  reference behaviour being matched, not the thing being fixed.
- Rewriting `secrets-sync.ts`'s separate `parseEnvFile` into a shared helper.
  Consolidating the two parsers is a reasonable follow-up but is a refactor
  with its own blast radius; note it as a follow-up instead.
- Any change to lowercase-key handling. Every fleet env file uses SCREAMING_SNAKE
  today; broadening the pattern beyond digits is not required to fix this bug.


## Completed

**Date:** 2026-07-24

### Summary
One-line root fix: `parseEnvFile`'s line filter went from `/^\s*[A-Z_]+=/` to
`/^\s*[A-Za-z_][A-Za-z0-9_]*=/`, matching the shape already used by
`apps/api/src/routes/secrets.ts` and by the SSH-side `grep '=' | cut -d= -f1`
reads that the guard compares against. That asymmetry was the entire bug: the
shell saw digits, the local regex did not, and the difference manufactured four
phantom removals for emit-vision.

Also exported `parseEnvFile` for direct testing, and aligned `checkBackupEnv`'s
env-file resolution to the deploy path's `[ci.envFile, .env.prod, .env]`
precedence — it previously ignored `ci.envFile`, so for a project like
emit-vision it would have checked a different file than the one actually
deployed. That path is latent (no fleet project sets `postgres.backupBucket`)
but two of its three `BACKUP_ENV_KEYS` contain digits, so it was doubly broken.

The regression was proven, not assumed: temporarily restoring the old regex makes
the new test fail with `expected [ 'DATABASE_URL' ] to deeply equal
[ 'DATABASE_URL', …(4) ]` — precisely the four dropped keys — and it passes after
the fix. Task 5's grep found no other digit-excluding patterns, matching what the
2026-07-24 sprint review predicted.

**No production deploy was run.** The guard was exercised directly against
emit-vision's real server (it is read-only), per the criterion rewritten during
sprint review.

### Files changed
- `apps/cli/src/commands/deploy.ts` — digit-tolerant `parseEnvFile` regex, function exported, `checkBackupEnv` now honours `ci.envFile`
- `apps/cli/src/commands/deploy.test.ts` — 7 new tests: 5 for `parseEnvFile` (digits, comments/garbage, leading whitespace, missing file, agreement with the shell extraction) and 2 pinning the emit-vision false positive in both directions
- `apps/cli/dist/` — rebuilt (gitignored); verified to contain the corrected pattern and no `[A-Z_]+=`

### Verification
- `npx nx run cli:test`: 118/118 pass (was 111)
- `pnpm test`: 672 pass across 4 projects (core 29, api 337, dashboard 188, cli 118)
- `pnpm typecheck`: clean, 5/5 projects
- `pnpm lint`: clean, 5/5 projects
- Regression proven: old regex → new test fails on the 4 digit keys; new regex → passes
- Task 5 grep: no remaining `[A-Z_]+=` / digit-excluding key patterns in `apps/` or `packages/`
- `npx nx run cli:build`: success; dist contains `[A-Za-z_][A-Za-z0-9_]*=`, zero occurrences of `[A-Z_]+=`
- **Live, read-only** (criterion 5): `parseEnvFile` sees **36** keys in `infra/secrets.prod.env` including all four `R2_*` digit keys; `enforceEnvRemovalGuard` against `178.105.227.175` printed `(36 keys) → server (37 keys)` and returned cleanly with `allowEnvRemoval: false` — zero removals

### Follow-ups
- `[defer]` Criterion 4 was unsatisfiable as written: `--dry-run` prints no key count, because the count line (`deploy.ts:248`) is inside `enforceEnvRemovalGuard`, which dry-run returns before. Adding the local key count to `printDryRunPlan` would be a few lines, would make that criterion meaningful, and would let operators see the resolved count without deploying — genuinely useful given this bug was only visible via the count.
- `[defer]` `pnpm build` (the umbrella) still fails on `dashboard:build` with the known Next.js 15 `<Html> should not be imported outside of pages/_document` prerender error on `/404` and `/_error`. Pre-existing and unrelated — tracked in `backlog.md` since sprint 04 as `[hold]`. `cli:build` succeeds, so the dist this sprint needs is correct.
- `[defer]` `parseEnvFile` still exists twice (here and `secrets-sync.ts:138`, which was already digit-safe). Consolidating into one shared helper is the sprint's own noted out-of-scope refactor.
- `[defer]` `checkBackupEnv` remains module-private and calls `process.exit(1)`, so its `ci.envFile` fix is verified by inspection plus full typecheck rather than a unit test. Exporting it would make it directly testable if that path ever goes live.
