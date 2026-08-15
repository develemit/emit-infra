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

- [ ] `garage-sailor`'s `docker-compose.yml` names no fixed host port and
      binds loopback only
- [ ] `pnpm dev` works in `garage-sailor` from a `.env` with no hardcoded
      port, and its own verification command passes with no `DATABASE_URL`
      override — both recorded, with the pre-change baseline for comparison
- [ ] `grep -rn "localhost:5436"` in `garage-sailor` returns nothing outside
      `.env` (gitignored) and any deliberate historical note
- [ ] `pnpm db:migrate` (or this repo's equivalent) runs with no hardcoded
      port and no manual `DATABASE_URL`
- [ ] Pointing the repo at a wrong database fails loudly — name the check or
      test that demonstrates it, or record explicitly that nothing in this
      repo connects during tests and where the assertion will attach
- [ ] Exactly one commit in `garage-sailor`, carrying the developer migration
      note
- [ ] `docs/EPHEMERAL-DEV-DB.md` updated with whatever the recipe got wrong,
      or an explicit statement that it transferred unchanged
- [ ] Sprint 275's doctor reports `garage-sailor` as `ephemeral`

## Out of scope

Every other repo — 279 onward. Do not opportunistically convert a second repo
"while in there": the point of a pilot is to learn the recipe's gaps at the
cost of one repo. Changing `garage-sailor`'s stack, Postgres version,
credentials, or migrating data. Production database configuration.
