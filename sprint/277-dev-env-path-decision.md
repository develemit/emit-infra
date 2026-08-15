# Sprint 277 — Settle the `.env` dev path, and write it down as fleet convention

## Goal

A decided, documented answer to "how does a developer's existing `.env` learn
the ephemeral port?" — implemented once, in emit-infra's docs and tooling, so
the ten repo conversions that follow all do the same thing.

## Why this is its own sprint

This is the exact question that stopped emit-billing sprint 64 mid-flight, and
it is the reason a ten-repo sweep cannot simply be started.

The ephemeral pattern was proven for **tests** in emit-billing sprints 60–62:
a vitest `globalSetup` discovers the port and sets `DATABASE_URL` before any
test file imports the database client. That works because tests have a
bootstrap hook. **Local development has no equivalent.** Every repo in the
fleet hardcodes its port in:

- `.env` — **gitignored**, so it is the developer's live local config and no
  commit can fix it,
- `.env.example` — the file new developers copy,
- and frequently drizzle configs, `README.md` and `DEPLOY.md`
  (e.g. `garage-sailor/drizzle.config.pg.ts:10`,
  `garage-sailor/packages/db/README.md:27`).

The consequence, verified across all ten repos: **there is no repo where
flipping the compose port to ephemeral is a safe standalone change** — not
even the four whose tests never open a database connection (martialops,
garage-sailor-prime, garage-sailor, tastease). Doing it without an answer here
breaks `pnpm dev` for whoever holds that `.env`, and a half-converted repo is
strictly worse than an unconverted one.

Ten repos need one answer, not ten. Getting it wrong and propagating it via a
sweep would cost ten reworks.

## Context

- **Sprint 276 is a prerequisite** — it ships the `db-url` command this sprint
  decides how to *consume*. Sprint 275 supplies the fleet inventory.
- **Options to evaluate** (the sprint should choose one and record why, not
  keep all three):
  1. **`predev` script writes a gitignored fragment.** A `package.json`
     `predev`/`pretest` hook shells out to `emit-infra db-url` and writes
     `.env.local` (or exports inline). Zero developer action after the
     one-time conversion; costs a subprocess per invocation and needs each
     repo's env loader to read the fragment.
  2. **The app resolves at runtime in dev.** The config module itself calls
     the command when `NODE_ENV !== 'production'` and `DATABASE_URL` is
     unset. Fewest moving parts and no new file, but puts a Docker dependency
     inside app startup, which must be impossible to trigger in production.
  3. **Documented one-time manual edit.** Developer runs `emit-infra db-url`
     once and pastes it. Simplest to ship and the only option with no runtime
     cost — but it breaks again on every `docker compose down -v` that
     reassigns the port, which makes it likely wrong in practice.
- **An explicit `DATABASE_URL` in the environment must always win**, in every
  option. CI, deploy smoke tests and one-off scripts depend on overriding it,
  and emit-billing's e2e suite specifically requires that resolution never
  runs eagerly at module load — `E2E_NO_WEBSERVER=1` runs against a *remote*
  deployed host with no local Docker at all (emit-billing sprint 62).
- **The port is not stable across `docker compose down -v`.** Any option that
  caches or pastes the URL needs a documented refresh step, and option 3 is
  most exposed to this.
- emit-infra's fleet conventions live in `docs/` alongside
  `PRE-PUSH-HOOK.md`, `DEPLOYMENT-PITFALLS.md` and `DEPLOY-FLOOR.md`. That is
  where this belongs — it is a convention other repos must follow, not a
  README detail.
- The chosen mechanism must survive the loader constraints from sprint 276:
  any repo config file that participates has to reach the resolver by
  subprocess, not import.

## Tasks

1. Evaluate the three options above against: developer friction after
   conversion, behaviour when the container is down, behaviour when the port
   changes, whether it can leak a Docker dependency into production, and cost
   per invocation. Pick one. Record the rejected options and why — the next
   person will otherwise re-litigate this.
2. Implement the chosen mechanism end-to-end in **emit-billing** as the pilot,
   since it is already converted for tests and is the only repo where the
   dev path is the sole remaining gap. Confirm `pnpm dev` works from a clean
   `.env` with no hardcoded port.
3. Write `docs/EPHEMERAL-DEV-DB.md`: the goal and the problem (collisions,
   silent cross-project writes, the sprint-57 incident), the chosen dev-path
   mechanism, the test-path pattern from emit-billing 60–62, the subprocess
   constraint from 276, and a **per-repo conversion recipe** the rollout
   sprints follow step by step.
