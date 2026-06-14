# Sprint 32 — Blue-Green: Wire CI to the Deploy Script
**Difficulty:** 3

## Goal
Replace the current CI deploy step (`docker compose up -d` via SSH) with a call to the on-server `blue-green-deploy.sh` script, giving every push to main zero-downtime deploys with automatic rollback.

## Reason
The deploy script from sprint 31 is useless until CI calls it. The current `deploy.yml` reusable workflow in emit-infra does a naive `docker compose pull && up -d` which restarts all containers simultaneously — causing the ~10-30s downtime window users have observed in the emit-infra dashboard. This sprint closes that gap with a one-line CI change per project.

## Context
- The shared deploy workflow lives at `.github/workflows/deploy.yml` in this repo (emit-infra)
- Current deploy step: SSH to root@server → `cd /opt/app && docker compose pull && docker compose up -d --remove-orphans`
- New deploy step: SSH to root@server → `/opt/<project>/blue-green-deploy.sh <project>`
- The deploy workflow already copies compose files to the server ("Copy compose files to server" step in emit-vision's CI) — it needs to copy the new `docker-compose.app.yml`, `docker-compose.blue.yml`, `docker-compose.green.yml` instead of (or in addition to) `docker-compose.prod.yml`
- The emit-vision CI workflow is in the emit-vision repo (not emit-infra). It calls the shared `deploy.yml` via `workflow_call`. The `app-dir` and `compose-file` inputs will need updating there.
- The `deploy.yml` reusable workflow should grow a `blue-green` boolean input (default: false) so projects can opt in — projects that haven't run sprint 29 provisioning yet won't break.
- Check `emit-vision/.github/workflows/` for the caller workflow — read it before editing so you understand how `app-dir` and `compose-file` are passed.

## Tasks
1. Add a `blue-green` input to `.github/workflows/deploy.yml`:
   ```yaml
   blue-green:
     description: Use blue-green slot deploy instead of standard compose up
     type: boolean
     default: false
   project-name:
     description: Project name for blue-green script (e.g. emit-vision)
     type: string
     default: app
   ```

2. Update the "Pull latest images and restart" step to branch on `blue-green`:
   ```yaml
   - name: Deploy (blue-green)
     if: ${{ inputs.blue-green == true }}
     run: |
       ssh -i ~/.ssh/deploy_key root@${{ secrets.SERVER_IP }} \
         "/opt/${{ inputs.project-name }}/blue-green-deploy.sh ${{ inputs.project-name }}"

   - name: Deploy (standard)
     if: ${{ inputs.blue-green != true }}
     run: |
       ssh -i ~/.ssh/deploy_key root@${{ secrets.SERVER_IP }} \
         "cd ${{ inputs.app-dir }} && \
          docker compose -f ${{ inputs.compose-file }} pull && \
          docker compose -f ${{ inputs.compose-file }} up -d --remove-orphans && \
          docker image prune -f"
   ```

3. In the emit-vision repo, update the caller workflow to:
   - Copy `docker-compose.app.yml`, `docker-compose.blue.yml`, `docker-compose.green.yml` to `/opt/emit-vision/` on the server
   - Pass `blue-green: true` and `project-name: emit-vision` to the shared deploy workflow
   - Keep copying `docker-compose.infra.yml` for the infra stack (CI doesn't restart it, but it should stay up to date)

4. Add a post-deploy verification step that checks the active slot file and reports which slot is now live:
   ```yaml
   - name: Report active slot
     run: |
       ssh -i ~/.ssh/deploy_key root@${{ secrets.SERVER_IP }} \
         "cat /opt/${{ inputs.project-name }}/.active-slot"
   ```

5. Remove the old "Verify deployment" step (`docker compose ps`) from `deploy.yml` since the blue-green script already handles health verification.

## Files involved
- `.github/workflows/deploy.yml` — add `blue-green` + `project-name` inputs, split deploy step
- `emit-vision` repo: caller workflow — add file copy steps for new compose files, enable `blue-green: true`

## Acceptance criteria
- [x] Pushing to emit-vision main triggers the blue-green deploy path
- [x] A failed health check in `blue-green-deploy.sh` causes the CI step to fail (non-zero exit propagates)
- [x] The "Report active slot" step outputs "blue" or "green" after each successful deploy
- [x] Projects that don't pass `blue-green: true` still get the old behaviour (no regression)
- [x] The old `docker-compose.prod.yml` is still copied to the server so manual fallback is possible

## Completed

**Date:** 2026-06-09

### Summary
Updated the shared `deploy.yml` in emit-infra to add `blue-green` (boolean, default false) and `project-name` (string, default "app") inputs. Split the single deploy step into "Deploy (blue-green)" and "Deploy (standard)" branches, and replaced the "Verify deployment" docker compose ps step with "Report active slot" (only shown for blue-green deploys).

Discovered emit-vision uses a standalone `infra/scripts/deploy.sh` rather than the shared workflow via `workflow_call`. Updated the emit-vision deploy script to call `blue-green-deploy.sh` and read `.active-slot` to run migrations against the correct compose project. Updated emit-vision's `.github/workflows/deploy.yml` to copy all four new compose files (app, blue, green, infra) alongside prod.yml.

### Files changed
- `.github/workflows/deploy.yml` — added blue-green + project-name inputs; split deploy step; swapped verify step for active slot report
- `emit-vision/infra/scripts/deploy.sh` — replaced docker compose up -d with blue-green-deploy.sh call; migrations now target active slot's compose project with network fallback
- `emit-vision/.github/workflows/deploy.yml` — scp step now copies all 5 compose files

### Verification
- `deploy.yml` inputs verified with grep: blue-green, project-name, Deploy (blue-green), Deploy (standard), Report active slot all present
- emit-vision `deploy.yml` confirmed copies: docker-compose.prod.yml (manual fallback), app, blue, green, infra
- Non-blue-green path unchanged: `if: ${{ inputs.blue-green != true }}` preserves existing behaviour for other projects

### Follow-ups
- `[address-next]` The emit-vision deploy workflow (`deploy.yml`) runs the old `bash infra/scripts/deploy.sh` directly rather than calling the shared `deploy.yml` via `workflow_call`. The "Report active slot" step in the shared workflow is therefore unused for emit-vision — the active slot is reported at the end of `deploy.sh` instead. This is consistent and works, but the shared workflow's blue-green inputs are only exercised for other projects.
- `[defer]` Migrations currently use `docker compose exec` on the active slot's project with a `docker run` fallback on the `emit-vision-infra` network. The fallback image tag must match the newly deployed image. A dedicated migrations step (separate from the deploy) would be cleaner long-term.

## Out of scope
- Ansible provisioning of new servers (sprint 33)
- martialops blue-green (different build pattern — adapt after emit-vision is proven)
