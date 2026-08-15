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

- [ ] `math-problemizer`, `diner-decider` and `develemail` each publish an
      ephemeral loopback Postgres port, or are reported skipped with a reason
- [ ] Each converted repo passes its **own** verification command with no
      `DATABASE_URL` override — recorded per repo with its pre-change baseline
- [ ] Each converted repo aborts loudly when pointed at a database whose
      identity doesn't match — name the test or check per repo
- [ ] A fresh volume (`down -v` then `up`) followed by that repo's test
      command passes with no manual migrate step, per repo
- [ ] `math-problemizer`'s identity assertion expects `study_haul` and carries
      the comment explaining the name mismatch
- [ ] `diner-decider`'s 26 hardcoded-URL files are each classified, with
      counts recorded, and no inert fixture was turned into a live connection
- [ ] `develemail`'s mail services (Postfix, OpenDKIM, pgbouncer) are
      unchanged, and the Postgres-vs-pgbouncer decision is recorded
- [ ] Exactly one commit per converted repo, each carrying the developer
      migration note
- [ ] **Sprint 275's doctor reports zero collisions and zero fixed-port repos
      apart from the two known deferrals** (`martialops`, `garage-sailor-prime`
      — deferred by user decision in sprint 279, see `backlog.md`) — the
      before/after maps recorded side by side.
      _Amended 2026-08-15: originally "zero … across the fleet", which cannot
      hold while those two are unconverted. Both remaining fixed-port repos
      must be exactly those two, `martialops` must be the only default-port
      config, and **no converted repo may appear in any collision** — if a
      third repo shows up fixed-port, or either deferral gains a port+
      credential twin, that is a real failure, not an expected deferral._
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` green in
      emit-infra

## Out of scope

Production or deploy database configuration in any repo. Non-Postgres services
in `develemail` and elsewhere, except where one genuinely blocks a Postgres
conversion. Upgrading Postgres versions, changing credentials, or migrating
data. Fixing unrelated red suites or unrelated uncommitted work — report them.
Retrofitting emit-billing's `test-db.ts` or the `/init-project` template onto
the `db-url` command: both work, and that consolidation is a later cleanup.
