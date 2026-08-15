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

- [ ] `docs/EPHEMERAL-DEV-DB.md` exists and states the decision, the two
      rejected options with reasons, the conversion recipe, and the developer
      migration note
- [ ] emit-billing runs `pnpm dev` against its ephemeral database with no
      hardcoded port anywhere in its `.env` or `.env.example`
- [ ] An explicit `DATABASE_URL` still overrides the mechanism — demonstrated,
      not asserted
- [ ] The mechanism cannot reach for Docker in production — demonstrated by
      the guard that prevents it, and covered by a test naming that guard
- [ ] Stopping the container produces an actionable error from `pnpm dev`,
      not an opaque connection refusal
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm test:hooks` green
      in emit-infra; emit-billing's own `pnpm check:all` green

## Out of scope

Converting any repo other than the emit-billing pilot — the fleet rollout is
sprints 278–281 and must not begin until this doc exists. Re-opening the
ephemeral-vs-port-registry decision: ephemeral is settled, and this sprint
only decides how developers consume it. Production database configuration.
