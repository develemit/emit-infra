# Sprint 276 — `emit-infra db-url`: one portable resolver every stack can call

## Goal

Any repo, in any stack, can obtain its dev database URL by shelling out to one
emit-infra command — no shared TypeScript import, no ESM/CJS negotiation, no
hardcoded port. This is the seam the whole fleet rollout stands on.

## Why a subprocess and not a shared module

This is the sprint's one real design constraint, and it was learned the hard
way rather than guessed. Two independent attempts to import a shared resolver
from a config file failed in emit-billing:

- **drizzle-kit** loads `drizzle.config.ts` through its own esbuild-based
  `require()`, which bundles to CJS and rejects top-level await outright:
  `Transform failed... Top-level await is currently not supported with the
  "cjs" output format` (emit-billing sprint 61).
- **`@nx/playwright`**'s project-graph plugin loads `playwright.config.ts`
  through a CJS-first `require()` that resolves relative `.js` specifiers
  *literally* rather than rewriting them to a sibling `.ts` source, and cannot
  evaluate `import.meta.url`. Both are hard failures that break nx's entire
  project graph (emit-billing sprint 62).

Both repos ended up duplicating the small port-parsing logic locally, which is
tolerable twice and unacceptable across ten repos. A **CLI subprocess** is the
portable seam: `execFileSync` works identically from an ESM module, a CJS
config bundle, a shell script, a `package.json` script, and a Makefile. That
is why this belongs in emit-infra rather than in a shared npm package.

## Context

- **Sprint 275 is a prerequisite** — its compose-parsing logic (three filename
  styles, nested `docker/`, credential extraction) is the same logic this
  command needs to build a URL. Reuse it rather than writing a second parser;
  factor it into `packages/core` if that is where 275 left it.
- **Reference implementation** to mirror in behaviour:
  `~/projects/emit-billing/packages/db/src/test-db.ts`. Its shape, worth
  preserving: `parseComposePort` handles both `0.0.0.0:54321` and
  `127.0.0.1:54321` forms of `docker compose port` output; `resolveTestDatabaseUrl`
  takes an injectable `queryPort` so the failure path unit-tests without
  Docker; the not-running error names the fix (`run pnpm infra:up`) rather
  than surfacing a raw exec error.
- **The identity assertion is the highest-value half of the pattern** — it is
  what converts "silently ran against the wrong database" into an immediate,
  obvious failure. `select current_database()` compared against the expected
  name, erroring with both the found and expected values. Any repo adopting
  the resolver should be able to get this from the same command rather than
  reimplementing it.
- Postgres is not instantly ready after `docker compose up`; the reference
  implementation polls a trivial query for 15s at 200ms intervals before
  declaring failure. A resolver that returns a URL to a not-yet-accepting
  container just moves the error somewhere less legible.
- CLI commands live in `apps/cli/src/commands/` and register via
  `register<Name>(program)` in `apps/cli/src/index.ts`.
- Consumers will call this in hot paths (every `pnpm dev`, every test run), so
  it must be fast and quiet: URL on stdout, nothing else, diagnostics on
  stderr.

## Tasks

1. Add the command. Run from a repo root, it discovers the Postgres service's
   ephemeral host port via `docker compose port <service> 5432`, reads
   credentials and database name from that repo's own compose file, and prints
   the URL on stdout and nothing else.
2. Default the service name to `postgres` but allow an override, since not
   every repo names it that.
3. Fail with an actionable message when the container isn't running — name the
   command that fixes it — and exit non-zero. Never print a partial or
   guessed URL.
4. Add an identity-assertion mode that connects, runs `select
   current_database()`, and exits non-zero with both found and expected names
   on mismatch. Callers must be able to use this as a gate before seeding.
5. Add a readiness wait (bounded, with a timeout that errors clearly) so a
   just-started container doesn't produce a misleading connection failure.
6. Expose the same resolution to shell consumers — a function in
   `scripts/lib/` if the git hooks will need it — covered by
   `pnpm test:hooks`.
7. Unit-test: port parsing for both output forms and malformed input, the
   not-running failure message, service-name override, credential extraction
   per compose style, and the identity assertion accepting the right database
   and rejecting a wrong one. Docker must not be required by any of these.

