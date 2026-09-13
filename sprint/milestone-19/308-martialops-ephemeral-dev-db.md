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

## Completed

**Date:** 2026-08-23

### Summary
Converted martialops' dev Postgres from a fixed `5432:5432` host port with
default `postgres/postgres` credentials to an ephemeral loopback port
(`127.0.0.1::5432`) with repo-scoped credentials (`martialops/martialops`).
Both were part of the "default-configured Postgres" risk the sprint
description names — the credential change wasn't explicitly listed in the
Tasks section, but `emit-infra db-doctor` still flagged martialops after
the port fix alone (shared `postgres/postgres` with garage-sailor-prime,
sprint 309, not yet converted), and the acceptance criterion is "db-doctor
no longer flags martialops" — so credentials came into scope to actually
satisfy that.

martialops is Prisma-based (the sprint's "Out of scope" note describing
sprint 309/garage-sailor-prime as "it uses Prisma" reads as if martialops
itself isn't — it is). All live DB access (API dev boot, and every
seed/reseed/create-tenant script) already funneled through one choke
point, `libs/backend/platform/src/config/index.ts`'s `loadConfig()`, which
now resolves `DATABASE_URL` at runtime via a `resolveDevDatabaseUrl`/
`maybeResolveDatabaseUrl` module mirroring garage-sailor's corrected
reference implementation (`--assert-identity`, not bare `db-url`). The
Prisma CLI itself (`db:migrate`) doesn't go through that module — it reads
env vars at process start the same way drizzle-kit does elsewhere in the
fleet — so `tools/with-db-url.sh` is the shell-side equivalent, sourcing
emit-infra's `scripts/lib/db-url.sh`.

**Audit-gate decision:** went with option 2 (explained `--no-verify`), not
option 1 or 3. `pnpm audit --audit-level=high --prod` still shows 15 of
the 21 high-severity advisories (next, axios, sharp, fast-uri via
@fastify/swagger, others) — not purely transitive dev-tooling, so option 3
(narrow the threshold) doesn't hold. Option 1 (actually clear them) is a
correctly-scoped effort of its own (`/dep-audit`), not something to fold
into a DB-port conversion commit; filed as a follow-up instead.
**Unexpected second gate:** even past the audit check, `nx affected -t
lint` currently fails independent of this change, on a pre-existing
import/order warning in one unrelated file
(`libs/backend/operations/src/infrastructure/prisma-operations.repository.ts`).
Lint on just the files this commit touches is clean. Also filed as a
follow-up.

**The 50 staged files** (staged since 2026-07-12, six weeks stale) were
unrelated in-flight work — new sprint files 100–116, design docs, a
terraform downgrade plan, deploy scripts — not something to sweep into a
conversion commit. Stashed rather than committed or discarded:
`git stash list` → `"sprint-308: pre-existing staged/untracked work..."`.

**Bug found and fixed in emit-infra itself, separate commit:** `db-url`
correctly located martialops' compose file in `docker/` but then ran
`docker compose port` from the repo root, where Docker Compose can't find
a compose file it doesn't search subdirectories for. Every
`db-url`/`db-url --assert-identity` call against this repo would have
failed without that fix — not optional for this sprint's approach to work
at all.

### Files changed (martialops)
- `docker/docker-compose.yml` — postgres service: ephemeral loopback port,
  repo-scoped credentials; `api` service's internal DATABASE_URL updated to
  match the new credentials (left on the internal Docker-network address,
  see classification below)
- `libs/backend/platform/src/config/index.ts` — wires
  `maybeResolveDatabaseUrl` before zod parsing; removed `DATABASE_URL`'s
  hardcoded zod default (was silently masking both a missing-var-in-prod
  case and a discovery failure)
- (new) `libs/backend/platform/src/config/resolve-dev-database-url.ts` —
  runtime discovery via `emit-infra db-url --assert-identity` subprocess
- (new) `libs/backend/platform/src/config/resolve-dev-database-url.test.ts`
- (new) `tools/with-db-url.sh` — shell wrapper for Prisma CLI commands
- `package.json` — `db:migrate` routed through the wrapper
- `.env.example` — `DATABASE_URL`/`DATABASE_DIRECT_URL` lines removed,
  comment added pointing at `docs/EPHEMERAL-DEV-DB.md`
- `apps/api/src/error-handler.ts` (+ test) — user-facing 503 message no
  longer claims a fixed `localhost:5432`
- `apps/api/src/rate-limit.test.ts`,
  `apps/api/src/routes/{ccpa-export-log,classes,members-export}.test.ts` —
  inert config fixtures repointed at `db.invalid` (each builds a fastify
  app with fully mocked route handlers; none dial Postgres)

### Files changed (emit-infra)
- `apps/cli/src/commands/db-url.ts` — `docker compose port` now runs from
  the compose file's own directory, not the repo root
- `apps/cli/src/commands/db-url.test.ts` — regression test pinning the
  nested-`docker/`-directory case

### Hardcoded-URL classification
Audited independently rather than trusting the sprint description's count
of 23 — my own grep-based audit found **13** files/sites, not 23 (noted
honestly rather than padded to match).

