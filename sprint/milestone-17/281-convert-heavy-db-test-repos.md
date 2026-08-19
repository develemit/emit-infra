# Sprint 281 — Convert the three heaviest database-backed repos, and close the fleet

## Goal

`math-problemizer`, `diner-decider` and `develemail` run on the ephemeral
pattern, which leaves no repo on the machine claiming a fixed dev Postgres
port. The initiative's premise — that no two projects can contend for a port,
and no suite can silently reach the wrong database — becomes true of the whole
fleet rather than most of it.

## Why these are last

They carry the most database-touching test files — `math-problemizer` 5,
`diner-decider` 7, `develemail` 8 — and `diner-decider` alone has 26 files
with hardcoded `localhost:<port>` URLs. By the time this sprint runs the
recipe has been through a pilot (278), a three-repo sweep (279) and three
lighter database conversions (280), so the remaining risk is volume rather
than design.

`develemail` and `diner-decider` are also both live production projects, which
is a second reason to do them with the recipe fully settled.

## Context

- **Sprints 275–280 are prerequisites.** `docs/EPHEMERAL-DEV-DB.md` is the
  spec; the `db-url` resolver (276) is the seam; the identity assertion is the
  non-negotiable part.
- **Repo state as audited 2026-08-14** (emit-billing sprint 64) — re-verify:

  | repo | port | user / pass | database | DB-touching test files | hardcoded-URL `.ts` files |
  |---|---|---|---|---|---|
  | math-problemizer | 5437 | `study-haul` | study_haul | 5 | 2 |
  | diner-decider | 5435 | `diner-decider` | diner-decider | 7 | 26 |
  | develemail | 5433 | `develemail` | develemail | 8 | 2 |

- **This sprint retires both remaining collisions.** `diner-decider` is the
  other half of the 5435 collision (`emit-social` converted in 280);
  `develemail` is the other half of the 5433 collision
  (`garage-sailor-prime` converted in 279).
- **`math-problemizer`'s naming is misleading and has already caused one
  false alarm.** Its container is `study-haul-postgres` with `study-haul`
  credentials and database `study_haul`, which reads as another project's
  database. It is not: `docker inspect` shows the container is started from
  `/Users/emitdutcher/projects/math-problemizer`, and no `study-haul` repo
  exists. An earlier audit reported this as a live cross-project hazard and
  was wrong. The identity assertion for this repo must expect `study_haul`,
  **not** the repo directory name — this is exactly the case where a
  name-derived expectation would break a correct setup.
- **`diner-decider`'s 26 hardcoded-URL files are the largest single batch in
  the fleet.** Classify before editing, as in sprint 279: live connections get
  the resolver, inert fixtures keep a literal on a non-routable host.
  emit-billing's equivalent audit found more than half its apparent hits were
  fixtures that must *stay* literal — `packages/config/src/env.test.ts` there
  needed a syntactically valid URL precisely because it validates the env
  schema. A blanket replace would have broken the test it exists to run.
- **`develemail` is a live mail platform** with Postfix, OpenDKIM and pgbouncer
  in its dev compose alongside Postgres. Convert the Postgres service only;
  leave the mail services' port mappings alone. Note its app connects through
  `pgbouncer`, not Postgres directly, in some configurations — confirm which
  hostname the dev path should produce before changing anything.
- Honour each repo's own `CLAUDE.md` and verification command.
- emit-infra fleet convention: **one commit per repo touched.**

## Tasks

1. Per repo, in the order `math-problemizer` → `diner-decider` →
   `develemail`: baseline its own verification command and record it. Red for
   unrelated reasons means report and skip.
2. Check each tree for unrelated uncommitted work; report and skip if dirty.
3. For `develemail`, determine whether the dev path should resolve to Postgres
   directly or through `pgbouncer`, and record the decision before converting.
4. Apply the recipe per repo: ephemeral loopback port, test bootstrap with
   discovery + readiness wait + identity assertion + migrations, dev path per
   277, hardcoded URLs classified and removed, `.env.example` and docs updated.
5. For `math-problemizer`, set the identity assertion's expected database to
   `study_haul` and add a one-line comment explaining why it does not match
   the repo name — so the next reader doesn't "fix" it.
6. For `diner-decider`, work the 26 hardcoded-URL files by classification and
   record the live-connection vs inert-fixture counts.