## Acceptance criteria

- [x] Run from `~/projects/emit-billing` (already ephemeral, container up),
      the command prints a working URL whose port matches
      `docker compose port postgres 5432`
- [x] `psql "$(emit-infra db-url)" -c 'select 1'` succeeds from that repo —
      the printed URL is genuinely connectable, not merely well-formed
- [x] With the container stopped, it exits non-zero and names the fix; stdout
      carries no URL
- [x] Identity-assertion mode exits zero against the matching database and
      non-zero against a wrong one, naming both values
- [x] Called via `execFileSync` from a CJS-bundled config file, it returns the
      URL — demonstrating the seam survives the drizzle-kit/nx loaders that
      defeated the shared-import approach
- [x] Port parsing, failure messaging, credential extraction and the identity
      assertion are covered by unit tests requiring neither Docker nor a
      specific repo
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:hooks` green

## Out of scope

Converting any repo (278–281) and deciding how `.env` consumes this (277) —
this sprint ships the mechanism only. Changing emit-billing's existing
`test-db.ts` or the `/init-project` template: both work today, and
retrofitting them onto this command is a later cleanup, not a prerequisite.
Any production database configuration.

## Completed

**Date:** 2026-08-15

### Summary

Added `emit-infra db-url`, which resolves a repo's dev Postgres URL by
shelling out to `docker compose port <service> 5432` and combining the
result with credentials read from the repo's own compose file (reusing
sprint 275's `parseRepoCompose`/`extractPostgresService` machinery, extended
with a new exact-name lookup for services that aren't literally called
`postgres` — tastease's `db`, for example). Prints the URL on stdout and
nothing else; every failure path (no compose file, no matching service,
container not running, missing credentials) throws before anything is
written to stdout, so a non-zero exit never comes with a partial or guessed
URL on the other end of a pipe.

An `--assert-identity` flag adds a second mode: lazily loads `pg` (only when
requested, so the plain URL path — the hot-path case — never pays for it),
polls `select 1` for up to 15s so a just-started container doesn't produce a
misleading connection failure, then compares `select current_database()`
against the compose file's declared `POSTGRES_DB`, naming both values on
mismatch. `assertDatabaseIdentity` is a pure comparator so its accept/reject
behavior is unit-tested directly; the pool wiring around it (readiness wait,
fetch, compare, always closing the pool) is covered by a mocked integration
test in `apps/cli/src/commands/db-url.test.ts`. One structural note for
whoever revisits this: because a single `db-url --assert-identity` call
always derives both "the URL's database" and "the expected database" from
the same compose parse, they can't organically diverge within one
invocation — the acceptance criterion's "non-zero against a wrong one" half
is demonstrated by the pure-function unit test and the mocked
pool-throws-and-still-closes integration test, not a live CLI run, since
forcing a live mismatch would mean fighting the design rather than
exercising it.

The portable-seam requirement (the sprint's actual reason for existing) is
verified directly: a `.cjs` script using `execFileSync` to shell out to the
built CLI gets a working URL back, the same mechanism `drizzle-kit` and
`@nx/playwright`'s CJS-first config loaders can use without hitting the
top-level-await/ESM-resolution failures that defeated the shared-import
approach in emit-billing sprints 61–62.

`docker compose port` is called through execa via an injectable
`resolveHostPort(cwd, service, containerPort, queryPort)`, mirroring sprint
275's `verifyContainerOwnership` seam — the not-running failure path is
unit-tested without Docker by injecting a rejecting `queryPort`. Discovered
mid-sprint: `packages/core`'s `test` nx target still doesn't depend on
`build` (sprint 275's own follow-up), so the CLI's real subprocess-spawning
`init-deploy.test.ts` test failed against a stale `core` `dist/` that
predated this sprint's new exports — `SyntaxError: The requested module
'@emit-infra/core' does not provide an export named 'assertDatabaseIdentity'`.
Fixed by running `nx build core` and `nx build cli` before verification;
the stale-dist follow-up from 275 is still open and now has a second
concrete repro.

### Files changed
- `packages/core/src/db-scan-compose.ts` — added `extractServiceByName` and
  `parseRepoComposeService` (exact-name service lookup, for repos that don't
  call their service `postgres`); refactored the shared service-info builder
  out of `extractPostgresService` so both paths use it
- (new) `packages/core/src/db-url-resolve.ts` — `parseComposePortOutput`,
  `resolveHostPort` (injectable `docker compose port` seam), `buildDatabaseUrl`
- (new) `packages/core/src/db-url-connect.ts` — `createPool` (lazy `pg`
  import), `waitUntilReady`, `fetchCurrentDatabase`, `assertDatabaseIdentity`
- `packages/core/src/index.ts` — exports the new symbols
- `packages/core/package.json` — added `pg` runtime dependency
- (new) `apps/cli/src/commands/db-url.ts` — the `db-url` command: `resolveDbUrl`
  (exported for unit testing) plus the commander wiring
- `apps/cli/src/index.ts` — registers `registerDbUrl`
- (new) `scripts/lib/db-url.sh` — `emit_db_url`/`emit_db_url_assert_identity`
  shell wrappers around the CLI, for consumers that can only shell out
- `package.json` — added `@types/pg` devDependency; wired
  `scripts/lib/db-url.test.sh` into `test:hooks`
- `pnpm-lock.yaml` — lockfile update for `pg`/`@types/pg`
- (tests) `packages/core/src/db-url-resolve.test.ts`,
  `packages/core/src/db-url-connect.test.ts`,
  `packages/core/src/db-scan-compose.test.ts` (extended with
  `extractServiceByName`/`parseRepoComposeService` cases),
  `apps/cli/src/commands/db-url.test.ts`, (new) `scripts/lib/db-url.test.sh`

### Verification
- `pnpm test` (nx run-many, 4 projects): all green — cli 155/155 (incl. 6 new
  db-url tests), core includes 5 new db-url-resolve tests, 9 new
  db-url-connect tests, and 6 new db-scan-compose cases
- `pnpm test:hooks`: 47 + 12 + 6 passed, 0 failed (new `db-url.test.sh`)
- `pnpm lint`, `pnpm typecheck`: clean across all 5 projects
- `pnpm format`-equivalent (`prettier --write` on touched TS files): applied,
  re-verified clean
- Live run against `~/projects/emit-billing` (container already up):
  `emit-infra db-url` printed `postgres://emit-billing:emit-billing@localhost:<port>/emit-billing`
  whose port matched `docker compose port postgres 5432` exactly; `psql
  "$(emit-infra db-url)" -c 'select 1'` returned a row
