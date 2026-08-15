# Sprint 276 — `emit-infra db-url`: one portable resolver every stack can call

## Goal

Any repo, in any stack, can obtain its dev database URL by shelling out to one
emit-infra command — no shared TypeScript import, no ESM/CJS negotiation, no
hardcoded port. This is the seam the whole fleet rollout stands on.

## Why a subprocess and not a shared module

This is the sprint's one real design constraint, and it was learned the hard
way rather than guessed. Two independent attempts to import a shared resolver
from a config file failed in emit-billing:

- **drizzle-kit** loads `drizzle.config.ts` through its own esbuild-based
  `require()`, which bundles to CJS and rejects top-level await outright:
  `Transform failed... Top-level await is currently not supported with the
  "cjs" output format` (emit-billing sprint 61).
- **`@nx/playwright`**'s project-graph plugin loads `playwright.config.ts`
  through a CJS-first `require()` that resolves relative `.js` specifiers
  *literally* rather than rewriting them to a sibling `.ts` source, and cannot
  evaluate `import.meta.url`. Both are hard failures that break nx's entire
  project graph (emit-billing sprint 62).

Both repos ended up duplicating the small port-parsing logic locally, which is
tolerable twice and unacceptable across ten repos. A **CLI subprocess** is the
portable seam: `execFileSync` works identically from an ESM module, a CJS
config bundle, a shell script, a `package.json` script, and a Makefile. That
is why this belongs in emit-infra rather than in a shared npm package.

## Context

- **Sprint 275 is a prerequisite** — its compose-parsing logic (three filename
  styles, nested `docker/`, credential extraction) is the same logic this
  command needs to build a URL. Reuse it rather than writing a second parser;
  factor it into `packages/core` if that is where 275 left it.
- **Reference implementation** to mirror in behaviour:
  `~/projects/emit-billing/packages/db/src/test-db.ts`. Its shape, worth
  preserving: `parseComposePort` handles both `0.0.0.0:54321` and
  `127.0.0.1:54321` forms of `docker compose port` output; `resolveTestDatabaseUrl`
  takes an injectable `queryPort` so the failure path unit-tests without
  Docker; the not-running error names the fix (`run pnpm infra:up`) rather
  than surfacing a raw exec error.
- **The identity assertion is the highest-value half of the pattern** — it is
  what converts "silently ran against the wrong database" into an immediate,
  obvious failure. `select current_database()` compared against the expected
  name, erroring with both the found and expected values. Any repo adopting
  the resolver should be able to get this from the same command rather than
  reimplementing it.
- Postgres is not instantly ready after `docker compose up`; the reference
  implementation polls a trivial query for 15s at 200ms intervals before
  declaring failure. A resolver that returns a URL to a not-yet-accepting
  container just moves the error somewhere less legible.
- CLI commands live in `apps/cli/src/commands/` and register via
  `register<Name>(program)` in `apps/cli/src/index.ts`.
- Consumers will call this in hot paths (every `pnpm dev`, every test run), so
  it must be fast and quiet: URL on stdout, nothing else, diagnostics on
  stderr.

## Tasks

1. Add the command. Run from a repo root, it discovers the Postgres service's
   ephemeral host port via `docker compose port <service> 5432`, reads
   credentials and database name from that repo's own compose file, and prints
   the URL on stdout and nothing else.
2. Default the service name to `postgres` but allow an override, since not
   every repo names it that.
3. Fail with an actionable message when the container isn't running — name the
   command that fixes it — and exit non-zero. Never print a partial or
   guessed URL.
4. Add an identity-assertion mode that connects, runs `select
   current_database()`, and exits non-zero with both found and expected names
   on mismatch. Callers must be able to use this as a gate before seeding.
5. Add a readiness wait (bounded, with a timeout that errors clearly) so a
   just-started container doesn't produce a misleading connection failure.
6. Expose the same resolution to shell consumers — a function in
   `scripts/lib/` if the git hooks will need it — covered by
   `pnpm test:hooks`.
7. Unit-test: port parsing for both output forms and malformed input, the
   not-running failure message, service-name override, credential extraction
   per compose style, and the identity assertion accepting the right database
   and rejecting a wrong one. Docker must not be required by any of these.

## Acceptance criteria

- [ ] Run from `~/projects/emit-billing` (already ephemeral, container up),
      the command prints a working URL whose port matches
      `docker compose port postgres 5432`
- [ ] `psql "$(emit-infra db-url)" -c 'select 1'` succeeds from that repo —
      the printed URL is genuinely connectable, not merely well-formed
- [ ] With the container stopped, it exits non-zero and names the fix; stdout
      carries no URL
- [ ] Identity-assertion mode exits zero against the matching database and
      non-zero against a wrong one, naming both values
- [ ] Called via `execFileSync` from a CJS-bundled config file, it returns the
      URL — demonstrating the seam survives the drizzle-kit/nx loaders that
      defeated the shared-import approach
- [ ] Port parsing, failure messaging, credential extraction and the identity
      assertion are covered by unit tests requiring neither Docker nor a
      specific repo
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:hooks` green

## Out of scope

Converting any repo (278–281) and deciding how `.env` consumes this (277) —
this sprint ships the mechanism only. Changing emit-billing's existing
`test-db.ts` or the `/init-project` template: both work today, and
retrofitting them onto this command is a later cleanup, not a prerequisite.
Any production database configuration.
