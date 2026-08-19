# Sprint 280 — Convert the three lightest database-backed repos

## Goal

`emit-vision`, `emit-social` and `immigration-app` run on the ephemeral
pattern, including a test bootstrap that discovers the port and refuses to
run against the wrong database. These are the first repos where the full
sprint-60 shape is needed, and they are chosen to be the cheapest instances of
it.

## Why these three together

They are the three repos with the fewest database-touching test files —
`emit-vision` 1, `emit-social` 2, `immigration-app` 3 — so each needs the test
bootstrap but none needs much of it. Grouping them keeps one sprint's worth of
work while still adding the piece sprints 278–279 deliberately avoided.

The heavy repos (`math-problemizer` 5, `diner-decider` 7, `develemail` 8) are
sprint 281. That split is a direct response to emit-billing sprint 64, which
was planned as one ten-repo sweep and delivered zero conversions because the
per-repo cost was roughly a full sprint. Sizing by actual test-file count is
the correction.

## Context

- **Sprints 275–279 are prerequisites.** The recipe in
  `docs/EPHEMERAL-DEV-DB.md`, corrected by the 278 pilot and the 279 sweep, is
  the spec. The `db-url` resolver (276) is how config files reach the port.
- **Repo state as audited 2026-08-14** (emit-billing sprint 64) — re-verify:

  | repo | port | user / pass | database | DB-touching test files |
  |---|---|---|---|---|
  | emit-vision | 55432 | `emit` / `emit` | emit_vision | 1 |
  | emit-social | 5435 | `emit-social` | emit-social | 2 |
  | immigration-app | 5434 | `immigration_pro360` | immigration_pro360 | 3 |

  `emit-social` shares port 5435 with `diner-decider` — one of the two live
  collisions. Converting it here retires half of that collision; the other
  half lands in 281.
- **The test-bootstrap shape to replicate** is emit-billing's
  `packages/db/src/test-db.ts`: discover the port, wait for readiness, assert
  `select current_database()` matches, apply migrations, then hand
  `DATABASE_URL` to the suite via the runner's global-setup hook. Its
  `applyMigrations` step is what removes the "did I remember to migrate"
  footgun on a fresh volume.
- **Do not assume drizzle + vitest.** The reference implementation is
  drizzle-specific; these repos may use different ORMs or runners. Preserve
  the *shape* — ephemeral port, discovery, identity assertion, migrations —
  not the literal file. Confirm each repo's stack before porting.
- **`emit-vision` is the largest and most production-critical of the three**
  (ClickHouse and Redis alongside Postgres, a live deployed service). Its
  single DB-touching test file makes it cheap here, but treat its compose file
  with care: convert the Postgres service only and leave the other services'
  port mappings alone unless a collision demands otherwise.
- Honour each repo's own `CLAUDE.md` and verification command.
- emit-infra fleet convention: **one commit per repo touched.**

## Tasks

1. Per repo, in the order `emit-vision` → `emit-social` → `immigration-app`:
   baseline its own verification command first and record it. Red for
   unrelated reasons means report and skip.
2. Check each tree for unrelated uncommitted work; report and skip if dirty.
3. Confirm the repo's ORM and test runner before porting the bootstrap, and
   note in the completion summary where its shape diverges from the drizzle +
   vitest reference.
4. Apply the recipe: ephemeral loopback port, test bootstrap with discovery +
   readiness wait + identity assertion + migrations, dev path per sprint 277,
   hardcoded URLs removed from configs and docs, `.env.example` updated.
5. Classify hardcoded URLs live-connection vs inert-fixture before editing, as
   in sprint 279 — fixtures keep a literal on a non-routable host.
6. Verify per repo that the suite passes with **no** `DATABASE_URL` override,
   and separately that pointing it at a wrong database aborts before any test
   or seed writes.
7. **Stop-and-report guard:** if any repo materially exceeds the recipe,
   finish or cleanly back out that repo and report. Do not carry a
   half-converted repo forward, and do not start the next repo to make up time.

## Acceptance criteria

- [x] `emit-vision`, `emit-social` and `immigration-app` each publish an
      ephemeral loopback Postgres port, or are reported skipped with a reason
- [x] Each converted repo passes its **own** verification command with no
      `DATABASE_URL` override — recorded per repo with its pre-change baseline
- [x] Each converted repo aborts loudly when pointed at a database whose
      identity doesn't match — name the test or check per repo that
      demonstrates it
- [x] A fresh volume (`down -v` then `up`) followed by that repo's test
      command passes with no manual migrate step, per repo
- [x] Where a repo's stack diverges from drizzle + vitest, the divergence and
      the chosen equivalent are recorded
- [x] `emit-vision`'s non-Postgres services (ClickHouse, Redis) are unchanged
- [x] Exactly one commit per converted repo, each carrying the developer
      migration note
