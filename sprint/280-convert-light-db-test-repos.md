# Sprint 280 — Convert the three lightest database-backed repos

## Goal

`emit-vision`, `emit-social` and `immigration-app` run on the ephemeral
pattern, including a test bootstrap that discovers the port and refuses to
run against the wrong database. These are the first repos where the full
sprint-60 shape is needed, and they are chosen to be the cheapest instances of
it.

## Why these three together

They are the three repos with the fewest database-touching test files —
`emit-vision` 1, `emit-social` 2, `immigration-app` 3 — so each needs the test
bootstrap but none needs much of it. Grouping them keeps one sprint's worth of
work while still adding the piece sprints 278–279 deliberately avoided.

The heavy repos (`math-problemizer` 5, `diner-decider` 7, `develemail` 8) are
sprint 281. That split is a direct response to emit-billing sprint 64, which
was planned as one ten-repo sweep and delivered zero conversions because the
per-repo cost was roughly a full sprint. Sizing by actual test-file count is
the correction.

## Context

- **Sprints 275–279 are prerequisites.** The recipe in
  `docs/EPHEMERAL-DEV-DB.md`, corrected by the 278 pilot and the 279 sweep, is
  the spec. The `db-url` resolver (276) is how config files reach the port.
- **Repo state as audited 2026-08-14** (emit-billing sprint 64) — re-verify:

  | repo | port | user / pass | database | DB-touching test files |
  |---|---|---|---|---|
  | emit-vision | 55432 | `emit` / `emit` | emit_vision | 1 |
  | emit-social | 5435 | `emit-social` | emit-social | 2 |
  | immigration-app | 5434 | `immigration_pro360` | immigration_pro360 | 3 |

  `emit-social` shares port 5435 with `diner-decider` — one of the two live
  collisions. Converting it here retires half of that collision; the other
  half lands in 281.
- **The test-bootstrap shape to replicate** is emit-billing's
  `packages/db/src/test-db.ts`: discover the port, wait for readiness, assert
  `select current_database()` matches, apply migrations, then hand
  `DATABASE_URL` to the suite via the runner's global-setup hook. Its
  `applyMigrations` step is what removes the "did I remember to migrate"
  footgun on a fresh volume.
- **Do not assume drizzle + vitest.** The reference implementation is
  drizzle-specific; these repos may use different ORMs or runners. Preserve
  the *shape* — ephemeral port, discovery, identity assertion, migrations —
  not the literal file. Confirm each repo's stack before porting.
- **`emit-vision` is the largest and most production-critical of the three**
  (ClickHouse and Redis alongside Postgres, a live deployed service). Its
  single DB-touching test file makes it cheap here, but treat its compose file
  with care: convert the Postgres service only and leave the other services'
  port mappings alone unless a collision demands otherwise.
- Honour each repo's own `CLAUDE.md` and verification command.
- emit-infra fleet convention: **one commit per repo touched.**

## Tasks

1. Per repo, in the order `emit-vision` → `emit-social` → `immigration-app`:
   baseline its own verification command first and record it. Red for
   unrelated reasons means report and skip.
2. Check each tree for unrelated uncommitted work; report and skip if dirty.
3. Confirm the repo's ORM and test runner before porting the bootstrap, and
   note in the completion summary where its shape diverges from the drizzle +
   vitest reference.
4. Apply the recipe: ephemeral loopback port, test bootstrap with discovery +
   readiness wait + identity assertion + migrations, dev path per sprint 277,
   hardcoded URLs removed from configs and docs, `.env.example` updated.
5. Classify hardcoded URLs live-connection vs inert-fixture before editing, as
   in sprint 279 — fixtures keep a literal on a non-routable host.
6. Verify per repo that the suite passes with **no** `DATABASE_URL` override,
   and separately that pointing it at a wrong database aborts before any test
   or seed writes.
7. **Stop-and-report guard:** if any repo materially exceeds the recipe,
   finish or cleanly back out that repo and report. Do not carry a
   half-converted repo forward, and do not start the next repo to make up time.

## Acceptance criteria

- [ ] `emit-vision`, `emit-social` and `immigration-app` each publish an
      ephemeral loopback Postgres port, or are reported skipped with a reason
- [ ] Each converted repo passes its **own** verification command with no
      `DATABASE_URL` override — recorded per repo with its pre-change baseline
- [ ] Each converted repo aborts loudly when pointed at a database whose
      identity doesn't match — name the test or check per repo that
      demonstrates it
- [ ] A fresh volume (`down -v` then `up`) followed by that repo's test
      command passes with no manual migrate step, per repo
- [ ] Where a repo's stack diverges from drizzle + vitest, the divergence and
      the chosen equivalent are recorded
- [ ] `emit-vision`'s non-Postgres services (ClickHouse, Redis) are unchanged
- [ ] Exactly one commit per converted repo, each carrying the developer
      migration note
- [ ] Sprint 275's doctor no longer reports `emit-social` in a collision
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:hooks` green in
      emit-infra

## Out of scope

`math-problemizer`, `diner-decider` and `develemail` — sprint 281. Production
or deploy database configuration in any repo. Non-Postgres services, except
where one is genuinely blocking a Postgres conversion. Upgrading Postgres
versions, changing credentials, migrating data, or fixing unrelated red
suites — report those instead.
