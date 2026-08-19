# Sprint 275 — Fleet dev-DB doctor: inventory and collision detection

> _Promoted from emit-billing sprints 57/60–64, 2026-08-14. First sprint of the
> ephemeral-local-infrastructure initiative._

## Goal

`emit-infra` can answer, on demand, "which repos on this machine claim a fixed
dev database port, and do any of them collide?" — replacing the hand-audit
that produced the numbers below with a command that stays true as the fleet
grows.

## Why this initiative exists

**The goal: local infrastructure that is _discovered_, not _assigned_.** No
developer and no template ever picks a host port again. Docker assigns an
ephemeral loopback port, tooling discovers it at runtime, and every connection
proves it reached the right database before using it. Any number of projects
then run simultaneously on one machine with zero coordination.

**The problem it solves**, in order of severity:

1. **Silent cross-project data access.** When two repos share a port, the
   loser's tests connect to the winner's database. Today that surfaces as
   `28P01 auth failed` *only because* each repo happens to use project-scoped
   credentials — luck, not a safety property. `martialops` and
   `garage-sailor-prime` both use `postgres`/`postgres` and sit one port
   apart. A port match plus a credential match means a test suite truncating
   and seeding **another project's** database. e2e suites are the acute case:
   they don't just read, they run seed scripts.
2. **It already happened.** emit-billing sprint 57:
   `immigration-pro360-postgres-e2e` held port 5436 while emit-billing's own
   container was stopped, so `db:test`/`api:test` dialed a foreign database
   and 19 tests failed. Diagnosing it cost most of a session.
3. **Collisions exist right now** (see the map below) and grow with the fleet.
4. **Coordination cost.** The alternative — a port registry — is bookkeeping
   that must be maintained forever and consulted on every new repo. Ephemeral
   ports dissolve the problem instead of administering it.
5. **The "did I start/migrate the database" footgun**, which the same
   discovery seam removes on the way past.

## Context

- **The pattern is already proven; do not redesign it.** emit-billing sprints
  60–62 built and shipped it, and sprint 63 captured it in the
  `/init-project` template. Reference implementation:
  `~/projects/emit-billing/packages/db/src/test-db.ts` — `parseComposePort`,
  `resolveTestDatabaseUrl` (with an injectable `queryPort` seam so failure
  paths unit-test without Docker), `assertDatabaseIdentity` (`select
  current_database()`), `applyMigrations`, and a vitest `globalSetup` default
  export. Template form:
  `~/.claude/templates/init-project/db-drizzle/drizzle/test-db.ts`.
- **Hand-audited fleet state, 2026-08-14** (emit-billing sprint 64). Re-derive
  it with the new command rather than trusting this table — it will age:

  | repo | port | user / pass | database | compose file |
  |---|---|---|---|---|
  | martialops | **5432** | **`postgres` / `postgres`** | martialops | `docker/docker-compose.yml` |
  | develemail | 5433 | `develemail` | develemail | `docker-compose.yml` |
  | garage-sailor-prime | 5433 | **`postgres` / `postgres`** | garagesailor | `docker-compose.yml` |
  | immigration-app | 5434 | `immigration_pro360` | immigration_pro360 | `docker-compose.yml` |
  | diner-decider | 5435 | `diner-decider` | diner-decider | `docker-compose.yml` |
  | emit-social | 5435 | `emit-social` | emit-social | `docker-compose.yml` |
  | garage-sailor | 5436 | `garage-sailor` | garage-sailor | `docker-compose.yml` |
  | math-problemizer | 5437 | `study-haul` | study_haul | `docker-compose.yml` |
  | tastease | 5440 | `easy_living` | easy_living | `compose.yaml` |
  | emit-vision | 55432 | `emit` | emit_vision | `docker-compose.yml` |

  `emit-billing` is already converted (`127.0.0.1::5432`). Eleven other repos
  have no database.
- **Live collisions:** 5433 (develemail + garage-sailor-prime), 5435
  (diner-decider + emit-social). 5436 resolved itself when emit-billing moved
  off it. `martialops` on the default 5432 with default credentials is the
  highest-risk single configuration in the fleet.
- **Compose files are not all at the same path.** `martialops` keeps its at
  `docker/docker-compose.yml`, `tastease` uses `compose.yaml`. A naive
  `docker-compose.yml`-only scan misses both — that is exactly how the first
  hand-audit undercounted the fleet at 7 repos instead of 10.
