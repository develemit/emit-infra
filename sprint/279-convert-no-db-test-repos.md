# Sprint 279 — Convert the repos whose tests never open a database

> **Re-scoped 2026-08-15 (user decision): `tastease` only.** `martialops` and
> `garage-sailor-prime` are deferred to the backlog — see the Deferred
> section below for why, and why deferring them is safe once 280–281 land.

## Goal

`tastease` runs on the ephemeral pattern. With `garage-sailor` already done
in sprint 278, that clears every *actively developed* repo that needs no
test-bootstrap work.

Originally this sprint also covered `martialops` and `garage-sailor-prime`.
Both were skipped on evidence during execution and then formally deferred:
`martialops` has 50 uncommitted files behind a failing `pnpm audit`
pre-commit gate, and `garage-sailor-prime` turned out to be **mis-scoped** —
its `apps/api/src/routes/listings.test.ts` imports `prisma` and does open a
database, so it never belonged in a "no test-bootstrap needed" sprint.

## Why these three, and why now

They share one property: **no test file in any of them opens a database
connection**, so no vitest `globalSetup` or equivalent test bootstrap is
needed. The work is compose port, dev path, config/doc sweep, and the
developer migration note — the sprint-278 recipe with its largest piece
removed.

Two of them are also the fleet's worst offenders:

- **`martialops` is the single highest-risk configuration on the machine**:
  the *default* Postgres port 5432 with the *default* `postgres`/`postgres`
  credentials. Any stray default-configured Postgres container — and 5432 is
  what every quickstart on the internet publishes — is silently reachable by
  its tooling. Convert it first.
- **`garage-sailor-prime` also uses `postgres`/`postgres`**, one port away on
  5433, where it collides with `develemail`. Two repos sharing a credential
  pair is the precondition for silent cross-project writes; today only the
  one-port gap prevents it.

## Context

- **Sprints 275–278 are prerequisites.** Follow the recipe in
  `docs/EPHEMERAL-DEV-DB.md` as corrected by the sprint-278 pilot.
- **Repo state as audited 2026-08-14** (emit-billing sprint 64) — re-verify,
  it will have aged:

  | repo | port | user / pass | database | compose file | hardcoded-URL `.ts` files |
  |---|---|---|---|---|---|
  | martialops | **5432** | **`postgres` / `postgres`** | martialops | `docker/docker-compose.yml` | 23 |
  | garage-sailor-prime | 5433 | **`postgres` / `postgres`** | garagesailor | `docker-compose.yml` | 0 |
  | tastease | 5440 | `easy_living` | easy_living | `compose.yaml` | 2 |

- **"No DB-touching tests" does not mean "one-line change."** `martialops`
  carries 23 files with hardcoded `localhost:<port>` URLs, and all three
  hardcode the port in `.env` (gitignored) and `.env.example`. The
  sprint-64 finding stands: there is no repo where changing the compose port
  alone is safe.
- **Non-standard compose paths.** `martialops` keeps its compose at
  `docker/docker-compose.yml` — so its compose *project name* is `docker`, and
  its container is `docker-postgres-1`, not `martialops-postgres`. `tastease`
  uses `compose.yaml`. Any tooling assuming `docker-compose.yml` at the repo
  root will miss both.
- **`tastease` is a live production project** with its own deploy pipeline and
  a `CLAUDE.md` that forbids GitHub Actions. Touch only local dev config;
  `compose.yaml` is the dev stack, `docker-compose.prod.yml` is production and
  is out of scope.
- Several of these repos had uncommitted work in flight on 2026-08-14
  (`martialops` 42 dirty files, `garage-sailor-prime` 8). Check each tree
  before starting.
- emit-infra fleet convention: **one commit per repo touched.**

## Tasks

1. For each repo, in the order `martialops` → `garage-sailor-prime` →
   `tastease`: baseline its own verification command and record the result
   before changing anything. A repo already red for unrelated reasons is
   reported and skipped, not converted.
2. Check each tree for unrelated uncommitted work; if dirty, report and skip
   rather than entangling this conversion with someone else's changes.
3. Apply the recipe per repo: ephemeral loopback port in the compose file, the
   sprint-277 dev path, hardcoded URLs removed from configs and docs,
   `.env.example` updated, developer migration note in the commit message.
4. For `martialops` specifically, work through all 23 hardcoded-URL files and
   classify each the way emit-billing sprint 61 did: **live connections** get
   the resolver, **inert fixtures** (strings never dialed) keep a literal but
   move to a non-routable host such as `db.invalid` so future greps aren't
   misled. Do not blanket find-and-replace — emit-billing's audit initially
   over-counted 18 hits when only 8 mattered, precisely because fixtures and
   live connections look identical to `grep`.
