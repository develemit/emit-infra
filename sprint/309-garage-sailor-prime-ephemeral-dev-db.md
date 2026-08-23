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
- Compose publishes an ephemeral loopback port.
- The test bootstrap performs all five steps, with the env-injection ordering
  problem explicitly resolved and explained.
- `listings.test.ts` passes against a freshly recreated container on a
  different port than it was developed against — state both ports.
- The identity assertion is shown rejecting a foreign database.
- No live-connection consumer retains a hardcoded port; inert fixtures point at
  a non-routable host.
- The `mobile` Jest failure is documented as pre-existing and unchanged.
- `emit-infra db-doctor` reports the fleet clean (assumes sprint 308 landed; if
  it hasn't, martialops remaining is the expected sole exception).
- Sprint 279's repo table updated; work committed in garage-sailor-prime.
