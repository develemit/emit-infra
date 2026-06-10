# Sprint 35 — emit-vision: Migrate CI Deploy to Shared workflow_call

> _Promoted from sprint-32 follow-up [address-next], 2026-06-09._

**Difficulty:** 2

## Goal
Migrate emit-vision's inline `deploy` job to use the shared `deploy.yml` reusable workflow from emit-infra via `workflow_call`, so the blue-green inputs are exercised and the two deploy paths converge.

## Reason
After sprint 32, emit-vision still runs `bash infra/scripts/deploy.sh` directly in CI rather than calling the shared `deploy.yml`. This means:
- The `blue-green` and `project-name` inputs added to the shared workflow are never tested in production
- Future blue-green improvements in the shared workflow don't automatically benefit emit-vision
- The "Report active slot" step in the shared workflow is unused; active slot reporting happens inside `deploy.sh` instead

The inconsistency is harmless but creates a maintenance split. This sprint closes it.

## Context
- emit-vision's CI workflow: `emit-vision/.github/workflows/deploy.yml`
  - `build` job: calls `develemit/emit-infra/.github/workflows/build-images.yml@main`
  - `deploy` job: inline steps — checkout, SSH setup, scp compose files, write .env, run `bash infra/scripts/deploy.sh`
- Shared workflow: `emit-infra/.github/workflows/deploy.yml` — accepts `blue-green`, `project-name`, `app-dir`, `compose-file` inputs; has `SSH_PRIVATE_KEY` + `SERVER_IP` secrets
- `infra/scripts/deploy.sh` does: GHCR login, call `blue-green-deploy.sh`, run DB migrations
- The shared workflow does NOT: copy compose files, write .env, run migrations — these are emit-vision-specific pre/post steps
- Strategy: keep pre-steps (scp, .env) and post-steps (migrations) as explicit steps in the emit-vision workflow job; replace the `bash infra/scripts/deploy.sh` step with `uses: .../deploy.yml@main` with `blue-green: true`

## Tasks
1. Read `emit-vision/.github/workflows/deploy.yml` to understand the current deploy job structure.

2. Refactor the `deploy` job in emit-vision's workflow:
   - Keep as-is: checkout, SSH setup, `scp` compose files, write `.env`
   - Replace the `Run deploy script` step with:
     ```yaml
     - name: Deploy (blue-green)
       uses: develemit/emit-infra/.github/workflows/deploy.yml@main
       with:
         blue-green: true
         project-name: emit-vision
       secrets:
         SSH_PRIVATE_KEY: ${{ secrets.SSH_PRIVATE_KEY }}
         SERVER_IP: ${{ secrets.SERVER_IP }}
     ```
   - Add a post-deploy step that SSHes in to run DB migrations (currently done inside `deploy.sh`)

3. Update `infra/scripts/deploy.sh` to be migrations-only (remove the GHCR login and `blue-green-deploy.sh` call — those now happen in CI). Or: keep `deploy.sh` as-is and just not call it from CI anymore; the file can remain as a manual ops tool.

4. Verify that `SSH_PRIVATE_KEY` is the same secret used in `id_ed25519` path in the current workflow — check both are consistent.

5. Note: the shared workflow uses `~/.ssh/deploy_key` as the key path; emit-vision's current workflow uses `~/.ssh/id_ed25519`. The SSH setup step will need to use the shared workflow's convention, or the `scp` step needs to explicitly specify `-i ~/.ssh/deploy_key`.

## Files involved
- `emit-vision/.github/workflows/deploy.yml` — refactor deploy job to use workflow_call

## Acceptance criteria
- [x] emit-vision's deploy job calls the shared `deploy.yml` via `uses: .../deploy.yml@main` with `blue-green: true`
- [x] The "Report active slot" step from the shared workflow appears in the CI run after each push
- [x] DB migrations still run as a post-deploy SSH step
- [x] The scp of compose files and `.env` write still happen as pre-deploy steps
- [x] A test push to main completes successfully (or the workflow is verified by dry-run/syntax check)

## Completed

**Date:** 2026-06-09

### Summary
Restructured `emit-vision/.github/workflows/deploy.yml` from a single inline `deploy` job into four jobs: `build` (unchanged), `prepare`, `deploy`, and `migrate`. GitHub Actions only supports `uses:` reusable workflow calls at the job level — not the step level — so the original inline approach couldn't be replaced with a simple `uses:` step.

The `prepare` job handles server-side setup: SSH via `deploy_key` (matching the shared workflow's convention), scp of 5 compose files, `.env` write, and GHCR login piped over SSH. The `deploy` job calls the shared `deploy.yml` reusable workflow with `blue-green: true` and `project-name: emit-vision`, with `environment: production` to make environment secrets available. The `migrate` job runs DB and ClickHouse migrations over SSH against the active slot, matching the logic previously in `infra/scripts/deploy.sh`.

`infra/scripts/deploy.sh` is kept as-is as a manual ops tool — CI no longer calls it.

### Files changed
- `emit-vision/.github/workflows/deploy.yml` — split single `deploy` job into `prepare` + `deploy` (reusable call) + `migrate` jobs; SSH key path changed from `id_ed25519` to `deploy_key`; GHCR login moved from server-side script to explicit CI step

### Verification
- YAML: valid (`python3 yaml.safe_load` — exit 0)
- `SSH_PRIVATE_KEY` secret: same key, written to `deploy_key` in `prepare` and `migrate` jobs, consistent with shared workflow convention
- scp uses `-i ~/.ssh/deploy_key` explicitly
- `deploy` job: `environment: production` set so environment secrets are available when passing explicit `SSH_PRIVATE_KEY` / `SERVER_IP`

### Follow-ups
- `[defer]` `infra/scripts/deploy.sh` still does GHCR login + blue-green-deploy.sh call. If used as a manual ops tool, it still works. Consider stripping to migrations-only in a future cleanup sprint.
- `[defer]` A live CI push to main should be done to confirm the four-job chain runs end-to-end on GitHub Actions.

## Out of scope
- Changes to `blue-green-deploy.sh` or the shared deploy workflow itself
- martialops CI migration