5. Run each repo's own verification command after conversion and record it.
6. **Stop-and-report guard:** if any single repo turns out to need a test
   bootstrap after all, or otherwise exceeds the recipe, finish that repo or
   back it out cleanly, then report — do not carry a half-converted repo into
   the next one. A half-converted repo breaks both dev and test at once.

## Acceptance criteria

- [x] `martialops`, `garage-sailor-prime` and `tastease` each publish an
      ephemeral loopback Postgres port, or are reported skipped with a
      specific reason
- [x] Each converted repo passes **its own** verification command with no
      `DATABASE_URL` override — recorded per repo, alongside its pre-change
      baseline
- [x] Each converted repo's `pnpm dev` (or equivalent) works from a `.env`
      with no hardcoded port
- [x] ~~`martialops`' 23 hardcoded-URL files are each classified
      live-connection or inert-fixture~~ — **de-scoped 2026-08-15**, moves to
      the backlog with `martialops` itself
- [x] Exactly one commit per converted repo, each carrying the developer
      migration note
- [x] ~~Sprint 275's doctor reports no repo on the default port 5432, and no
      two repos sharing both a port and a credential pair~~ — **de-scoped
      2026-08-15.** Both remaining offenders are the deferred repos, so this
      cannot hold until they are converted. Sprint 281's equivalent
      fleet-clean criterion is amended the same way.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` green in
      emit-infra

## Out of scope

The six repos whose tests touch a live database — sprints 280–281. Production
or deploy database configuration in any repo, `tastease`'s
`docker-compose.prod.yml` explicitly included. Upgrading Postgres versions,
changing credentials, or migrating data. Fixing unrelated red suites or
unrelated uncommitted work found along the way — report it.

## Completed

**Date:** 2026-08-15 (re-scoped to `tastease` only)

### Summary

**`tastease` converted** (one commit, `f430a7f`). `compose.yaml`'s `db`
service now publishes `127.0.0.1::5432` instead of the fixed `5440`.
`packages/db/src/env.ts` (the single choke point apps/api, migrations, and
`db:seed`/`db:seed-content` all go through) resolves `DATABASE_URL` via a new
`resolve-dev-database-url.ts` (`maybeResolveDatabaseUrl` /
`resolveDevDatabaseUrl`, `emit-infra db-url --service db --assert-identity`
by subprocess) whenever it's unset and `NODE_ENV` isn't production.
`e2e/support/test-env.ts` gets the same resolution — `reset-seed-household.ts`
and `stripe-teardown.ts` connect to Postgres directly with `pg`, bypassing
`packages/db` entirely, which is the "second unconverted read site" the
recipe's step 4 warns about. `.env.example` now documents auto-discovery.

The sprint-64 table's claim of "2 hardcoded-URL `.ts` files" for `tastease`
didn't hold up: both hits were substring false-positives (a UUID fragment,
an Unsplash image URL containing "5440"), not actual port references — the
sprint's own warning about grep over-counting fixtures applied here even
before reaching the fixture-vs-live-connection distinction.

One transferable finding fed back into `docs/EPHEMERAL-DEV-DB.md`: the first
resolver implementation computed its default `cwd` via `import.meta.url`,
which works under `tsx` but breaks under Playwright's TS loader
(`ReferenceError: exports is not defined in ES module scope`) when the same
module is reached from an e2e helper that itself uses `__dirname`. Fixed by
making `cwd` a required parameter instead of a computed default — each
caller supplies its own repo-root path however already works in its own
module context, rather than the shared resolver guessing.

**Verification (`tastease`):** baseline `pnpm typecheck`/`lint` clean;
baseline `nx run api:test` red (no container running — confirmed this is the
normal pre-`docker compose up` state, not a converted-away regression) and
`nx run mobile:test`... n/a, tastease has no mobile app. Post-conversion,
with no `DATABASE_URL` set anywhere: `pnpm typecheck` clean (7 projects),
`pnpm lint` clean (7 projects, including the new resolver test file once
rewritten to the repo's flat `void test(...)` convention instead of
`describe`/`it`), `pnpm test` 640/640 across 6 projects (322 in `api`, 202 in
`db` including 6 new resolver tests). `pnpm db:migrate` and `db:seed` both
ran clean with no explicit `DATABASE_URL`. Live dev boot
(`tsx watch apps/api/src/index.ts`): `GET /api/health` → `{"status":"ok",
"db":"up"}`. Stopped the container: resolver threw `Could not resolve the
"db" service's port — is the container running? Run \`docker compose up
-d\`.` — actionable, not opaque. Restarted the container (port drifted
55409→56030 across the cycle): next resolution picked up the new port with
no code change. Wrong-database rejection demonstrated against a throwaway
`impostor`-named container using the same `assertDatabaseIdentity` call
`--assert-identity` invokes: `Refusing to proceed: connected to database
"impostor", expected "easy_living".`

