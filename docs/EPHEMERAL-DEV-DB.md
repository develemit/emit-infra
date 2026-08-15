# Ephemeral dev Postgres: the port collision problem, and how repos consume it

Sprint 277 findings. This is the fleet convention for how a repo's local dev
Postgres gets a collision-free port, and — the harder half — how a
developer's existing `.env` and the app's own dev boot path learn that port
without a hardcoded fallback creeping back in.

## The problem

This machine runs many projects' dev Postgres containers side by side. Every
repo used to hand-pick a fixed host port (5432, 5433, 5434, …) in its
`docker-compose.yml`. Ports ran out and got reused: emit-billing's own
`localhost:5436` fallback silently collided with
`immigration-pro360-postgres-e2e`, which had independently claimed 5436 —
tests dialed the wrong project's database and got real (if not obviously
wrong) answers back, because both were reachable Postgres instances (sprint
60, emit-billing). Two other collisions were found live during the sprint
275 fleet inventory: `develemail`/`garage-sailor-prime` both on 5433, and
`diner-decider`/`emit-social` both on 5435 — different credentials in each
case, so cross-connects fail auth today, but that's luck, not a safety
property.

**The fix is ephemeral loopback ports.** `docker-compose.yml` publishes
`'127.0.0.1::5432'` — no fixed host port, Docker assigns a free one, bound to
loopback only. `docker compose port postgres 5432` discovers whatever it
picked. This is settled (emit-billing sprints 60–62) and not re-opened here.

**What's left is consumption.** A discovered port doesn't stay discovered:
`docker compose down -v` reassigns it, and every consumer — `.env`, tests,
migrations, and now local dev boot — has to re-resolve rather than cache.
Tests solved this with a vitest `globalSetup` hook (below). Local dev has no
equivalent bootstrap hook, and that gap is what this doc closes.

## The reference test-path pattern (emit-billing sprints 60–62)

Not re-litigated here — cited because the dev-path decision below has to
compose with it, not duplicate it:

- `packages/db/src/test-db.ts`'s `globalSetup` (vitest): discovers the port
  via `docker compose port postgres 5432`, waits for the container to accept
  connections, asserts `current_database()` matches what's expected (refusing
  to run against a foreign project's database), applies migrations, then sets
  `process.env.DATABASE_URL` for the test run.
- `apps/e2e/resolve-database-url.ts` + `playwright.config.ts`: the same shape
  at e2e-suite boundary, with a `skipDiscovery` short-circuit so
  `E2E_NO_WEBSERVER=1` (a remote deployed host, no local Docker) never shells
  out to `docker compose port` at all.
- `drizzle.config.ts`: resolves synchronously (drizzle-kit bundles this file
  to CJS, ruling out top-level await) by shelling out to `docker compose
  port` directly.

All three predate the `emit-infra db-url` CLI (sprint 276) and duplicate its
port-parsing logic rather than import it — acceptable since they already
work and this sprint's job was the one remaining gap, not a refactor of
working code. New consumers (this doc's dev-path mechanism, and future
sweeps) should call the CLI instead of adding a fourth reimplementation.

## The sprint 276 subprocess constraint

`emit-infra db-url` prints a repo's resolved dev Postgres URL to stdout,
built via `packages/core`'s compose-parsing + `docker compose port`
machinery. Every consumer reaches it **by subprocess, not import** —
`drizzle-kit`'s CJS-bundled config loader and `@nx/playwright`'s project-graph
loader both fail on `@emit-infra/core`'s ESM/top-level-await chain when
imported directly (emit-infra sprint 276; the same wall emit-billing sprints
61–62 hit one layer deeper with `resolveTestDatabaseUrl`). Two shapes are
supported:

- **From TypeScript**, `execFileSync('node', [cliPath, 'db-url'])` against
  the built CLI (`apps/cli/dist/index.js`) — what this sprint's dev-path
  mechanism uses.
- **From a shell script**, `scripts/lib/db-url.sh` — `source` it, then call
  `emit_db_url` / `emit_db_url_assert_identity`. For Makefiles, git hooks, or
  anything that can shell out but not `require()`.

Either way, the CLI must be **built** (`pnpm build` in `emit-infra`) before a
consuming repo's dev-discovery can succeed — see the migration note below for
what a stale/missing build looks like from the consuming repo's side.

## The dev-path decision

