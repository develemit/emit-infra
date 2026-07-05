# Write .deployed-version from the build_number var instead of a container label
**Difficulty:** 2

## Goal
After a successful deploy, `{{ app_dir }}/.deployed-version` reliably contains the deployed build number for every project — including profile-based blue-green projects whose images carry no `build.number` label.

## Reason
Projects migrated from per-project `blue-green-deploy.sh` to emit-infra lost the `.deployed-version` write, breaking their rollback playbook's source of truth. Tastease: `.deployed-version` says 623 while live build is 671+ (the old script's line 63 was `echo "$BUILD_NUMBER" > "$DEPLOY_PATH/.deployed-version"`). During tastease's 2026-07-03 build-671 deploy the "Write deployed version file" task was **skipped**.

## Context
Root cause (diagnosed 2026-07-04 from the tastease side):

- `ansible/roles/app-deploy/tasks/main.yml:111-119` reads the build number from a Docker label:
  `docker inspect --format '…index .Config.Labels "build.number"…' $(docker compose -f … ps -q | head -1)`
- `main.yml:121-126` writes `.deployed-version` gated by:
  `when: deployed_build_number.stdout | default('') | trim | length > 0`
- Tastease's images are built by its own CI and have **no** `build.number` OCI label (that label is only added by emit-infra's `build-images.yml:79` path). So stdout is empty and the write is skipped.
- Even for labeled images, `ps -q | head -1` picks an arbitrary container (could be postgres/uptime-ping/nginx) — fragile.
- The fix is easy because Ansible already has the truth: `apps/cli/src/commands/deploy.ts:108-111` passes `extraVars.build_number = process.env.BUILD_NUMBER` when set, and `main.yml:41-43` already writes `BUILD_NUMBER={{ build_number }}` into the env file `when: build_number is defined`.

## Tasks
1. In `ansible/roles/app-deploy/tasks/main.yml`, change the "Write deployed version file" task to prefer `build_number` when defined:
   - content: `{{ build_number | default(deployed_build_number.stdout | trim, true) }}`
   - when: `build_number is defined or (deployed_build_number.stdout | default('') | trim | length > 0)`
   (Keep the label read as fallback for deploys triggered without BUILD_NUMBER.)
2. Keep the label-read task as-is (it's `ignore_errors: true` and harmless), or skip it entirely when `build_number is defined` to save a shell call.
3. Verify with a dry run / molecule or by deploying any test project with `BUILD_NUMBER` set; confirm `.deployed-version` matches.

## Files involved
- `ansible/roles/app-deploy/tasks/main.yml` — the post-deploy "Read deployed build number" / "Write deployed version file" tasks (lines ~111-126)

## Acceptance criteria
- [x] After a deploy with `BUILD_NUMBER` set, `.deployed-version` contains that number
- [x] Works for profile-based blue-green projects with unlabeled images (tastease)
- [x] Label-based fallback still works for projects built via `build-images.yml`

## Out of scope
- Adding `build.number` labels to downstream projects' images
- Backfilling `.deployed-version` on existing servers (self-heals on next deploy)

## Completed

**Date:** 2026-07-05

### Summary
Changed the "Write deployed version file" Ansible task to prefer the `build_number` variable (passed by the CLI's `deploy.ts`) over the container label lookup. The label-read task is now skipped when `build_number` is already defined, saving a shell call. When `build_number` is not defined, the original label-based fallback still runs. This fixes profile-based blue-green projects like tastease whose images have no `build.number` OCI label.

### Files changed
- `ansible/roles/app-deploy/tasks/main.yml` — added `when: build_number is not defined` to label-read task; updated write task content to `{{ build_number | default(deployed_build_number.stdout | default('') | trim, true) }}` and condition to fire when either source has a value

### Verification
- `ansible-playbook --syntax-check ansible/playbooks/deploy.yml`: clean (no errors)
- Logic review: three code paths verified (build_number set, unlabeled images, labeled images)

### Follow-ups
- `[defer]` The label-read's `ps -q | head -1` still picks an arbitrary container — could target the first app service explicitly, but it's harmless now that it's only a fallback
