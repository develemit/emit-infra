# Convert `martialops` to ephemeral dev Postgres
**Difficulty:** 4

> _Promoted from backlog: sprint-279 deferred scope, 2026-08-22._
> _Target repo: `~/projects/martialops` (not emit-infra)._
> _This item may benefit from `/plan-sprint "martialops ephemeral dev postgres"` to split the audit-gate unblock from the conversion itself before running._

## Goal
`martialops` publishes its dev Postgres on an ephemeral loopback port, every
live-connection consumer discovers that port at runtime, and `db-doctor` no
longer reports it as a collision risk.

## Reason
This is the **fleet's riskiest remaining database configuration**: default port
`5432` with default `postgres`/`postgres` credentials. Confirmed still true as
of 2026-08-22 — `docker/docker-compose.yml` lines 5-9:
```yaml
POSTGRES_DB: martialops
POSTGRES_USER: postgres
POSTGRES_PASSWORD: postgres
ports:
  - '5432:5432'
```
The danger isn't that martialops breaks — it's that *any* stray
default-configured Postgres container on this machine is reachable by
martialops' tooling, and vice versa. Every other collision in the fleet was
retired from at least one side by sprints 280–281; this one wasn't, because
sprint 279 dropped the repo from scope. `db-doctor` will keep exiting non-zero
until this and sprint 309's repo are converted (sprint 281's fleet-clean
criterion was amended to expect exactly these two).

## Context

### Blocked first by martialops' own tooling
**50 uncommitted files** sit in the working tree behind a failing pre-commit
gate. `.husky/pre-commit:5` runs `pnpm audit --audit-level=high`, and the repo
has ~20 high-severity transitive advisories (0 critical) — so **no commit can
land in this repo at all** until that's resolved.

Deal with this first and deliberately. Options, roughly in preference order:
1. `/dep-audit` and actually clear or accept the advisories.
2. A deliberate, explained `--no-verify` for the conversion commit.
3. Change the gate's threshold, if the advisories turn out to be
   transitive-only in dev dependencies.

Whichever you pick, **say why in the Completed section** — this gate is the
reason a whole repo has been frozen, and the decision matters more than the
conversion mechanics.

**Also inspect those 50 uncommitted files before touching anything.** They are
someone's in-flight work; a conversion commit that sweeps them up is a much
bigger change than intended. Decide explicitly whether to commit them, stash
them, or work around them.

### The conversion itself
- **23 files hardcode a database URL.** Each must be classified
  **live-connection** vs **inert-fixture**:
  - *Live-connection* → must discover the port at runtime.
  - *Inert-fixture* (a URL string that's parsed or asserted on but never
    dialed) → keep a literal, but point it at a **non-routable** host such as
    `db.invalid` so it can never accidentally connect.
  **Do not blanket find-and-replace.** Sprint 280 made this exact
  classification for immigration-app; follow that precedent.
- **The compose file lives at `docker/docker-compose.yml`**, so the compose
  *project name* is `docker` and the container is `docker-postgres-1` — not
  `martialops-postgres-1`. Anything shelling out to `docker compose port` or
  matching container names by convention needs this.
- Publish `'127.0.0.1::5432'` (ephemeral, loopback-bound) per the fleet
  convention.
- `docs/EPHEMERAL-DEV-DB.md` in emit-infra is the authority on the pattern.
  Read it before starting. Two things it settles: new consumers should call the
  `emit-infra db-url` CLI **by subprocess** rather than adding a fourth
  reimplementation of port parsing, and the CLI must be **built** in emit-infra
  first or the consuming repo's discovery fails confusingly.
- Test bootstrap needs the full shape: discovery → readiness wait → **identity
  assertion** (`current_database()` matches expected, refusing to run against a
  foreign project's database) → migrations. The identity assertion is the part
  that makes this safe rather than merely tidy; do not skip it.

### Data safety
The identity assertion exists because the failure mode here is *silent
cross-writes* to another project's database, not a crash. Before running any
migration or seed step against a discovered URL, confirm the identity check
fires. A conversion that migrates the wrong database is strictly worse than no
conversion.

## Tasks
1. Resolve the pre-commit audit gate; record which option you chose and why.
2. Triage the 50 uncommitted files; record the disposition.
3. Switch `docker/docker-compose.yml` to `'127.0.0.1::5432'`.
4. Classify all 23 hardcoded-URL files as live-connection or inert-fixture.
   Produce the table in the Completed section.
5. Wire live-connection consumers to runtime discovery via the `emit-infra
   db-url` CLI (subprocess).
6. Point inert fixtures at a non-routable host.
7. Add the test bootstrap: discovery, readiness wait, identity assertion,
   migrations.
8. Verify: bring the stack down with `-v`, back up, and confirm everything
   re-resolves against the newly assigned port with nothing cached.
9. Run `emit-infra db-doctor` and confirm martialops no longer appears as a
   collision risk.
10. Commit in martialops.

## Out of scope
- `garage-sailor-prime`'s conversion — that's sprint 309, and it uses Prisma,
  so the file-level reference doesn't transfer.
- Production/deploy database configuration. Local dev path only, matching the
  boundary sprints 280–281 held.
- Fixing martialops application bugs found along the way — file them.

## Acceptance criteria
- `docker/docker-compose.yml` publishes an ephemeral loopback port.
- All 23 files classified, with the table recorded; no live-connection consumer
  retains a hardcoded port.
- Test suite passes against a freshly recreated container on a **different**
  assigned port than the one it was developed against — state both ports.
- The identity assertion is demonstrated to fire (show it rejecting a wrong
  database), not just present in the code.
- `emit-infra db-doctor` no longer flags martialops.
- Work is committed in martialops, with the audit-gate decision explained.