7. Verify per repo: suite green with no `DATABASE_URL` override, and a wrong
   database aborts before any test or seed writes.
8. **Stop-and-report guard:** if any repo materially exceeds the recipe,
   finish or cleanly back out that repo and report rather than starting the
   next. This sprint closing the fleet is not worth a half-converted
   production repo.
9. Re-run sprint 275's doctor across the whole fleet and record the after
   state next to the before state from 275.

## Acceptance criteria

- [x] `math-problemizer`, `diner-decider` and `develemail` each publish an
      ephemeral loopback Postgres port, or are reported skipped with a reason
- [x] Each converted repo passes its **own** verification command with no
      `DATABASE_URL` override — recorded per repo with its pre-change baseline
- [x] Each converted repo aborts loudly when pointed at a database whose
      identity doesn't match — name the test or check per repo
- [x] A fresh volume (`down -v` then `up`) followed by that repo's test
      command passes with no manual migrate step, per repo
- [x] `math-problemizer`'s identity assertion expects `study_haul` and carries
      the comment explaining the name mismatch
- [x] `diner-decider`'s hardcoded-URL files are each classified, with
      counts recorded, and no inert fixture was turned into a live connection
      (this repo's actual count was well under the sprint's cited ~26 — see
      Summary)
- [x] `develemail`'s mail services (Postfix, OpenDKIM, pgbouncer) are
      unchanged, and the Postgres-vs-pgbouncer decision is recorded
- [x] Exactly one commit per converted repo, each carrying the developer
      migration note