4. Include a copy-paste **developer migration note** in that doc — what a
   developer with an existing gitignored `.env` must do once, per repo. The
   rollout sprints paste this into each conversion commit message.
5. Add the convention to the `/init-project` template's story: confirm whether
   a newly scaffolded project gets the dev path automatically or needs a step,
   and state which in the doc. (The template already has the *test* path from
   emit-billing sprint 63.)

## Acceptance criteria

- [x] `docs/EPHEMERAL-DEV-DB.md` exists and states the decision, the two
      rejected options with reasons, the conversion recipe, and the developer
      migration note
- [x] emit-billing runs `pnpm dev` against its ephemeral database with no
      hardcoded port anywhere in its `.env` or `.env.example`
- [x] An explicit `DATABASE_URL` still overrides the mechanism — demonstrated,
      not asserted
- [x] The mechanism cannot reach for Docker in production — demonstrated by
      the guard that prevents it, and covered by a test naming that guard
- [x] Stopping the container produces an actionable error from `pnpm dev`,
      not an opaque connection refusal
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:hooks` green
      in emit-infra; emit-billing's own `pnpm check:all` green

## Out of scope

Converting any repo other than the emit-billing pilot — the fleet rollout is
sprints 278–281 and must not begin until this doc exists. Re-opening the
ephemeral-vs-port-registry decision: ephemeral is settled, and this sprint
only decides how developers consume it. Production database configuration.

## Completed

**Date:** 2026-08-15

### Summary

Chose runtime resolution: emit-billing's `loadEnv()` now resolves
`DATABASE_URL` at call time (via `emit-infra db-url`, shelled out to per
sprint 276's loader constraint) whenever it's unset and `NODE_ENV !==
'production'`. Rejected the `predev`-writes-a-fragment option (extra file,
extra loader wiring, no better than call-time resolution) and the
documented-manual-edit option (breaks silently on every `docker compose
down -v`, which is exactly the failure class ephemeral ports exist to kill).
Full record, including the guarantees section proving each acceptance
criterion live rather than just by test, is in
`docs/EPHEMERAL-DEV-DB.md`.

Implemented end-to-end in emit-billing as the pilot:
`packages/config/src/resolve-dev-database-url.ts` (new) holds
`maybeResolveDatabaseUrl` (explicit `DATABASE_URL` wins; production never
calls discovery) and `resolveDevDatabaseUrl` (the actual subprocess call,
with an actionable error — CLI missing vs. container not running are
distinguished — rather than a bare stack trace). `env.ts`'s `loadEnv()`
wires it in, passing `resolveDevDatabaseUrl` explicitly rather than relying
on its own default parameter, specifically so mocking it at the
`env.ts`-to-`resolve-dev-database-url.ts` import boundary reliably
intercepts it in tests (a same-module default-parameter self-reference is
not reliably mockable across files under Vitest's ESM handling — confirmed
by hitting it, not by assumption).

Two things surfaced only by actually wiring this into a real app, not
visible from the schema/CLI layer alone:

1. **`loadEnv()`'s resolved value isn't automatically in `process.env`.**
   `packages/db/src/client.ts` reads `process.env.DATABASE_URL` directly
   (as does the existing vitest `globalSetup`, by the same convention) —
   `apps/api/src/main.ts` and `apps/worker/src/main.ts` now write
   `process.env.DATABASE_URL = env.DATABASE_URL` right after `loadEnv()`,
   matching that existing convention rather than inventing a new one. This
   is very likely a gap in every one of the sprint 278–281 target repos too
   — the conversion recipe calls it out explicitly.
2. **The barrel import broke `apps/web`'s build.** `apps/web/src/
   middleware.ts` imported `resolveDashboardPassword` from the `@org/config`
   barrel, which now transitively pulls in `resolve-dev-database-url.ts`'s
   `node:child_process`/`node:fs` — `nx run web:build` failed resolving it
   inside the Edge/Node middleware bundle. Fixed the same way
   `@org/shared-types` already solves this class of problem in this repo:
   moved `resolveDashboardPassword` to its own file
   (`packages/config/src/dashboard-password.ts`) with a dedicated
   `@org/config/dashboard-password` package.json export subpath, and
   pointed `middleware.ts` at that instead of the barrel. `env.ts` still
   re-exports it for any other barrel consumer.

Verified live end-to-end, not just by test: `emit-infra db-url` against the
running container printed a correct URL; `loadEnv()` with no `DATABASE_URL`
resolved the same live port; an explicit `DATABASE_URL` override was
returned untouched even with the container reachable; production with
`DATABASE_URL` unset threw the normal zod error with no subprocess call;
stopping the container produced the actionable
`DATABASE_URL is unset and dev auto-discovery ... failed: ... Run
\`pnpm infra:up\`...` message, not `ECONNREFUSED`; restarting the container
(which reassigned its port, observed live) was picked up by the very next
`loadEnv()` call with no caching; `apps/api` and `apps/worker`'s dev targets
both booted clean from an environment with only `OPERATOR_TOKEN` set — no
`.env` file, no `DATABASE_URL` anywhere.