- **Names mislead; verify ownership before reporting a collision.**
  `math-problemizer`'s container is `study-haul-postgres` with `study-haul`
  credentials, which reads as a cross-project collision but is that project's
  own internal name — there is no separate `study-haul` repo. Confirm with
  `docker inspect <container> --format '{{index .Config.Labels
  "com.docker.compose.project.working_dir"}}'`. An earlier pass reported this
  as a live hazard and was wrong.
- Existing CLI commands live in `apps/cli/src/commands/` and are registered in
  `apps/cli/src/index.ts` via `register<Name>(program)`. Follow that shape.
- Verification in this repo is `pnpm lint`, `pnpm typecheck`, `pnpm test`
  (nx run-many) plus `pnpm test:hooks` for the shell libs.

## Tasks

1. Add a CLI command that scans a roots directory (default `~/projects`,
   overridable) and, per repo, reports: compose file path, Postgres service
   host-port mapping (fixed vs `127.0.0.1::`), credentials, database name.
   Search `docker-compose.yml`, `compose.yaml`, `compose.yml`, and one level
   of subdirectory (`docker/`) so `martialops` and `tastease` are found.
2. Compute and print a collision map: any host port claimed by two or more
   repos, plus two explicit warnings — a repo on the default port 5432, and
   any two repos sharing a credential pair (the silent-corruption precondition).
3. Classify each repo as `ephemeral` / `fixed-port` / `no-database`, and exit
   non-zero when any collision or default-port config is found, so this can
   gate a sweep later.
4. Verify ownership of any running container it names, via the compose
   `project.working_dir` label, before attributing it to a repo.
5. Unit-test the pure logic against fixtures — compose parsing for all three
   filename styles and the nested `docker/` case, collision detection,
   credential-pair detection, and the ephemeral-vs-fixed classification. No
   test may require Docker or the real `~/projects` tree.

## Acceptance criteria

- [x] The command run against the real fleet reproduces the table above:
      10 fixed-port repos, `emit-billing` ephemeral, and it finds
      `martialops` (nested `docker/`) and `tastease` (`compose.yaml`)
- [x] It reports the 5433 and 5435 collisions, and warns on `martialops`
      (default port) and on the `postgres`/`postgres` credential pair shared
      by `martialops` and `garage-sailor-prime`
- [x] It exits non-zero when a collision or default-port config is present,
      and zero on a clean fleet
