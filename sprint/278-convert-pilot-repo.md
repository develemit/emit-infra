# Sprint 278 — Convert one repo end-to-end and harden the recipe

## Goal

`garage-sailor` runs entirely on the ephemeral pattern — dev and test — using
only the tooling and recipe from sprints 275–277. The conversion either proves
the recipe transfers to a repo nobody has touched, or exposes what the recipe
is still missing while the cost of finding out is one repo.

## Why a pilot before the sweep

emit-billing sprint 64 tried to sweep ten repos in one pass and stopped
without converting any, because the work per repo turned out to be roughly a
full sprint rather than a line change. The lesson worth encoding: **prove the
recipe on one untouched repo before scaling it.** emit-billing itself doesn't
count — it is where the pattern was invented, so it cannot demonstrate that
the recipe is portable.

`garage-sailor` is the right pilot precisely because it is the least
interesting: no test file opens a database connection, exactly one TypeScript
file carries a hardcoded URL, and its credentials are already project-scoped
so nothing subtle is hiding in the failure mode.

## Context

- **Sprints 275–277 are hard prerequisites.** 275 gives the inventory and the
  before/after collision check, 276 the `db-url` resolver, 277 the decided
  dev path and the conversion recipe in `docs/EPHEMERAL-DEV-DB.md`. Follow
  that recipe; if it is wrong, fix the recipe as part of this sprint rather
  than working around it locally.
- **`garage-sailor` as audited 2026-08-14** (emit-billing sprint 64):
  `docker-compose.yml` publishes `'5436:5432'`; credentials
  `garage-sailor`/`garage-sailor`, database `garage-sailor`; zero test files
  touch a live database; one `.ts` file carries a hardcoded URL. Known
  hardcoded-port sites beyond the compose file:
  - `drizzle.config.pg.ts:10` — `postgres://garage-sailor:garage-sailor@localhost:5436/garage-sailor`
  - `packages/db/README.md:27` — same URL, documented
  - `docs/DEPLOY.md:122` — same URL, documented
  - `.env.example` — hardcoded port
  - `.env` — **gitignored**, hardcoded port, cannot be fixed by a commit; this
    is what the developer migration note from sprint 277 is for
  Re-verify all of these; the audit will have aged.
- **5436 is no longer contended** — emit-billing vacated it in its sprint 60 —
  so this conversion is not urgent on collision grounds. That is a feature for
  a pilot: it can be done carefully without pressure.
- `drizzle.config.pg.ts` is a drizzle-kit config, so it hits the CJS
  top-level-await constraint documented in sprint 276. It must reach the
  resolver by subprocess, not import.
- **Honour this repo's own conventions and verification command**, not
  emit-billing's. Read its `CLAUDE.md` if present and run whatever it
  specifies.
- emit-infra's fleet convention is **one commit per repo touched**.

## Tasks

1. Baseline first: run `garage-sailor`'s own verification command and record
   the result **before** changing anything. If it is already red for unrelated
   reasons, stop and report — do not convert on top of a red suite.
2. Note that `garage-sailor` currently has uncommitted work in some checkouts.
   Confirm the tree state before starting; if dirty with unrelated changes,
   report and stop rather than mixing this conversion into someone else's
   work in progress.
3. Change `docker-compose.yml` to `127.0.0.1::5432`, keeping container name,
   credentials and volume untouched.
4. Apply the sprint-277 dev path so `pnpm dev` resolves the port with no
   hardcoded value.
5. Point `drizzle.config.pg.ts` at the resolver by subprocess, and remove its
   hardcoded fallback.
6. Update `.env.example`, `packages/db/README.md` and `docs/DEPLOY.md` to stop
   teaching a fixed port and to document `emit-infra db-url` instead.
7. Add the identity assertion wherever this repo's tooling connects, so a
   wrong database aborts rather than proceeding. If genuinely nothing in this
   repo connects during tests, say so explicitly and record where the
   assertion *would* attach when it does.
8. Commit once, with the sprint-277 developer migration note in the message.
9. Feed anything the recipe got wrong back into `docs/EPHEMERAL-DEV-DB.md` —
   that correction is a deliverable of this sprint, not an afterthought.

## Acceptance criteria

- [x] `garage-sailor`'s `docker-compose.yml` names no fixed host port and
      binds loopback only