### Files changed

- (new) `docs/EPHEMERAL-DEV-DB.md` (emit-infra) — the decision record:
  problem, rejected options, per-repo conversion recipe, developer migration
  note, `/init-project` template story
- (emit-billing, separate repo, own commit) `packages/config/src/
  resolve-dev-database-url.ts` (new), `.test.ts` (new) — discovery +
  production guard
- (emit-billing) `packages/config/src/env.ts`, `env.test.ts` — wires
  discovery into `loadEnv()`
- (emit-billing) `packages/config/src/dashboard-password.ts` (new),
  `.test.ts` (new) — extracted from `env.ts` to unblock the web build
- (emit-billing) `packages/config/package.json` — added the
  `./dashboard-password` export subpath
- (emit-billing) `apps/web/src/middleware.ts` — dedicated subpath import
- (emit-billing) `apps/api/src/main.ts`, `apps/worker/src/main.ts` —
  `process.env.DATABASE_URL` write-back after `loadEnv()`
- (emit-billing) `.env.example` (new), `.gitignore` — documents required dev
  vars without a hardcoded `DATABASE_URL`; ignores `.env`/`.env.local`

### Verification

- emit-infra: `pnpm lint` clean (5 projects), `pnpm typecheck` clean (5
  projects), `pnpm test` 350/350 (42 test files), `pnpm test:hooks` 47+12+6
  passed, 0 failed
- emit-billing: `pnpm check:all` green (format, lint 16/16, typecheck 16/16,
  test 15/15, build 8/8 — including `web`, which failed before the barrel
  fix); `pnpm check:all:e2e` green (crosses the api/web boundary, per this
  repo's own CLAUDE.md convention)
- emit-billing `packages/config` tests: 26/26 (new dev-discovery +
  dashboard-password suites included)
- Live verification of every acceptance criterion, listed in the Summary
  above

### Follow-ups

- `[address-next]` Every sprint 278–281 target repo should be checked for
  the same "`loadEnv()`'s resolved `DATABASE_URL` isn't in `process.env`"
  gap this pilot found — grep each repo's DB client for a direct
  `process.env.DATABASE_URL` read before assuming a `loadEnv()`-equivalent
  wire-up alone is sufficient. The conversion recipe in
  `docs/EPHEMERAL-DEV-DB.md` calls this out; flag it again per-repo since
  it's easy to skip.
- `[defer]` `packages/core`'s `test` nx target still doesn't
  `dependsOn: ["^build"]` (sprint 275/276's open follow-up) — not hit again
  this sprint since `pnpm build` was run for `core`/`cli` before live
  verification, but still open.
- `[defer]` `resolveDevDatabaseUrl`'s `EMIT_INFRA_DIR` default
  (`$HOME/projects/emit-infra`) assumes the sibling-checkout convention this
  whole machine already uses (same assumption `scripts/lib/db-url.sh`
  makes) — fine for this fleet, would need to become configurable if
  emit-infra is ever checked out somewhere else on a dev machine.
- `[defer]` emit-billing's `.env.example` documents `OPERATOR_TOKEN` /
  `BILLING_OPERATOR_TOKEN` / `BILLING_API_URL` / `DASHBOARD_PASSWORD` but
  nothing in the toolchain actually loads `.env` automatically (no dotenv,
  no `--env-file`) — a developer has to source it into their shell
  themselves. Said so explicitly in the file's header comment rather than
  implying otherwise; wiring real autoloading is a separate DX
  improvement, not this sprint's decision.