- [x] **Sprint 275's doctor reports zero collisions and zero fixed-port repos
      apart from the two known deferrals** (`martialops`, `garage-sailor-prime`
      — deferred by user decision in sprint 279, see `backlog.md`) — the
      before/after maps recorded side by side.
      _Amended 2026-08-15: originally "zero … across the fleet", which cannot
      hold while those two are unconverted. Both remaining fixed-port repos
      must be exactly those two, `martialops` must be the only default-port
      config, and **no converted repo may appear in any collision** — if a
      third repo shows up fixed-port, or either deferral gains a port+
      credential twin, that is a real failure, not an expected deferral._
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` green in
      emit-infra

## Out of scope

Production or deploy database configuration in any repo. Non-Postgres services
in `develemail` and elsewhere, except where one genuinely blocks a Postgres
conversion. Upgrading Postgres versions, changing credentials, or migrating
data. Fixing unrelated red suites or unrelated uncommitted work — report them.
Retrofitting emit-billing's `test-db.ts` or the `/init-project` template onto
the `db-url` command: both work, and that consolidation is a later cleanup.

## Completed

**Date:** 2026-08-15

### Summary

All three repos converted, one commit each, verified individually with
before/after evidence. The recipe held for two of three but needed a real
adaptation each time — worth recording since a future repo in this fleet
will hit the same shapes again:

- **`math-problemizer`** was the closest fit to the documented recipe:
  `docker-compose.yml` → ephemeral port; a new
  `apps/api/src/resolve-dev-database-url.ts` wired into `main.ts` before
  `buildServer()` (which builds a real Postgres pool eagerly); `drizzle.config.ts`
  converted to a CJS-safe CLI shell-out. Its `packages/db` tests use
  `describe.skipIf(!process.env.DATABASE_URL)` by design (CLAUDE.md:
  `check:all` must stay green with no Postgres) — the new
  `packages/db/src/test-db.ts` globalSetup preserves that: it discovers +
  migrates when the container is up, and leaves `DATABASE_URL` unset (not an
  error) when it's down, distinguishing "container not running" from a real
  discovery failure (e.g. identity mismatch) by matching the CLI's stderr
  text. Identity assertion expects `study_haul` (the container's actual
  database name — `docker inspect` confirms it's `math-problemizer`'s own
  container despite the name, no `study-haul` repo exists), with a comment
  explaining the mismatch.
- **`diner-decider`** is a live production repo whose tests connect to real
  Postgres directly, no graceful skip (CLAUDE.md: "api tests connect to it
  directly, they don't mock it out") — so its new
  `apps/api/src/test/global-setup.ts` treats discovery failure as a hard
  stop. Wiring point was `env.ts`'s zod schema, which validates `source` at
  **module-evaluation time** — not inside a function — so the resolver has to
  run before that validation, not inside `main.ts`. First fresh-volume test
  run surfaced a real gap the recipe doesn't mention: `achievements.test.ts`
  expects all 15 catalog rows to exist, which only `db:seed` (not
  `db:migrate`) provides — the same reason `tools/check-all.sh` and
  `scripts/ci.sh` both already run seed right after migrate. Added a seed
  step to the globalSetup once this surfaced; fresh-volume `pnpm test` then
  passed 201/201. The **26 hardcoded-URL files** cited in the sprint's
  cross-repo audit didn't hold up under direct inspection — the actual count
  touching real Postgres connection strings was 8 (docker-compose.yml,
  .env.example, env.ts, drizzle.config.ts, packages/db/seed.ts,
  apps/api/src/test/db.ts, CLAUDE.md, provision-list/database.md, all
  converted) plus 2 intentionally-untouched throwaway CI containers
  (scripts/ci.sh, tools/check-all.sh — fixed ports 5436/5437, raw `docker
  run`, invisible to `db-doctor`, out of scope) and 1 inert/unused file
  (`.github/workflows/ci.yml` — GitHub Actions is disabled for this project).
  No inert fixture was converted to a live connection.
- **`develemail`** needed the most judgment. Its `packages/db` tests use an
  in-memory `pglite` instance (`packages/db/src/testing/index.ts`), never the
  docker-compose container — so **no test bootstrap was needed at all**, the
  recipe's core concern simply doesn't apply here. The real work was the dev
  boot path across three surfaces that each hit the "eager eval at import
  time" trap differently: `apps/api/src/main.ts` (getDb() inside an async
  IIFE — straightforward), `apps/worker/src/deps.ts` (`export const db =
  getDb();` at module top level — resolution has to land before that line),
  and two admin scripts (`reset-password.ts`, `baseline-migrations.ts`) that
  previously read `DATABASE_URL` only from `--env-file=.env`. Since
  `packages/db` has its own vitest `test` target in this repo (unlike the
  other two), the discovery+production-guard logic lives once in
  `packages/db/src/resolve-dev-database-url.ts` instead of being duplicated
  per app. **pgbouncer decision**: dev connects straight to Postgres —
  `docker-compose.yml`'s dev stack has no pgbouncer service at all; it only
  exists in the blue/green/prod compose files (production-only, untouched).
  Mail services (Postfix, OpenDKIM, rspamd, Mailpit) confirmed untouched via
  `git show` diff — only the postgres service's port line changed.

Two follow-ups surfaced during develemail's verification, both confirmed
pre-existing via `git stash` before recording: `tools/check-all/e2e-smoke.sh`
(fully containerized, internal-Docker-network-only e2e, structurally
incapable of being affected by this conversion) has 9 failing tests
(`usage.spec.ts`, `email-log.spec.ts` — a seed endpoint returning 400
instead of 201) on the unmodified baseline; and `docker-compose.override.yml`
is tracked in git despite `.gitignore` listing it and CLAUDE.md documenting
it as local-only (added before the ignore rule, never untracked since).
Neither is related to database ports; both filed as `[defer]` below.

### Files changed

**math-problemizer** (commit `5cf1385`):
- `docker-compose.yml` — ephemeral loopback port
- (new) `apps/api/src/resolve-dev-database-url.ts` + test — dev-boot resolver
- `apps/api/src/main.ts` — wired resolver before `buildServer()`
- `drizzle.config.ts` — CJS-safe CLI shell-out
- (new) `packages/db/src/test-db.ts` + test — vitest globalSetup, skip-safe
- `packages/db/vitest.config.ts` — wired globalSetup
- `.env.example`, `CLAUDE.md`, `apps/e2e/tests/auth.spec.ts` — docs/comments

**diner-decider** (commit `ce00040`):
- `docker-compose.yml` — ephemeral loopback port
- (new) `apps/api/src/resolve-dev-database-url.ts` + test — dev-boot resolver
- `apps/api/src/env.ts` — wired resolver before zod validation
- `drizzle.config.ts` — CJS-safe CLI shell-out
- `packages/db/seed.ts` — discovery replacing manual `.env` parsing
- (new) `apps/api/src/test/global-setup.ts` — vitest globalSetup (discover +
  migrate + seed), hard-fail on discovery error
- `apps/api/src/test/db.ts` — dropped now-redundant manual `.env` parser
- `apps/api/vitest.config.ts` — wired globalSetup
- `.env.example`, `CLAUDE.md`, `provision-list/database.md` — docs

**develemail** (commit `ef589e3`):
- `docker-compose.yml` — ephemeral loopback port (postgres service only)
- (new) `packages/db/src/resolve-dev-database-url.ts` + test — shared
  discovery + production guard
- `packages/db/package.json` — new export for the above
- `apps/api/src/main.ts` — wired before `getDb()` call inside the boot IIFE
- `apps/worker/src/deps.ts` — wired before `export const db = getDb();`
- `apps/api/src/scripts/reset-password.ts`,
  `packages/db/scripts/baseline-migrations.ts` — same resolver, admin scripts
- `drizzle.config.ts`, `drizzle.config.ci.ts` — CJS-safe CLI shell-out
- `docker-compose.e2e.yml`, `CLAUDE.md` — comments/docs only

### Verification

- **math-problemizer**: baseline `pnpm check:all` green pre-change; fresh
  volume (`down -v`+`up`) → `pnpm test` 14/14 pass with no manual migrate;
  same fresh volume with Postgres stopped → 11 pass/3 skip (graceful,
  matches design); dev boot with no `DATABASE_URL` connects when Postgres is
  up, fails loudly naming `docker compose up -d` when it's down; final
  `pnpm check:all` green.
- **diner-decider**: baseline `pnpm check:all` green pre-change; fresh volume
  → `pnpm test` (no `DATABASE_URL`) 201/201 pass with no manual migrate/seed;
  dev boot connects/fails loudly the same way; `pnpm check:all` and `pnpm
  check:all:e2e` (real browser, live signup→settings→sign-out) both green.
- **develemail**: baseline `pnpm check:all` green pre-change; fresh volume →
  `pnpm db:migrate` (no `DATABASE_URL`) succeeds, `pnpm test` 15/15 in
  `packages/db` (pglite-based, unaffected as expected); `apps/api` and
  `apps/worker` both boot and connect with no `DATABASE_URL` when Postgres is
  up, fail loudly when it's down; `pnpm check:all` green (17/17 test
  targets); `pnpm check:all:e2e` (local-process dev boot) green;
  containerized `e2e-smoke.sh` has 9 pre-existing failures, confirmed present
  on baseline via `git stash`, unrelated to this conversion.
- **Fleet-wide**: `emit-infra db-doctor` before — `develemail`/
  `garage-sailor-prime` collide on 5433; after — all three converted repos
  show `ephemeral`; only `martialops` (5432, default creds) and
  `garage-sailor-prime` (5433, shared `postgres`/`postgres` creds with
  `martialops`) remain fixed-port, exactly the two known deferrals; no
  converted repo appears in any collision.
- **emit-infra itself**: `pnpm lint` clean (5/5 projects), `pnpm typecheck`
  clean (5/5), `pnpm test` 350/350 pass (42 files), `pnpm test:hooks` 65/65
  pass (deploy-plan 47, docker-build 12, db-url 6).

### Follow-ups

- `[defer]` `tools/check-all/e2e-smoke.sh` in develemail has 9 pre-existing
  failing tests (`apps/web-e2e/src/usage.spec.ts`,
  `apps/web-e2e/src/email-log.spec.ts` — a seed endpoint returns 400 instead
  of 201) on the unmodified baseline, confirmed via `git stash`. Unrelated to
  database ports (that suite runs fully containerized, internal-network
  only) — worth a look on its own.
- `[defer]` develemail's `docker-compose.override.yml` is tracked in git
  despite `.gitignore` listing it and CLAUDE.md documenting it as
  "gitignored; customize locally" — it was committed before the ignore rule
  was added and was never untracked. Someone's local customizations to that
  file are effectively public/shared. `git rm --cached` + confirm the
  `.example` counterpart still covers onboarding.
- `[defer]` `packages/db/scripts/baseline-migrations.ts` (develemail) now
  gets the same discovery fallback as the app boot paths, but it's a
  production-reconciliation tool normally run with an explicit
  `DATABASE_URL` — worth confirming with the user this is actually desired
  rather than leaving it error-only-when-unset.
- `none` beyond the above — no blockers, no address-next items.
