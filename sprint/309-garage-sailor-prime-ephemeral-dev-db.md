# Convert `garage-sailor-prime` to ephemeral dev Postgres (Prisma, not Drizzle)
**Difficulty:** 4

> _Promoted from backlog: sprint-279 deferred scope, 2026-08-22._
> _Target repo: `~/projects/garage-sailor-prime` (not emit-infra)._
> _This item may benefit from `/plan-sprint "garage-sailor-prime ephemeral dev postgres"` — sprint 279 mis-scoped it once already, and it needs a 280/281-shaped plan rather than a one-line port change._

## Goal
`garage-sailor-prime` publishes its dev Postgres on an ephemeral loopback port
with a real test bootstrap, and — together with sprint 308 — `db-doctor` reports
the fleet clean.

## Reason
Sprint 279 dropped this repo believing it had no database-touching tests. That
was wrong: `apps/api/src/routes/listings.test.ts` imports `prisma` from
`../lib/prisma.js`, so its tests **do** open a database and it needs the full
bootstrap treatment (discovery + readiness wait + identity assertion +
migrations), not just a compose-file edit.

It also shares `postgres`/`postgres` credentials with `martialops`. Today they
sit on different ports, and the silent-cross-write precondition needs a port
match *and* a credential match — so this is safe by coincidence, not by design.
It's the second of the two repos `db-doctor` is currently expected to keep
failing on.

## Context

### The Prisma difference — read this before copying anything
Every existing reference implementation in this fleet is **Drizzle**:
emit-billing's `packages/db/src/test-db.ts`, develemail's, diner-decider's.
garage-sailor-prime uses **Prisma**. The file does not transfer literally.

**Preserve the shape, not the file:**
1. Discover the host port (`docker compose port postgres 5432`, or the
   `emit-infra db-url` CLI by subprocess).
2. Wait until the container actually accepts connections.
3. **Assert identity** — `current_database()` matches what this repo expects;
   refuse to run otherwise.