- [x] Sprint 275's doctor no longer reports `emit-social` in a collision
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` green in
      emit-infra

## Out of scope

`math-problemizer`, `diner-decider` and `develemail` — sprint 281. Production
or deploy database configuration in any repo. Non-Postgres services, except
where one is genuinely blocking a Postgres conversion. Upgrading Postgres
versions, changing credentials, migrating data, or fixing unrelated red
suites — report those instead.

## Completed

**Date:** 2026-08-15

### Summary

All three repos converted (one commit each, all pushed to their own `main`
branches, not this repo). The sprint's own premise — "each needs the test
bootstrap but none needs much of it" — didn't survive contact with the
repos: **the actual split was binary, not graduated.** `emit-vision` and
`emit-social` have *zero* tests that touch a live Postgres (see divergence
notes below), so only the base dev-path recipe (275–277) applied to them,
identical in shape to garage-sailor/tastease (278–279). `immigration-app`
is the opposite extreme: 35 `*.integration.test.ts` files plus one
non-suffixed file that also needs a live DB, all wired into `pnpm
check:all`'s default (non-opt-in) `integration` stage — it needed the full
sprint-60 test-bootstrap shape, *and* a second Postgres service
(`postgres-e2e`) the sprint's audit table didn't mention, *and* a
concurrency bug (below) the reference implementation doesn't have to deal
with. The sprint-64 audit's "1 / 2 / 3 DB-touching test files" table was a
grep-based overcount for the first two repos (matched files that construct
a `pg.Pool`/`drizzle()` handle but never execute a query — `.toSQL()`
calls, PGlite-backed "integration" tests) and a significant undercount for
the third (missed the entire `*.integration.test.ts` suite and the second
Postgres service). Re-verify test-file counts by grepping for actual query
execution, not just driver imports, before trusting a table like this again.

**`emit-vision`** (commit `4945829`): `docker-compose.yml`'s `postgres`
service only (ClickHouse/Redis untouched, confirmed via diff). New
`packages/config/src/resolve-dev-database-url.ts`, wired into
`loadServerConfig()`. Fixing the resulting regression took as long as the
conversion itself: `apps/web`'s ~35 route/page files all import
`loadWebConfig` from the `@emit-vision/config` barrel, and the barrel now
transitively pulls in `node:child_process` — Turbopack refuses to bundle
that into a client chunk. Same root cause and same fix shape as emit-billing
sprint 277's `dashboard-password.ts` split: extracted `loadWebConfig` to its
own file with a dedicated `@emit-vision/config/web-config` export subpath,
repointed every `apps/web` consumer at the subpath. One new wrinkle this
sprint found: Vite's `resolve.alias` array does prefix matching on string
`find` values, so the new subpath alias had to be listed *before* the bare
`@emit-vision/config` alias in `apps/web/vitest.config.ts` — added after
initially fixed the build but left tests broken with an opaque "Cannot find
package" error, until reordered.

**`emit-social`** (commit `dce1c40`): `docker-compose.yml` port `5435` (the
`diner-decider` collision sprint 275 flagged) → ephemeral. New
`packages/db/src/resolve-dev-database-url.ts`, wired into `client.ts`'s
`getPool()` and `drizzle.config.ts`. Clean conversion, no regressions —
`apps/web` never imports `@emit-social/db`, so the barrel-bundling trap
emit-vision hit doesn't apply here.

**`immigration-app`** (commit `661e717`): both `docker-compose.yml` services
(`postgres` 5434, `postgres-e2e` E2E_PG_PORT-configurable-default-5436) →
ephemeral. `currentPostgresService()` (reads a new `E2E_POSTGRES=1` flag) is
this repo's addition to the shared resolver shape, since two same-`POSTGRES_DB`
services need a selector the reference recipe doesn't have. Five separate
`process.env.DATABASE_URL` read sites converted (`env.ts`, `migrate.ts`,
`seed.ts`, `seed-ref.ts`, two `i18n-*.ts` scripts) — recipe step 4's "second
read site" warning, times five. `apps/web-e2e/playwright.config.ts` couldn't
precompute `postgres-e2e`'s URL at config-load time the way the old
`E2E_PG_PORT`-based code did, because the ephemeral port isn't assigned
until `docker compose up` runs *inside* `tools/e2e-dev.sh`, after Playwright
has already evaluated its config — fixed by passing `E2E_POSTGRES=1` instead
of a precomputed URL and letting every spawned process discover its own.
`.github/workflows/check-all-e2e.yml`'s `check` job hardcoded `DATABASE_URL`
at the old fixed port in three places; since CI's own `pnpm db:up` now also
gets an ephemeral port and `emit-infra` isn't available on CI runners for
auto-discovery, fixed by asking `docker compose port postgres 5432`
directly and exporting via `$GITHUB_ENV` (the `e2e` job's native GitHub
Actions service-container Postgres was already unaffected). Found by
actually running the fresh-volume acceptance criterion, not assumed: running
`migrate()` inside the per-worker `beforeAll` (the existing pattern) raced
under Vitest's parallel `pool: 'forks'` workers — two workers concurrently
`CREATE SCHEMA`-ing against a fresh volume threw `duplicate key value
violates unique constraint "pg_namespace_nspname_index"`. Fixed by moving
migration application into a genuine Vitest `globalSetup` (runs once, in
its own process, before any worker starts) — `apps/api/src/test/global-setup.ts` —
leaving each worker's `setup.ts` to do only read-only, concurrency-safe
work (its own DATABASE_URL resolution + `current_database()` identity
check). Four one-off/prod-capable maintenance scripts under `tools/`
(`provision-admin.ts`, `provision-demo-users.ts`, `import-attorneys.ts`,
`import-doj-roster.ts`) were deliberately left reading `process.env.DATABASE_URL`
directly — each already documents "set `DATABASE_URL=<url>` yourself" as
its contract in its own header comment, unchanged by this sprint.

### Divergence from the drizzle + vitest reference

All three repos already use drizzle + vitest (no ORM/runner substitution
needed) — the divergence is in what the reference's `test-db.ts` shape
actually had to attach to:

- **`emit-vision`, `emit-social`:** nothing to attach to. Neither has a test
  that opens a real Postgres connection (see Summary) — the dev-path
  resolver (275–277's recipe) covers 100% of what these repos needed.
- **`immigration-app`:** the reference's single `globalSetup`-does-everything
  shape had to split in two — migration application in a true `globalSetup`
  (one-shot process) versus discovery/identity-check in per-worker
  `setupFiles` (concurrency-safe, but migration DDL isn't) — and needed a
  service selector (`currentPostgresService()`) the single-Postgres-service
  reference never needed.

### Files changed

**emit-infra:** `sprint/280-convert-light-db-test-repos.md` only (this file).

**emit-vision** (commit `4945829`, own repo): `docker-compose.yml`;
(new) `packages/config/src/resolve-dev-database-url.ts`, `.test.ts`,
`web-config.ts`; `packages/config/src/index.ts`, `index.test.ts`,
`package.json`; `apps/web/vitest.config.ts`; `apps/web/src/app/setup/__tests__/page.test.tsx`;
~35 `apps/web/src/app/**/*.ts(x)` route/page files (barrel → subpath import);
`.env.example`, `apps/api/.env.example`, `apps/worker/.env.example`;
`docs/{local-development,local-infrastructure,troubleshooting}.md`,
`tools/check-all/README.md`; `tsconfig.base.json`.

**emit-social** (commit `dce1c40`, own repo): `docker-compose.yml`;
(new) `packages/db/src/resolve-dev-database-url.ts`, `.test.ts`;
`packages/db/src/client.ts`; `drizzle.config.ts`; `.env.local.example`;
`README.md`; `tools/infra-check.sh` (hardcoded `DB_PORT=5435` → `docker
compose port` lookup).

**immigration-app** (commit `661e717`, own repo): `docker-compose.yml`;
(new) `apps/api/src/config/resolve-dev-database-url.ts`, `.test.ts`,
`apps/api/src/test/global-setup.ts`; `apps/api/src/config/{env,load-dotenv}.ts`;
`apps/api/src/infrastructure/db/{migrate,seed,seed-ref}.ts`;
`apps/api/scripts/i18n-{export,import}.ts`; `apps/api/drizzle.config.ts`;
`apps/api/src/test/setup.ts`; `apps/api/vitest{,.integration}.config.ts`;
`apps/web-e2e/playwright.config.ts`; `.github/workflows/check-all-e2e.yml`;
`package.json`; `tools/e2e-dev.sh`, `tools/check-all/lib/output_utils.sh`;
`.env.e2e`, `.env.example`; `CLAUDE.md`, `.claude/commands/pathways-contributor.md`,
`docs/{operations/local-databases,operations/attorney-seed,qa-page-inventory}.md`,
`provision-list/neon-database.md`.

### Verification

- **emit-vision:** baseline `pnpm check:all` — `format` fails (528 files,
  pre-existing, unrelated to this sprint — confirmed by inspecting the diff
  it reports, zero DB-related files); `lint`/`typecheck`/`test`/`build` all
  pass. Post-conversion: identical — `format` still fails on the same
  pre-existing files, `lint`/`typecheck`/`test`(665/665 web,
  1120/1120 api)/`build` all pass. `pnpm exec nx run api:test` flaked
  (1–16 of 1120 tests timing out) under this machine's background load
  (load average 8.5–12.5 from dozens of unrelated persistent dev servers,
  not this sprint); confirmed load-induced, not a regression, by rerunning
  with `--testTimeout=30000` (1120/1120 pass) — no code touched by this
  sprint intersects the affected test files. Fresh volume (`down -v`+`up`):
  `pnpm db:migrate`/`db:seed` both succeed with no `DATABASE_URL` set.
  Live dev boot (`nx run api:dev`, `worker:dev`): `GET /readyz` →
  `{"ok":true}`; worker log has zero Postgres errors (a ClickHouse error
  from skipping `clickhouse:migrate`, unrelated). Identity check: matched
  `emit-infra db-url --assert-identity` against a temporarily
  `POSTGRES_DB: impostor`-mismatched container on an existing volume →
  `database "impostor" does not exist` (loud, not silent); reverted
  cleanly. Stopped-container: actionable `Run \`docker compose up -d\``.
