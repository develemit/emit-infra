# Sprint 279 — Convert the three repos whose tests never open a database

## Goal

`martialops`, `garage-sailor-prime` and `tastease` run on the ephemeral
pattern. With `garage-sailor` already done in sprint 278, that clears every
repo that needs no test-bootstrap work — and removes the fleet's two most
dangerous configurations.

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

- [ ] `martialops`, `garage-sailor-prime` and `tastease` each publish an
      ephemeral loopback Postgres port, or are reported skipped with a
      specific reason
- [ ] Each converted repo passes **its own** verification command with no
      `DATABASE_URL` override — recorded per repo, alongside its pre-change
      baseline
- [ ] Each converted repo's `pnpm dev` (or equivalent) works from a `.env`
      with no hardcoded port
- [ ] `martialops`' 23 hardcoded-URL files are each classified live-connection
      or inert-fixture, with the count of each recorded; no fixture was
      converted into a live connection or vice versa
- [ ] Exactly one commit per converted repo, each carrying the developer
      migration note
- [ ] Sprint 275's doctor reports no repo on the default port 5432, and no two
      repos sharing both a port and a credential pair
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` green in
      emit-infra

## Out of scope

The six repos whose tests touch a live database — sprints 280–281. Production
or deploy database configuration in any repo, `tastease`'s
`docker-compose.prod.yml` explicitly included. Upgrading Postgres versions,
changing credentials, or migrating data. Fixing unrelated red suites or
unrelated uncommitted work found along the way — report it.