4. Apply migrations (`prisma migrate deploy`, not Drizzle's runner).
5. Set `DATABASE_URL` for the test run before anything imports the client.

Step 5 is where Prisma differs most sharply: `PrismaClient` reads
`DATABASE_URL` **at construction time**, so a `globalSetup` that sets the env
var after the client module has been imported does nothing. Check how
`apps/api/src/lib/prisma.js` instantiates and exports the client — if it's a
module-level singleton, the bootstrap has to set the env var before that module
is first loaded, or the client has to become lazy. Resolve this explicitly; it
is the single most likely way this conversion silently half-works.

### Known separate breakage — do not chase it
The `mobile` Jest config is broken independently: a pre-existing
`@react-native/js-polyfills` transform failure, unrelated to anything about
databases. Confirm it fails identically on the unmodified baseline (`git
stash`), note that, and leave it alone. Sprint 281 used exactly this technique
on develemail's e2e failures.

### Fleet convention
- `docs/EPHEMERAL-DEV-DB.md` in emit-infra is the authority. New consumers call
  the `emit-infra db-url` CLI by subprocess rather than reimplementing port
  parsing; the CLI must be built in emit-infra first.
- Publish `'127.0.0.1::5432'`.
- Classify hardcoded URLs live-connection vs inert-fixture; inert fixtures get a
  non-routable host like `db.invalid`. No blanket find-and-replace.

### One bookkeeping note carried from the backlog
When promoting this repo into scope, **update the target sprint's own repo
table** rather than silently appending it — sprint 279's table is the record of
what was and wasn't converted, and an untracked addition makes that record lie.

## Tasks
1. Read `docs/EPHEMERAL-DEV-DB.md` and sprint 280/281's Completed sections for
   the established shape.
2. Confirm the `mobile` Jest failure is pre-existing via `git stash`; record it
   and exclude it from scope.
3. Switch the compose file to `'127.0.0.1::5432'`.
4. Determine how `apps/api/src/lib/prisma.js` constructs its client and whether
   `DATABASE_URL` can be injected before construction. State the answer before
   writing the bootstrap.
5. Write the test bootstrap in the Prisma idiom: discovery, readiness wait,
   identity assertion, `prisma migrate deploy`, env injection ordered correctly.
6. Classify and fix every hardcoded database URL in the repo.
7. Verify against a recreated container (`down -v`, `up`) on a different
   assigned port.
8. Confirm `apps/api/src/routes/listings.test.ts` passes against the discovered
   database and demonstrably fails the identity assertion when pointed at a
   foreign one.
9. Run `emit-infra db-doctor` — with sprint 308 done, expect a clean fleet.
10. Update sprint 279's repo table to reflect the conversion.
11. Commit in garage-sailor-prime.

## Out of scope
- The `mobile` Jest transform failure.
- `martialops` (sprint 308).
- Production/deploy database configuration.
- Migrating this repo off Prisma. It uses Prisma; the pattern adapts to it.

## Acceptance criteria
- [x] Compose publishes an ephemeral loopback port.
- [x] The test bootstrap performs all five steps, with the env-injection ordering
      problem explicitly resolved and explained.
- [x] `listings.test.ts` passes against a freshly recreated container on a
      different port than it was developed against — state both ports.
- [x] The identity assertion is shown rejecting a foreign database.
- [x] No live-connection consumer retains a hardcoded port; inert fixtures point at
      a non-routable host.
- [x] The `mobile` Jest failure is documented as pre-existing and unchanged.
- [x] `emit-infra db-doctor` reports the fleet clean (assumes sprint 308 landed; if
      it hasn't, martialops remaining is the expected sole exception).
- [x] Sprint 279's repo table updated; work committed in garage-sailor-prime.

## Completed

**Date:** 2026-08-23

### Summary

Converted `garage-sailor-prime`'s dev Postgres from a fixed `5433:5432` host
port with default `postgres/postgres` credentials to an ephemeral loopback
port (`127.0.0.1::5432`) with repo-scoped credentials
(`garagesailor/garagesailor`), plus the full test-bootstrap treatment sprint
279 found this repo actually needs (`apps/api/src/routes/listings.test.ts`
opens a real Prisma-backed Postgres connection with no graceful skip).
Credentials weren't strictly required by the acceptance criteria — no other
fleet repo currently shares `postgres/postgres` now that martialops
converted away from it in sprint 308 — but keeping it would have left the
"safe by coincidence, not by design" character this sprint's own Reason
section calls out, so it came into scope.

This is the fleet's first Prisma repo and its first repo on node's built-in
`node --test` rather than vitest — both required real adaptation, not just
porting the drizzle+vitest reference literally:

- **The env-injection ordering problem** (Task 4): `apps/api/src/lib/env.ts`
  reads `DATABASE_URL` at module-evaluation time, and `apps/api/src/lib/prisma.ts`
  constructs its `PrismaClient` singleton at module-evaluation time too — both
  execute during the *load* phase of any module that imports them, before any
  of that importing module's own top-level statements run. For `main.ts`
  (dev boot), this meant a plain "set `process.env.DATABASE_URL` as the first
  line" doesn't work: its static `import buildApp from './app.js'` already
  pulls in the whole route → service → Prisma chain before that line would
  execute. Fixed by converting that one import to
  `const { default: buildApp } = await import('./app.js')`, placed after
  resolution — defers loading the chain, not the client itself.
- **The test-bootstrap equivalent** (Task 7): node's built-in test runner has
  no vitest-style `globalSetup`, but `--import` modules preload once,
  in-process, strictly before any file passed to `--test` is loaded — proven
  empirically (a scratch reproduction) before relying on it, including that
  it holds across node:test's one-subprocess-per-file isolation. New
  `apps/api/src/test/global-setup.ts`, wired via `apps/api/package.json`'s
  `test` script, discovers the URL (`resolveDevDatabaseUrl`, which wraps
  `emit-infra db-url --assert-identity` — discovery, readiness wait, and
  identity assertion all live inside that one CLI call already), writes it
  to `process.env.DATABASE_URL`, then runs `prisma migrate deploy` so a
  fresh volume needs no manual migration step.

**Second read site** (recipe step 4): `apps/api`'s `prisma:migrate:dev` script
invokes the Prisma CLI directly, which reads `DATABASE_URL` from the shell
environment at invocation time with no JS module to hook a resolver into —
the same subprocess constraint the doc already documents for drizzle-kit.
New `tools/with-db-url.sh` (mirrors martialops' sprint-308 wrapper, minus the
`DATABASE_DIRECT_URL` export — this schema has no `directUrl`) and a new root
`db:migrate` script route through it.

**Unrelated bug found via the new resolver's own test file:**
`apps/api/package.json`'s `test` script glob (`src/**/*.test.ts`) is expanded
by `sh` (what npm runs scripts through), and POSIX `sh`'s `**` is not
recursive — it behaves like a single `*`, so it only matches files exactly
one directory below `src/`, never files sitting directly in `src/` itself.
The repo's only prior test file (`src/routes/listings.test.ts`) happened to
be one level deep, so this never surfaced. Adding
`apps/api/src/resolve-dev-database-url.test.ts` alongside its source file
(matching the fleet's colocated-test convention, and where garage-sailor's
own sprint-278 equivalent lives) silently vanished from `npm test`'s actual
output — 8 tests became 2, no error, nothing to point at. Confirmed by
running the same glob string directly under `zsh` (works, true recursive
globbing) versus through `npm run test` (sh, doesn't). Fixed by quoting the
glob in the script string so the shell passes it through unexpanded and
node's own test runner performs the recursive match instead. Documented in
`docs/EPHEMERAL-DEV-DB.md` since it's a generic npm/pnpm-script trap, not
specific to Prisma or this sprint.

**Hardcoded-URL classification:** sprint 279's audit table already recorded
`garage-sailor-prime` at "0 hardcoded-URL `.ts` files," and a fresh grep
confirmed it — the only literal-port sites were `docker-compose.yml`
(converted), `.env.example` / `.env` (converted; `.env` is untracked and
gitignored), and `apps/api/src/lib/env.ts` (the live-connection choke point,
now wired to the resolver via `main.ts`). `.planning/phases/**/*.md` contain
historical planning-phase transcripts that quote the old port/URL as part of
records of decisions already made — left untouched as inert historical
documentation, not a live config or doc a developer would follow today.

**Mobile Jest failure:** confirmed identical to sprint 279's finding —
`@react-native/js-polyfills/error-guard.js` fails Jest's transform with
`SyntaxError: Unexpected identifier 'ErrorHandler'`, unrelated to Postgres.
Re-ran on the unmodified baseline (before any of this sprint's changes) to
confirm it wasn't a regression; unchanged after.

### Files changed (garage-sailor-prime, commit `5376317`)
- `docker-compose.yml` — postgres service: ephemeral loopback port,
  `garagesailor/garagesailor` credentials (was default `postgres/postgres`)
- `apps/api/src/main.ts` — resolves + injects `DATABASE_URL` before
  dynamically importing `./app.js`
- (new) `apps/api/src/resolve-dev-database-url.ts` — `resolveDevDatabaseUrl`
  / `maybeResolveDatabaseUrl`, mirrors the martialops/garage-sailor reference
  shape with a required `cwd` param (repo root, two levels up from `apps/api`)
- (new) `apps/api/src/resolve-dev-database-url.test.ts`
- (new) `apps/api/src/test/global-setup.ts` — node:test `--import` preload:
  discover, inject, `prisma migrate deploy`
- `apps/api/package.json` — `test` script wires the `--import` preload and
  quotes the test-file glob (see the sh/`**` finding above)
- (new) `tools/with-db-url.sh` — shell wrapper for the Prisma CLI's dev-migrate
  path
- `package.json` — new `db:migrate` script routes through the wrapper
- `.env.example` — `DATABASE_URL` line removed, comment points at
  `docs/EPHEMERAL-DEV-DB.md`

### Files changed (emit-infra)
- `sprint/309-garage-sailor-prime-ephemeral-dev-db.md` — this file
- `sprint/milestone-17/279-convert-no-db-test-repos.md` — noted both
  deferrals (martialops, garage-sailor-prime) as since converted (sprints
  308, 309), per this sprint's own bookkeeping task
- `docs/EPHEMERAL-DEV-DB.md` — new section recording the node:test
  `--import`-as-globalSetup pattern, the eager-singleton dynamic-import fix,
  and the `sh`/`**` glob trap

### Verification
- **Baseline (unmodified repo, no container running):** `pnpm exec nx run
  api:test --skip-nx-cache` — red, `PrismaClientInitializationError: Can't
  reach database server at localhost:5433` (Nx's task cache initially
  masked this on the first run — a cached green result from a prior session
  with the old container up; `--skip-nx-cache` surfaced the true baseline).
  `pnpm exec nx run mobile:test --skip-nx-cache` — red,
  `SyntaxError: Unexpected identifier 'ErrorHandler'` in
  `@react-native/js-polyfills/error-guard.js`, confirmed pre-existing and
  unrelated to this sprint.
- **Discovery + identity assertion, live:** `emit-infra db-url
  --assert-identity` from the repo root resolved
  `postgres://garagesailor:garagesailor@localhost:<port>/garagesailor`.
  (First attempt after the credential change failed with `password
  authentication failed` against the *pre-existing* volume, still
  initialized with the old `postgres/postgres` user — expected, since
  Postgres only applies `POSTGRES_USER`/`POSTGRES_PASSWORD` on first init;
  `docker compose down -v` + `up` re-initialized cleanly.)
- **Identity assertion demonstrated firing:** temporarily changed
  `docker-compose.yml`'s `POSTGRES_DB` to `some_other_project` without
  recreating the running container (so the container's real database was
  still `garagesailor`); `db-url --assert-identity` refused with `Postgres
  was not ready within 15000ms: database "some_other_project" does not
  exist` — same failure surface sprint 308 (martialops) hit: Postgres's own
  "database does not exist" rejection at connect time, before
  `current_database()` is ever queried, same safety property. Reverted;
  confirmed recovery (`emit-infra db-url --assert-identity` resolved
  normally again).
- **Loud failure on a stopped container:** `docker compose stop`; `db-url
  --assert-identity` → `Could not resolve the "postgres" service's port —
  is the container running? Run \`docker compose up -d\`.` — not an opaque
  connection refusal. Restarted, confirmed recovery.
- **Teardown/rebuild, ports stated:** developed against port `58117`.
  `docker compose down -v && up -d` reassigned it to `60750` — fresh volume,
  no `DATABASE_URL` anywhere, `pnpm exec nx run api:test --skip-nx-cache`:
  8/8 pass, `prisma migrate deploy` auto-applied `20260416212155_init_listings`
  with no manual step. A later stop/start cycle reassigned the port again to
  `62449`; re-ran clean.
- **Real dev boot, no DATABASE_URL anywhere:** removed the local `.env`
  entirely (was gitignored/untracked); booted `apps/api/src/main.ts` directly
  (`PORT=4567 npx tsx src/main.ts`). `GET /health` → `{"status":"ok"}`.
  `POST /api/listings` → `201` with a real persisted row (id, timestamps from
  Postgres) — a real write against the discovered database, not just a
  liveness ping.
- `pnpm exec nx run api:test --skip-nx-cache` (post-conversion, final state):
  **8/8 passing** (2 in `listings.test.ts`, 6 in the new
  `resolve-dev-database-url.test.ts` — verified both actually ran via the
  glob-quoting fix, not silently skipped).
- `pnpm exec nx run api:lint --skip-nx-cache` (`tsc --noEmit`): clean.
- `pnpm exec nx run api:build --skip-nx-cache` (`tsc`): clean.
- `pnpm exec nx run-many -t test --skip-nx-cache`: `api` 8/8 pass; `mobile`
  fails identically to baseline (pre-existing, confirmed above); no other
  projects.
- `pnpm exec nx run-many -t lint --skip-nx-cache`: all 3 projects pass (27
  pre-existing warnings in `mobile`, 0 errors, unrelated to this sprint).
- `npm run db:migrate` (root): resolved `DATABASE_URL` via the wrapper,
  reported "Already in sync" against the already-migrated database —
  confirms the second read site is wired correctly.
- `emit-infra db-doctor`: **fleet-wide clean** — all 11 repos with a database
  show `ephemeral`, "No port or credential collisions found." (both sprint
  279 deferrals — `martialops`, sprint 308; `garage-sailor-prime`, this
  sprint — are now converted).

### Follow-ups
- `none` — no blockers, no address-next items. The Prisma-major-version
  notice (`6.19.3 -> 7.9.1`) surfaced by `npm run db:migrate` is unrelated to
  this sprint's scope (upgrading Postgres/Prisma versions is explicitly out
  of scope) and not itself actionable without a dedicated upgrade pass.