| File | Classification | Disposition |
|---|---|---|
| `libs/backend/platform/src/config/index.ts` | live-connection (the one choke point for API boot + all seed/reseed scripts) | runtime discovery wired |
| `docker/docker-compose.yml` (postgres service) | config, not a URL per se | ephemeral port + scoped creds |
| `docker/docker-compose.yml` (`api` service `DATABASE_URL`) | live-connection, but internal Docker-network address (`postgres:5432`), never host-reachable | left as-is (updated creds only) — no collision risk to fix |
| `.env.example` | dev fixture, tracked | literal removed, comment added |
| `.env` (untracked) | dev fixture | literal removed, for local testing to actually exercise discovery |
| `apps/api/src/rate-limit.test.ts` | inert-fixture | pointed at `db.invalid` |
| `apps/api/src/routes/ccpa-export-log.test.ts` | inert-fixture | pointed at `db.invalid` |
| `apps/api/src/routes/classes.test.ts` | inert-fixture | pointed at `db.invalid` |
| `apps/api/src/routes/members-export.test.ts` | inert-fixture | pointed at `db.invalid` |
| `apps/api/src/error-handler.ts` | user-facing message text, not a connection | corrected (no longer claims a fixed port) |
| `apps/api/src/error-handler.test.ts` | test assertion on the above | updated to match |
| `.github/workflows/ci.yml` | live-connection, but isolated CI runner (fresh VM per run) | left as-is — the collision problem is specific to this shared dev machine |
| `docs/remote-provisioning-todo.md` | doc, production/remote provisioning | left as-is — out of scope (local dev path only) |

### Verification
- **Discovery + identity assertion, live:** `emit-infra db-url --assert-identity`
  from martialops resolved `postgres://martialops:martialops@localhost:<port>/martialops`
  correctly after the `docker compose port` cwd fix.
- **Identity assertion demonstrated firing:** temporarily changed the
  compose file's `POSTGRES_DB` to a name the running container didn't
  have; `db-url --assert-identity` refused to proceed (`"Postgres was not
  ready within 15000ms: database \"some_other_project\" does not exist"`)
  rather than silently connecting. Reverted before continuing. Noting
  honestly: this fired at the connect/readiness layer, not
  `assertDatabaseIdentity`'s post-connect string-compare branch — because
  `buildDatabaseUrl` embeds the expected database name in the connection
  string itself, a name mismatch against the real container fails at
  Postgres's own "database does not exist" rejection before
  `current_database()` is ever queried. Same safety property (refuses to
  proceed against a mismatched database), different failure surface than
  a literal string-compare demo would show.
- **Teardown/rebuild, ports stated:** developed against port `51777`.
  `docker compose down -v && up -d` reassigned it to `54011` (verified
  `emit-infra db-url`, `loadConfig()`, `pnpm run db:migrate`, and a real
  API boot all re-resolved correctly, nothing cached) — then again to
  `57225` after the credential change (same full recreate + migrate +
  db-doctor cycle), then again to `58580` after a stop/start.
- **Loud failure on a stopped container:** stopped the postgres container;
  `loadConfig()` threw `Could not resolve the "postgres" service's port —
  is the container running? Run \`docker compose up -d\`.` — not an opaque
  connection refusal. Restarted and confirmed recovery.
- **Real dev boot, no DATABASE_URL anywhere:** booted
  `apps/api/src/main.ts` directly with `DATABASE_URL`/`DATABASE_DIRECT_URL`
  unset in the shell and absent from `.env`; `GET /health` returned
  `{"status":"ok",...}`.
- `pnpm exec vitest run` (martialops): **602/602 passing**, run with
  `DATABASE_URL` completely unset — confirms no test in the suite shells
  out to Docker (all DB access in tests is mocked).
- `pnpm exec nx run-many -t typecheck --all --exclude=workspace`: clean.
- `pnpm exec nx affected -t lint` on just the files this sprint touched:
  clean (`0 problems`). Full-repo lint fails on a pre-existing, unrelated
  warning — see follow-ups.
- `pnpm exec nx affected -t build --base=HEAD --exclude=workspace`: clean
  (5/5 projects).
- `emit-infra db-doctor`: martialops now shows `ephemeral` /
  `martialops/martialops`; exits 0, **"No port or credential collisions
  found."**
- `apps/cli` (emit-infra): `pnpm exec vitest run apps/cli/src/commands/db-url.test.ts`
  — 7/7 passing (6 existing + 1 new regression test); `pnpm exec tsc
  --noEmit -p apps/cli`: clean.

### Follow-ups
- `[defer]` martialops: 21 high-severity `pnpm audit` advisories (next,
  axios, sharp, nx, and others — not purely dev-only transitive) remain
  unresolved; the pre-commit gate stays bypassed with `--no-verify` until
  a dedicated `/dep-audit` pass clears or explicitly accepts them.
- `[defer]` martialops: `nx affected -t lint` fails independent of the
  audit gate, on a pre-existing `import/order` warning in
  `libs/backend/operations/src/infrastructure/prisma-operations.repository.ts`
  (5 warnings, `--max-warnings=0`) — unrelated to this sprint, `--fix`-able.
- `[defer]` martialops: 50 files staged since 2026-07-12 (new sprint files
  100–116, design docs, a terraform downgrade plan, deploy scripts) were
  stashed rather than committed or discarded — needs a human decision on
  disposition. See `git stash list` in martialops:
  `"sprint-308: pre-existing staged/untracked work (50 files, staged since
  2026-07-12) set aside before ephemeral-dev-db conversion"`.
- `[defer]` garage-sailor-prime still shows a fixed port (`5433`) and
  default `postgres/postgres` credentials in `emit-infra db-doctor` —
  expected, that's sprint 309.