**Chosen: the app resolves `DATABASE_URL` at runtime, inside its own config
module, when `DATABASE_URL` is unset and `NODE_ENV !== 'production'`.**
Implemented as `packages/config/src/resolve-dev-database-url.ts` +
`env.ts`'s `loadEnv()` in emit-billing (the pilot). No new file, no
`predev` hook, no manual copy-paste step.

```ts
// resolve-dev-database-url.ts
export function maybeResolveDatabaseUrl(source, discover = resolveDevDatabaseUrl) {
  if (source.DATABASE_URL) return source;       // explicit value always wins
  if (source.NODE_ENV === 'production') return source; // never touch Docker in prod
  return { ...source, DATABASE_URL: discover() };
}
```

`loadEnv()` calls this before validating against its zod schema, passing
`resolveDevDatabaseUrl` (the real `emit-infra db-url` subprocess call)
explicitly rather than relying on the function's own default — the explicit
pass is what makes the production guard and the discovery path both
independently mockable in tests without a live subprocess.

**One thing this alone doesn't cover, discovered mid-pilot:** any code that
reads `process.env.DATABASE_URL` directly instead of consuming `loadEnv()`'s
returned object (emit-billing's `packages/db/src/client.ts` does exactly
this) never sees the resolved value — `loadEnv()` returning it isn't the same
as it being *in* `process.env`. The fix, following the same convention the
vitest `globalSetup` already established: whoever calls `loadEnv()` at
process boot writes the result back — `process.env.DATABASE_URL =
env.DATABASE_URL;` right after the `loadEnv()` call, once per process
entrypoint (emit-billing's `apps/api/src/main.ts` and
`apps/worker/src/main.ts`). `loadEnv()` itself stays pure and does not mutate
`process.env` — an existing test already pins that contract for the
already-set case, and widening it to the mutate-on-discover case would break
the one guarantee callers rely on to reason about repeated calls.

### Rejected options

**Option 1 — `predev` script writes a gitignored `.env.local` fragment.**
Rejected: costs a subprocess on every `pnpm dev` invocation up front (not
just the ones that actually need discovery — an explicit `DATABASE_URL`
would still pay the round trip unless the script special-cased it), needs
every consuming repo's env loader taught to read the fragment, and adds a
file whose staleness after `docker compose down -v` isn't obvious the way an
error at `loadEnv()` time is. The chosen option gets the same "zero developer
action after conversion" property without the extra file or the loader
change.

**Option 3 — documented one-time manual edit.** Rejected outright, and
fastest to rule out: the port isn't stable across `docker compose down -v`,
so a pasted `DATABASE_URL` goes stale the next time a developer resets their
volume, with no signal that it happened beyond an opaque connection failure
that looks identical to "the container isn't running." This is exactly the
failure mode ephemeral ports were adopted to eliminate — reintroducing it at
the `.env` layer would undo the sprint 60 fix one layer up.

### Why the runtime-resolve option and not a `predev` hook, restated

Fewest moving parts: no new file to go stale, no loader change, and the
production guard lives in exactly one place (`maybeResolveDatabaseUrl`)
instead of needing to be re-proven wherever a `predev` script's output gets
consumed. The cost — a subprocess shell-out on every non-production boot
that doesn't already have `DATABASE_URL` set — is paid once per process
start, not per request, and is the same cost the existing test/e2e paths
already accept.

## Guarantees, and how each is demonstrated (not just asserted)

- **An explicit `DATABASE_URL` always wins**, in every environment. Verified
  by mocking discovery to throw and confirming `loadEnv({DATABASE_URL: ...})`
  never calls it, and live: pointed `loadEnv` at a real running container
  with an explicit override URL set, got the override back untouched, the
  container's actual URL never queried.