Also ran `pnpm test:e2e` (full suite, ~2 min to the point of failure) both
before and after conversion: `[setup] authenticate as seed user` and two
`mobile-funnel` specs fail identically on both — a NextAuth
`error=Configuration` redirect loop unrelated to Postgres (30 non-auth specs,
including the DB-backed marketing/glossary suite, pass both before and
after). Confirmed pre-existing by reverting to the fixed-port baseline via
`git stash` and re-running `auth-setup.ts` alone: same failure. Not fixed
here — out of scope, flagged as a follow-up.

**`martialops`: skipped, not touched.** 50 uncommitted files in flight
(terraform changes, sprint archive reorganization, an unrelated auth
redesign) — matches the sprint's own warning that this repo "had
uncommitted work in flight," aged from 42 to 50 files. Per task 2, reported
and skipped rather than entangling this conversion with someone else's
in-progress work. Still the fleet's highest-risk configuration (default port
5432, `postgres`/`postgres`) — unconverted.

**`garage-sailor-prime`: skipped, not touched.** Two independent
disqualifiers, either alone sufficient:
1. Its own top-level verification command (`nx run-many -t test`, i.e.
   `pnpm test`) is baseline red for a reason unrelated to this sprint: the
   `mobile` project's Jest config can't parse `react-native`'s
   `error-guard.js` (`SyntaxError: Unexpected identifier 'ErrorHandler'`) —
   pre-existing Babel/Jest transform gap, nothing to do with Postgres.
2. **The sprint's premise doesn't hold for this repo.** Its own claim was
   "no test file in any of them opens a database connection" — but
   `apps/api/src/routes/listings.test.ts` imports the real `prisma` client
   and calls `prisma.listing.deleteMany()` directly in `beforeEach`, with no
   discovery/bootstrap mechanism: it dials whatever fixed port `.env`
   names. Confirmed live: `nx run api:test` fails outright with no container
   running, and passes once `docker compose up -d` + `prisma migrate deploy`
   are run manually. Converting the compose port to ephemeral without also
   building a full test-bootstrap (discover → wait → migrate → assert
   identity, this sprint's explicit non-goal) would silently break API
   tests the next time the container restarts and the port drifts. This
   repo belongs in the sprint 280/281 bucket ("repos whose tests touch a
   live database"), not 279 — the sprint-64 audit this sprint's table cites
   apparently only checked for hardcoded-URL `.ts` files, not whether tests
   actually connect.

Docker container brought up for `garage-sailor-prime`'s baseline check was
stopped and removed afterward (`docker compose down`) — no repo files were
touched, tree is clean.

### Deferred (user decision, 2026-08-15)

`martialops` and `garage-sailor-prime` are **deferred to the backlog** rather
than carried as blockers. Neither is under active development; both are
filed in `backlog.md` with full context.

- **`martialops`** — 50 uncommitted files sit behind a failing
  `pnpm audit --audit-level=high` pre-commit gate, so no commit can land
  there at all. Converting it would also mean classifying its 23
  hardcoded-URL files. Still the fleet's riskiest *configuration* (default
  port 5432 + default `postgres`/`postgres` credentials).
- **`garage-sailor-prime`** — mis-scoped into this sprint. Its
  `apps/api/src/routes/listings.test.ts` imports `prisma` from
  `../lib/prisma.js`, so its tests **do** open a database and it needs a test
  bootstrap. It also uses **Prisma, not Drizzle**, so the 280/281 recipe does
  not transfer unchanged. Its `mobile` Jest config is separately broken
  (pre-existing, unrelated).

**Why deferring these two is safe.** Their containers are **not running**, so
today's exposure is latent rather than live. More importantly, every
collision they participate in is retired *from the other side* by 280–281:

| Finding | Resolves how |
|---|---|
| Port 5433 — `develemail` + `garage-sailor-prime` | `develemail` converts in 281 → `garage-sailor-prime` sits alone on 5433 |
| Port 5435 — `diner-decider` + `emit-social` | both convert (280 + 281) → gone |
| Creds `postgres`/`postgres` — the two deferred repos | they are on *different* ports (5432 vs 5433), so there is no port+credential match between them — the silent-cross-write precondition needs both |
| `martialops` on default 5432 | no other repo claims 5432; risk is a *stray* container, unchanged by this sprint either way |

So once 280–281 land, **no actively developed repo can collide with either
deferred repo**, and the two cannot silently reach each other. What remains
is a documented, contained pair of fixed-port repos rather than a fleet-wide
hazard.

**Consequence for the doctor gate:** `db-doctor` will keep exiting non-zero
while these two are unconverted. Sprint 281's fleet-clean acceptance
criterion is amended accordingly — it now asserts zero collisions among
*converted* repos plus the two known deferrals, not a globally clean fleet.

Do **not** silently fold `garage-sailor-prime` into 280/281's repo list
without updating those sprint files' own repo tables — they were scoped
before the Prisma discovery.