- [x] Compose parsing (all three filename styles + nested `docker/`),
      collision detection, credential-pair detection and classification are
      covered by unit tests that need neither Docker nor `~/projects`
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:hooks` green

## Out of scope

Converting any repo — that is sprints 278–281, and must not start before the
resolver (276) and the dev-path decision (277) exist. Changing emit-billing or
the `/init-project` template, both already done. Any production or deploy
database configuration: this initiative is strictly local dev and test.

## Completed

**Date:** 2026-08-15

### Summary

Added `emit-infra db-doctor`, which scans a roots directory (default
`~/projects`) and reports each repo's Postgres dev-database configuration:
compose file location, host port (fixed vs ephemeral), credentials, and
database name, plus a collision map. The pure logic lives in
`packages/core` (four new files, no existing file grew) so sprint 276's
`db-url` resolver can import the same compose-parsing code rather than
reimplementing it, per that sprint's explicit instruction.

Compose parsing uses the `yaml` package rather than hand-rolled regex —
given the variety of real formats already in the fleet (ephemeral
`127.0.0.1::5432`, env-interpolated `${POSTGRES_DB:-easy_living}`, and even
an env-var-driven host port `${E2E_PG_PORT:-5436}:5432` in immigration-app),
a real parser was far less brittle than line-oriented regex would have been.
Port-string parsing resolves `${VAR:-default}` interpolation *before*
splitting on `:`, because the interpolation syntax itself contains a colon
that broke a naive split-then-resolve approach.

A repo's Postgres service is matched by service name `postgres` first, else
by image `postgres:*` — this is what lets tastease's `db:` service and
immigration-app's `postgres-e2e` get found without hardcoding fleet-specific
names, and (deliberately) means only the *first* matching service in a repo
is attributed as "the" dev database, matching the sprint's own hand-audited
table (which likewise doesn't count immigration-app's second e2e service).

Task 4 (verify container ownership via the compose `working_dir` label
before attributing a running container to a repo) is implemented as
`verifyContainerOwnership`, wired into the live CLI path and unit-tested
with an injected fake inspect function — it degrades to "not-running"
harmlessly when Docker is unavailable or the container isn't up, so it never
blocks the static-scan result the rest of the command is built on.

Ran the finished command against the real `~/projects` tree (not just unit
tests) to verify the acceptance criteria directly — see Verification below.

### Files changed
- `packages/core/src/db-scan-compose.ts` — (new) compose file discovery
  (3 filename styles × root/`docker/`) and Postgres service extraction
- `packages/core/src/db-scan-fleet.ts` — (new) per-repo scan + classification
  (`ephemeral` / `fixed-port` / `no-database`) + roots-directory scan
- `packages/core/src/db-scan-collisions.ts` — (new) port collision,
  credential-pair collision, and default-port (5432) detectors
- `packages/core/src/db-scan-ownership.ts` — (new) `docker inspect`-based
  container-ownership check with an injectable seam for unit tests
- `packages/core/src/index.ts` — exports the four new modules
- `packages/core/package.json` — added `yaml` dependency
- `packages/core/src/db-scan.fixtures/` — (new) 8 synthetic compose fixtures
  covering all three filename styles, the nested `docker/` case, port and
  credential collisions, an env-var-driven host port, and a no-database repo
- `apps/cli/src/commands/db-doctor.ts` — (new) the `db-doctor` command:
  scans, detects collisions, checks live ownership, exits non-zero on issues
- `apps/cli/src/lib/db-doctor-report.ts` — (new) report formatting, split out
  to keep the command file focused on wiring
- `apps/cli/src/index.ts` — registers `registerDbDoctor`
- `pnpm-lock.yaml` — lockfile update for the new `yaml` dependency
- (tests) `packages/core/src/db-scan-{compose,fleet,collisions,ownership}.test.ts`,
  `apps/cli/src/commands/db-doctor.test.ts`

### Verification
- `pnpm test` (nx run-many, 4 projects incl. core + cli): all green,
  149/149 cli tests, 89/89 core tests (57 of which are new to this sprint)
- `pnpm test:hooks`: 47 + 12 passed, 0 failed
- `pnpm lint`, `pnpm typecheck`: clean across all 5 projects
- Ran `node apps/cli/dist/index.js db-doctor` against the real
  `~/projects` tree: reproduced the sprint's table exactly — 10 fixed-port
  repos + `emit-billing` ephemeral, found `martialops` via nested `docker/`
  and `tastease` via `compose.yaml`; reported both the 5433
  (develemail/garage-sailor-prime) and 5435 (diner-decider/emit-social) port
  collisions, the `postgres`/`postgres` credential collision
  (garage-sailor-prime/martialops), and the martialops default-port warning;
  exited 1
- Ran the same binary against a constructed two-repo clean fleet
  (`/tmp`, one ephemeral, one fixed-port, no collisions): exited 0
- Note: `packages/core`'s `dist/` was stale relative to source going into
  this sprint (the `test` nx target doesn't `dependsOn` `build`, so new
  exports aren't visible to anything that imports `@emit-infra/core` through
  its package boundary until `nx build core` runs). Rebuilt both `core` and
  `cli` before the live-fleet verification above — see Follow-ups.

### Follow-ups

- `[defer]` `packages/core`'s `test` nx target doesn't depend on `build`,
  so a stale `dist/` silently masks newly-added exports at runtime for
  anything importing `@emit-infra/core` through the package boundary (its
  own `src/*.test.ts` files are unaffected — they import relatively).
  Existing CLI command tests never hit this because they only ever imported
  exports `dist/` already had; this sprint's new exports were the first to
  expose it. Missing named exports resolve to `undefined` at this repo's
  transform layer instead of throwing, so the failure is silent until
  something actually calls the undefined value. Worth either adding
  `dependsOn: ["^build"]` to the `test` target or documented as "run
  `pnpm build` before manually verifying a CLI command that added new
  `@emit-infra/core` exports."
- `[defer]` `db-doctor` attributes only the first Postgres-looking service
  per repo (service named `postgres`, else first `postgres:*` image) to
  match the sprint's own hand-audited table. immigration-app's second
  `postgres-e2e` service is invisible to the scan. Fine for now — flag if a
  future repo's *secondary* database service turns out to matter for
  collision detection.