- **Never reaches for Docker in production.** `maybeResolveDatabaseUrl`
  returns its input untouched when `NODE_ENV === 'production'` and
  `DATABASE_URL` is unset — the missing var falls through to the normal zod
  validation error instead. Covered by a test that mocks discovery to throw
  if called and asserts it never is
  (`packages/config/src/env.test.ts`: *"never invokes discovery in
  production"*; `resolve-dev-database-url.test.ts`: *"never calls discover in
  production"*).
- **Stopping the container fails loudly, not with an opaque connection
  refusal.** `emit-infra db-url` itself refuses to print a URL when the
  container isn't running (sprint 276) — discovery fails before any Postgres
  connection is attempted, and the error names the fix (`Run \`docker
  compose up -d\``). Demonstrated live: stopped emit-billing's container,
  called the resolver, got `DATABASE_URL is unset and dev auto-discovery via
  \`emit-infra db-url\` failed: ... Run \`pnpm infra:up\` and retry, or set
  DATABASE_URL explicitly.` — not a bare `ECONNREFUSED`.
- **Port drift after `docker compose down -v` is transparent.** Discovery
  runs fresh on every process boot (nothing caches the port across restarts);
  restarting the container mid-pilot reassigned its port and the very next
  `loadEnv()` call picked up the new one with no code change.

## Per-repo conversion recipe

For each repo in the sprint 278–281 rollout:

1. Confirm the repo's `docker-compose.yml` already publishes
   `'127.0.0.1::5432'` (or equivalent) rather than a fixed host port — sprint
   275's inventory says whether this repo needs that step too.
2. Find every place `DATABASE_URL` (or an equivalent config module) is read
   for the **dev** boot path specifically — not tests, not migrations, both
   of which likely already have their own resolution if the repo followed
   emit-billing's test-path pattern. Grep for `process.env.DATABASE_URL` and
   for the repo's own env-loading module; check both, per the gap this
   sprint found (`loadEnv()`'s return value isn't automatically in
   `process.env`).
3. Wire in `maybeResolveDatabaseUrl`-equivalent logic at that boundary:
   explicit value wins, production never resolves, otherwise shell out to
   `emit-infra db-url --assert-identity` (subprocess — see the constraint
   above, and the sprint 278 correction below on why `--assert-identity` and
   not bare `db-url`) and write the result back to `process.env.DATABASE_URL`
   at the process entrypoint.
4. Run the repo's own dev boot with **no `DATABASE_URL` anywhere** (not in
   `.env`, not in the shell) and confirm it connects. Stop the container and
   confirm the failure is actionable, not an opaque refusal. If anything in
   the repo's dev boot path also runs migrations or seeds against the
   database (a drizzle-kit config, a boot-time migrate call), point it at the
   resolver the same way — don't leave a second, unconverted read site.
5. Update the repo's `.env.example` (create one if it doesn't exist) to omit
   `DATABASE_URL` entirely, with a one-line comment pointing here. Add `.env`
   to `.gitignore` if it isn't already.
6. Paste the developer migration note below into the conversion commit
   message.
7. Run the repo's own verification command (`pnpm check:all` or equivalent)
   clean before considering the repo converted.

## Sprint 279: a second read site, and a Playwright/`import.meta.url` trap

`tastease` (emit-infra sprint 279) converted cleanly via `packages/db/src/env.ts`
for dev boot, migrations, and seeding — but its Playwright e2e suite
(`e2e/support/reset-seed-household.ts`, `stripe-teardown.ts`) connects to
Postgres directly via `pg`/`Stripe`, bypassing `packages/db` entirely and
reading `DATABASE_URL` from a dotenv-loaded `e2e/support/test-env.ts`. This is
exactly the "second, unconverted read site" the recipe's step 4 already warns
about — worth restating because it's easy to miss: grepping for
`process.env.DATABASE_URL` is not enough if the repo has a test/e2e harness
with its own env-loading module separate from the app's.

**New finding: don't put `import.meta.url` in a resolver module that
Playwright's own TS loader will import.** The first attempt computed a
default `cwd` inside the shared resolver via
`dirname(fileURLToPath(import.meta.url))` — works fine under `tsx` (used by
dev boot, migrations, `db:seed`), but Playwright's TS transform choked on it
with `ReferenceError: exports is not defined in ES module scope` when the
same file was reached from `e2e/support/test-env.ts` (which itself uses the
CJS `__dirname`, not `import.meta.url` — Playwright compiles that subgraph
as CommonJS, and the ESM-only `import.meta.url` doesn't survive the
transform). The fix: don't compute a default `cwd` inside the shared
resolver at all — make it a required parameter and let each caller supply
its own repo-root path, computed however already works in that caller's own
module context (`import.meta.url` in an ESM/tsx context,
`resolve(__dirname, "..")` in whatever context Playwright's loader gives
you). A shared resolver that tries to be clever about locating its own
working directory is exactly the part that doesn't port across loaders.