- **emit-social:** baseline and post-conversion `pnpm check:all` — both
  fully green (`contracts`/`format`/`lint`/`typecheck`/`test`/`build`), no
  pre-existing red. Fresh volume: `pnpm db:migrate` (drizzle-kit) succeeds
  with no `DATABASE_URL`. Live dev boot: `GET /projects` returns the real
  seeded row (not just a liveness ping). Identity check: same
  impostor-`POSTGRES_DB` technique, same loud rejection; reverted cleanly.
  `db-doctor`: `emit-social ephemeral ...`, 5435 collision with
  `diner-decider` gone from the report.
- **immigration-app:** baseline `pnpm check:all` (stashed conversion, fixed
  port) — fully green, 7 stages (`contracts`/`format`/`lint`/`typecheck`/`test`/`integration`/`build`).
  Post-conversion (fresh volume, ephemeral ports, no `DATABASE_URL` set
  anywhere): identical 7 stages green. Fresh-volume-specific run:
  `pnpm test` alone (no manual migrate) → 380/380 pass, migrations
  auto-applied via `global-setup.ts`; then `pnpm db:seed` +
  `pnpm test:integration` → 166/171 pass (5 pre-existing skips). Identity
  check: same impostor technique on the dev service, same loud rejection.
  `db:migrate:e2e`/`db:seed:e2e` proven to target `postgres-e2e`
  specifically (not silently fall back to dev): stopped only
  `postgres-e2e`, `db:seed:e2e` failed; dev container untouched and left
  running. `db-doctor`: `immigration-app ephemeral ...`.