- [x] `pnpm dev` works in `garage-sailor` from a `.env` with no hardcoded
      port, and its own verification command passes with no `DATABASE_URL`
      override — both recorded, with the pre-change baseline for comparison
- [x] `grep -rn "localhost:5436"` in `garage-sailor` returns nothing outside
      `.env` (gitignored) and any deliberate historical note
- [x] `pnpm db:migrate` (or this repo's equivalent) runs with no hardcoded
      port and no manual `DATABASE_URL`
- [x] Pointing the repo at a wrong database fails loudly — name the check or
      test that demonstrates it, or record explicitly that nothing in this
      repo connects during tests and where the assertion will attach
- [x] Exactly one commit in `garage-sailor`, carrying the developer migration
      note
- [x] `docs/EPHEMERAL-DEV-DB.md` updated with whatever the recipe got wrong,
      or an explicit statement that it transferred unchanged
- [x] Sprint 275's doctor reports `garage-sailor` as `ephemeral`

## Out of scope

Every other repo — 279 onward. Do not opportunistically convert a second repo
"while in there": the point of a pilot is to learn the recipe's gaps at the
cost of one repo. Changing `garage-sailor`'s stack, Postgres version,
credentials, or migrating data. Production database configuration.

## Completed

**Date:** 2026-08-15

### Summary

`garage-sailor` now runs its dev Postgres on an ephemeral loopback port and
resolves `DATABASE_URL` automatically via `emit-infra db-url`, following the
sprints 275–277 recipe. `docker-compose.yml` publishes `127.0.0.1::5432`
instead of the fixed `5436`. A new `apps/api/src/resolve-dev-database-url.ts`
(mirroring emit-billing's pilot implementation, sprint 277) resolves
`DATABASE_URL` at the top of `main.ts` — the repo's sole dev-boot process
entrypoint — before `validateEnv()` or any other read, and writes the result
back to `process.env` so `server.ts`'s own independent `DATABASE_URL` read
also sees it. `drizzle.config.pg.ts` resolves the same way via subprocess
(drizzle-kit's CJS config loader can't use top-level await) with its
hardcoded fallback removed.

One correction to the recipe, made and documented as part of this sprint:
both resolvers call `emit-infra db-url --assert-identity`, not bare
`db-url`. The emit-billing reference implementation doesn't pass this flag —
untested because emit-billing's own dev boot has always used this exact path,
so a mismatch would have surfaced immediately rather than needing a separate
check. garage-sailor's dev boot creates a real `pg.Pool` from whatever URL
comes back, so the identity guarantee needed to attach there too, not just in
the test path's `globalSetup`. Verified live: `assertDatabaseIdentity`
correctly rejects a deliberately mismatched database (a throwaway
`impostor`-named container) with `Refusing to proceed: connected to database
"impostor", expected "garage-sailor".` — see `docs/EPHEMERAL-DEV-DB.md`'s new
"Sprint 278 pilot" section.

The pilot also surfaced something that isn't a recipe gap but matters for
sprints 279–281: garage-sailor's dev boot silently falls back to an
in-memory SQLite client when `DATABASE_URL` is unset, and no `.env` existed
in the piloted checkout — meaning this was the *first time this checkout's
Postgres path had ever actually been dev-booted*. Doing so exposed that
`apps/api/src/domains/sales/drizzle-repo.ts` is written entirely against
`better-sqlite3`'s synchronous API (`.all()`/`.run()`), which doesn't exist
on the `drizzle-orm/node-postgres` client this sprint's `DATABASE_URL` now
auto-populates. The server still boots and serves `/health` — the failure is
caught and logged inside a single Fastify `onReady` hook, not a crash — but
every sales-domain route (list, create, update, purge) would hit the same
`.all is not a function` / `.run is not a function` error the moment it's
exercised against real Postgres, which is now the automatic default whenever
`docker compose up -d` has been run. This is a pre-existing bug unrelated to
DATABASE_URL resolution or port assignment — it would occur with any working
Postgres URL, hardcoded or discovered — but this sprint's conversion is what
makes it reachable by default rather than by opt-in, so it's flagged as a
follow-up rather than silently left for someone to trip over.

### Files changed

**emit-infra:**
- `docs/EPHEMERAL-DEV-DB.md` — recipe step 3 now specifies
  `--assert-identity`; new "Sprint 278 pilot" section documents both findings
  above

**garage-sailor** (one commit, `0844829`):
- `docker-compose.yml` — `'5436:5432'` → `'127.0.0.1::5432'`
- (new) `apps/api/src/resolve-dev-database-url.ts` — `resolveDevDatabaseUrl` /
  `maybeResolveDatabaseUrl`, mirroring emit-billing's pilot shape, with
  `--assert-identity` added
- (new) `apps/api/src/resolve-dev-database-url.test.ts` — unit coverage for
  explicit-wins, production-never-resolves, discover-called-and-merged, and
  missing-CLI error messaging
- `apps/api/src/main.ts` — resolves + writes back `DATABASE_URL` before
  `validateEnv()` and any other read
- `drizzle.config.pg.ts` — resolves via subprocess with `--assert-identity`,
  hardcoded fallback removed
- `.env.example`, `packages/db/README.md`, `docs/DEPLOY.md` — document
  auto-discovery instead of the fixed port

### Verification

- **Baseline** (before any change): `pnpm check:all` — all checks passed in
  5s.
- **After conversion:** `pnpm check:all` — all checks passed (4s, then 14s on
  a re-run after live testing); ran with no `DATABASE_URL` set anywhere.
  47/47 tests pass in `apps/api` (includes the 5 new resolver tests).
- `docker compose ps` after `up -d`: `127.0.0.1:<ephemeral>->5432/tcp` — no
  fixed port; confirmed the port changes across a `stop`/`up -d` cycle
  (56548 → 64075) and `pnpm db:migrate` picked up the new port with no code
  change.
- `pnpm db:migrate` with no `DATABASE_URL` set: `migrations applied
  successfully!`, twice (initial and post-restart).
- `node .../emit-infra db-url --assert-identity` from `garage-sailor/`:
  returns the correct URL against the real container.
- Live dev boot (`tsx apps/api/src/main.ts`, no `DATABASE_URL`): connects,
  listens, `GET /health` → `{"status":"ok"}`.
- Stopped the container, re-ran discovery: `Could not resolve the "postgres"
  service's port — is the container running? Run \`docker compose up -d\`.`
  — actionable, not an opaque `ECONNREFUSED`. Same for
  `resolveDevDatabaseUrl()` directly, wrapped with the `pnpm infra:up` hint.
- `grep -rn "localhost:5436"` in `garage-sailor`: zero hits outside
  `sprint/milestone-01/...md` (historical) and the gitignored `.env` (which
  doesn't exist in this checkout).
- `emit-infra db-doctor`: `garage-sailor  ephemeral  ...`.
- Wrong-database rejection demonstrated live against a throwaway `impostor`
  container (see Summary) using the same `assertDatabaseIdentity` call
  `--assert-identity` invokes.

### Follow-ups

- `[blocker]` `apps/api/src/domains/sales/drizzle-repo.ts` in garage-sailor
  is written entirely against `better-sqlite3`'s synchronous `.all()`/`.run()`
  API and throws against the `drizzle-orm/node-postgres` client this
  sprint's `DATABASE_URL` auto-discovery now activates by default whenever
  `docker compose up -d` has been run. Every sales-domain route is affected,
  not just the `purgeSales` `onReady` hook that surfaced it. Needs a
  decision: port the sales repo to the async Postgres API, or scope this
  sprint's dev-path wiring so it doesn't silently flip garage-sailor's
  canonical dev database out from under a repo whose Postgres persistence
  layer was never finished.
- `[address-next]` `packages/db/README.md` in garage-sailor has other stale
  boilerplate from the `/init-project` template beyond the `DATABASE_URL`
  line this sprint fixed — e.g. it references `@garage-sailor/db` and a
  `getDb()` export that don't match the actual `@org/db` package / exports.
  Not touched here (out of scope), but a 10-minute fix next time someone's
  in that file.
- `[defer]` `garage-sailor`'s `.env.example` still lists `DATABASE_URL`
  (commented, documented) even though the recipe's ideal end state is no
  mention at all — kept the line commented-out rather than deleted since the
  override escape hatch is worth documenting inline; revisit if sprints
  279–281 converge on a cleaner convention.