## Sprint 278 pilot: what the recipe got right, what it corrected

`garage-sailor` (emit-infra sprint 278) was the first repo converted since
this doc was written, and the first one where the resulting `DATABASE_URL`
actually got used to boot the app against a live container — emit-billing
*is* this pattern's dev boot, so its own conversion couldn't test that. Two
findings:

**Correction: the dev-path resolver should call `--assert-identity`, not
bare `db-url`.** The emit-billing reference implementation
(`resolve-dev-database-url.ts`) doesn't pass it — that gap wasn't caught
because emit-billing's dev boot has always used this exact port-discovery
path, so a mismatch would have shown up immediately in the deployment that
proved the mechanism, not silently. A newly converted repo doesn't have that
history: dev boot creates a real Postgres pool from whatever URL comes back,
so an unresolved identity risk (a stale ephemeral port reassigned to a
different project's container between the `docker compose port` call and the
connection, or a compose file with a wrong `POSTGRES_DB`) should fail loudly
there too, not just in the test path's `globalSetup`. Both of garage-sailor's
call sites (`apps/api/src/resolve-dev-database-url.ts`,
`drizzle.config.pg.ts`) now pass it; the recipe step above reflects this.

**Not a recipe gap, but worth a repo-specific check before converting: a
repo may have a working non-Postgres dev fallback that the Postgres path
was never actually exercised against.** garage-sailor's `apps/api/src/main.ts`
falls back to an in-memory SQLite client when `DATABASE_URL` is unset —
before this sprint, no `.env` existed in the piloted checkout, so dev boot
had *always* run on that fallback, and the pilot's live dev-boot test was
the first time this checkout ever connected to real Postgres. It surfaced a
pre-existing, unrelated bug: `apps/api/src/domains/sales/drizzle-repo.ts` is
written entirely against `better-sqlite3`'s synchronous `.all()`/`.run()`
API, which doesn't exist on the `drizzle-orm/node-postgres` client
`createPgDb` returns — so the sales domain throws against Postgres. This
sprint's job was port/URL discovery, not that repo's persistence layer, so
it wasn't fixed here (see garage-sailor's sprint 278 follow-ups). The
transferable lesson: before converting a repo, check whether it has a
non-Postgres dev fallback and, if so, whether anyone has actually dev-booted
it against Postgres recently — a clean `check:all` doesn't catch this, since
unit tests run against their own (often SQLite, in-memory) fixture and never
exercise the boot-time `DATABASE_URL` branch at all.

## Developer migration note

Paste this into each conversion commit message (sprints 278–281):

> This repo's dev Postgres now runs on an ephemeral loopback port instead of
> a fixed one, to stop colliding with other projects' containers on this
> machine. If you have an existing `.env` with a hardcoded `DATABASE_URL`
> pointing at the old fixed port: **delete that line.** The app now resolves
> it automatically via `emit-infra db-url` whenever `DATABASE_URL` is unset
> and you're not running in production — nothing else to do. If you want to
> point at a different database on purpose, set `DATABASE_URL` explicitly and
> it still overrides the automatic resolution, same as before.
>
> Requires `~/projects/emit-infra` built (`pnpm build`) — if `pnpm dev` fails
> naming `emit-infra CLI not found`, that's the fix.

## `/init-project` template story

The template's scaffolded `apps/api-template/src/main.ts` reads `PORT` and
`HOST` from `process.env` directly and does not wire a database client into
its dev boot path at all — no `packages/config`-equivalent module exists in
the template, and nothing in it requires `DATABASE_URL`. The template's
*test* path already has the ephemeral pattern (`db-drizzle/drizzle/test-db.ts`
+ `drizzle.config.ts`, emit-billing sprint 63) — that's the one path a fresh
scaffold actually exercises today.

**A newly scaffolded project does not get the dev-path mechanism
automatically.** It doesn't need it until a project adds a DB client to its
dev boot path (the same point where emit-billing's own gap was), at which
point follow this doc: reuse `resolveDevDatabaseUrl` /
`maybeResolveDatabaseUrl`'s shape (`packages/config/src/
resolve-dev-database-url.ts` in emit-billing is the reference
implementation) rather than reinventing it, and remember the
`process.env.DATABASE_URL` write-back this doc's pilot needed. Pre-wiring
this into the template before any scaffolded project has a database client
in its dev path would be speculative — nothing to test it against yet.