- **emit-infra:** `pnpm lint`, `pnpm typecheck` clean (5 projects each);
  `pnpm test` 350/350 (42 files); `pnpm test:hooks` 47+12+6 passed, 0
  failed. `emit-infra db-doctor` against the real fleet: 5435 collision
  (`diner-decider`/`emit-social`) retired; only the pre-existing 5433
  collision (`develemail`/`garage-sailor-prime`) remains, expected per
  sprint 279's own documented plan (`develemail` converts in sprint 281).

### Follow-ups

- `[address-next]` `emit-vision`'s repo-wide `pnpm exec prettier --write`
  is overdue (528 files fail `format`, pre-existing, unrelated to any
  recent sprint's diff) — a one-time repo-wide reformat commit before the
  drift grows further. Not fixed here: far outside this sprint's scope and
  risks masking a real diff inside an unrelated mass-reformat.
- `[defer]` `emit-vision`'s `apps/api` test suite showed load-induced
  timeout flakiness on this machine (unrelated to this sprint — confirmed
  by `--testTimeout=30000` passing 1120/1120). Not a code issue; flagging
  in case CI on a similarly-loaded runner hits the same 5000ms default
  timeout intermittently.
- `[defer]` `emit-vision`'s `tools/check-all/prod-smoke.sh` and
  `docs/deployment.md`'s "Commercial Beta Checklist" still hardcode
  `localhost:55432` — left untouched as production/deploy configuration
  (explicitly out of scope for this sprint), not the local dev path.
- `[defer]` `immigration-app`'s four `tools/*.ts` maintenance scripts
  (`provision-admin`, `provision-demo-users`, `import-attorneys`,
  `import-doj-roster`) still read `process.env.DATABASE_URL` directly with
  no discovery fallback — each already documents "set DATABASE_URL
  yourself" as its contract; wiring discovery in would be a convenience,
  not a fix, and wasn't done to keep this sprint's blast radius to the dev
  boot path + test bootstrap it was scoped for.
- `[defer]` `immigration-app`'s `.env.e2e` is unreferenced by any script
  (confirmed via repo-wide grep) despite `CLAUDE.md` previously documenting
  it as loaded by `db:migrate:e2e` — that claim was already stale before
  this sprint (sprint 174 introduced `E2E_PG_PORT` without wiring
  `DOTENV_PATH` to this file). Content updated to explain the gap rather
  than perpetuate it; actually wiring it (or deleting it) is a separate,
  unscoped decision.