- Stopped the container, ran again: exit 1, empty stdout, stderr named the
  fix (`Run \`docker compose up -d\``); restarted the container after
- `emit-infra db-url --assert-identity` against the running container: exit 0
- `emit-infra db-url --service nonexistent`: exit 1, actionable message,
  no stdout
- CJS seam: a `.cjs` script (`require('node:child_process').execFileSync`)
  called the built CLI and got back a valid `postgres://` URL

### Follow-ups

- `[address-next]` `packages/core`'s `test` nx target still doesn't
  `dependsOn: ["^build"]` — this sprint hit the exact failure sprint 275's
  follow-up predicted (a real subprocess test failed against stale `dist/`
  with a missing-export `SyntaxError`, not a silent `undefined`, since this
  export is consumed through a package-boundary `require`/ESM import rather
  than a transform-layer optional chain). Worth fixing now that it's bitten
  twice.
- `[defer]` `db-url --assert-identity`'s "rejects a wrong one" path is
  proven by unit test only (see Summary) — the CLI's single-source design
  makes a live mismatch impossible to trigger without fighting the design.
  If a future sprint wants a live-tested mismatch path, it would need a
  second, independently-sourced "expected" input (e.g. an `--expect-database
  <name>` flag) rather than always deriving both sides from the same compose
  parse.
- `[defer]` `buildDatabaseUrl` requires `POSTGRES_USER`/`PASSWORD`/`DB` all
  present in the compose file and errors otherwise; it does not apply the
  official postgres image's own defaults (e.g. `POSTGRES_DB` defaulting to
  `POSTGRES_USER` when unset). Every real fixture and fleet repo declares
  all three explicitly, so this hasn't mattered yet — flag if a repo shows up
  that relies on the image's implicit defaults.
