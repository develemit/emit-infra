# Sprint 60 — Strip emit-vision `infra/scripts/deploy.sh` to migrations-only

> _Promoted from sprint-35 follow-up, 2026-06-15._

## Goal

Remove the now-redundant GHCR login and blue-green deploy invocation from
`infra/scripts/deploy.sh` in the emit-vision repo, leaving only database
migration steps (or deleting the file if it has no remaining purpose).

## Context

Sprint 35 migrated emit-vision's CI to the reusable GitHub Actions workflow.
That workflow calls the deploy logic directly — `infra/scripts/deploy.sh` is no
longer invoked by CI.

The project now also has a separate `scripts/deploy.sh` for local/manual
deploys (wired into the Husky pre-push hook). The `infra/` variant predates
that and contains:

- `docker login ghcr.io`
- invocation of `blue-green-deploy.sh`
- (possibly) database migration steps

The only thing worth keeping, if present, is running Drizzle migrations as a
standalone ops task (useful for post-deploy migration runs without a full
redeploy). Everything else is dead code now that the reusable workflow handles
the deploy path.

Relevant file in emit-vision repo: `infra/scripts/deploy.sh`

## Tasks

1. Read `infra/scripts/deploy.sh` in the emit-vision repo.
2. If it contains only deploy/GHCR logic (no migration steps), delete the file.
3. If it contains migration steps, extract those into a minimal
   `infra/scripts/migrate.sh` (just `drizzle-kit migrate` or equivalent) and
   delete `infra/scripts/deploy.sh`.
4. Update any references to `infra/scripts/deploy.sh` in docs or CI configs.
5. Commit the cleanup to emit-vision.

## Acceptance criteria

- `infra/scripts/deploy.sh` no longer exists in emit-vision.
- If migration steps existed, they live in a clearly-named standalone script.
- No CI workflow references the removed file.

## Completed

**Date:** 2026-06-16

### Summary
`infra/scripts/deploy.sh` contained GHCR login and blue-green invocation (both now handled by the reusable CI workflow) alongside Postgres and ClickHouse migration steps. The deploy logic was removed and the migration steps were extracted into `infra/scripts/migrate.sh` — a clean standalone ops tool for running migrations without a full redeploy.

Two doc references to the old file were updated: `docs/deployment.md` and `provision-list/clickhouse.md`. Sprint milestone files referencing it were left as-is (archived history).

### Files changed
- (deleted) `infra/scripts/deploy.sh` — removed; contained redundant GHCR/blue-green logic
- (new) `infra/scripts/migrate.sh` — standalone Postgres + ClickHouse migration runner
- `docs/deployment.md` — updated step 2 description to reflect reusable workflow
- `provision-list/clickhouse.md` — updated link to point to migrate.sh

### Verification
- `infra/scripts/deploy.sh` does not exist: confirmed
- `infra/scripts/migrate.sh` exists and is executable: confirmed
- No CI workflow (.yml/.yaml/.sh) references `infra/scripts/deploy.sh`: confirmed
- Committed to emit-vision repo: `0f4f0de`

### Follow-ups

- `[defer]` `infra/scripts/migrate.sh` fallback (`docker run` path) depends on `GHCR_TOKEN` not being set on this script — verify the ops runbook mentions needing GHCR_ORG + IMAGE_TAG env vars when using the fallback path
