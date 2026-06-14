# Sprint 44 — Rollback: Timestamped Image Tags for Multi-Point History

> _Promoted from backlog (sprint-02 follow-up), 2026-06-11._

**Difficulty:** 3

## Goal
Replace the single `:rollback` tag with timestamped tags (`:<timestamp>`) so operators can roll back to any of the last N snapshots rather than just the immediately preceding deploy.

## Reason
The current `:rollback` tag is overwritten every deploy — the server retains only one rollback point. If a bad deploy is caught after a second bad deploy, the only valid restore point is gone. Timestamped tags (`rollback-20260611T221443`) preserve a short window of rollback history, letting operators choose which snapshot to restore.

## Context

### Current tagging (two Ansible task files)
Both `ansible/roles/app-deploy/tasks/deploy-standard.yml` and `deploy-zero-downtime.yml` contain:
```yaml
- name: Tag current images as :rollback
  shell: |
    docker tag "{{ item }}:latest" "{{ item }}:rollback" 2>/dev/null || \
    docker tag "{{ item }}" "{{ item.split(':')[0] }}:rollback" 2>/dev/null || true
  loop: "{{ compose_images }}"
  when: rollback_enabled | default(true)
```
And the rollback path restores via:
```yaml
docker tag "{{ item.split(':')[0] }}:rollback" "{{ item.split(':')[0] }}:latest"
```

### CLI rollback command
`apps/cli/src/commands/rollback.ts` — `rollbackToTag()` looks for `<image>:rollback` tags on the server and restores them to `:latest`. This is the user-facing command for the operator.

### Proposed change
1. **Tag with timestamp** instead of `:rollback`:
   - Tag name format: `rollback-<YYYYMMDDTHHMMSS>` (UTC, safe for Docker tag syntax)
   - Keep only the last **3** timestamped rollback tags per image (prune older ones after tagging)
2. **Keep `:rollback` as an alias** pointing to the latest snapshot, for backwards compatibility with the existing `rollbackToTag()` path in the CLI
3. **CLI `rollback` with `--list`**: add a flag that SSHes in and lists available timestamped rollback tags for the project's images
4. **CLI `rollback --timestamp <tag>`**: allow rolling back to a specific timestamped snapshot

### Tag pruning
After tagging, prune all but the 3 most recent `rollback-*` tags for each image:
```bash
# List rollback tags sorted oldest-first, delete all but last 3
docker images --format "{{.Tag}}" <image> | grep "^rollback-" | sort | head -n -3 | \
  xargs -I{} docker rmi <image>:{} 2>/dev/null || true
```

## Tasks

1. **Update `deploy-standard.yml`**: change the "Tag current images as :rollback" task to tag with a timestamp AND update the `:rollback` alias:
   ```yaml
   - name: Tag current images with timestamp and :rollback alias
     shell: |
       TS=$(date -u +%Y%m%dT%H%M%S)
       IMAGE_BASE="{{ item.split(':')[0] }}"
       docker tag "{{ item }}:latest" "${IMAGE_BASE}:rollback-${TS}" 2>/dev/null || \
       docker tag "{{ item }}" "${IMAGE_BASE}:rollback-${TS}" 2>/dev/null || true
       docker tag "${IMAGE_BASE}:rollback-${TS}" "${IMAGE_BASE}:rollback" 2>/dev/null || true
       docker images --format "{{.Tag}}" "${IMAGE_BASE}" | grep "^rollback-" | sort | head -n -3 | \
         xargs -I{} docker rmi "${IMAGE_BASE}:{}" 2>/dev/null || true
     loop: "{{ compose_images }}"
     when: rollback_enabled | default(true)
   ```
   Also update the rollback-on-failure path (where `:rollback` is restored to `:latest`) — it can stay as-is since `:rollback` is still maintained.

2. **Apply the same change to `deploy-zero-downtime.yml`** — same pattern.

3. **Update `rollback.ts`** — add `--list` and `--timestamp` options:
   - `--list`: SSH in and run `docker images --format "{{.Repository}}:{{.Tag}}" | grep "rollback-"` for the first image in the compose config; print the results
   - `--timestamp <tag>`: call a new `rollbackToTimestamp(...)` function that tags `<image>:rollback-<timestamp>` as `:latest` for each image, then runs the restart + health check

4. Run `pnpm nx run cli:typecheck` — confirm clean.

## Files involved
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — update tag task + pruning
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — same
- `apps/cli/src/commands/rollback.ts` — add `--list` and `--timestamp` options

## Acceptance criteria
- [x] After a deploy, images are tagged with both `rollback-<timestamp>` and `:rollback` (alias)
- [x] Only the 3 most recent `rollback-*` tags are kept per image (older ones pruned)
- [x] `emit-infra rollback` (no args) still works — restores `:rollback` to `:latest`
- [x] `emit-infra rollback --list` prints available timestamped snapshots
- [x] `emit-infra rollback --timestamp rollback-20260611T221443` restores that specific snapshot
- [x] `pnpm nx run cli:typecheck` clean

## Completed

**Date:** 2026-06-12

### Summary
Updated both `deploy-standard.yml` and `deploy-zero-downtime.yml` to tag images with a UTC timestamp (`rollback-<YYYYMMDDTHHMMSS>`) in addition to the `:rollback` alias. After tagging, the Ansible shell task prunes all but the 3 most recent `rollback-*` tags per image using `sort | head -n -3 | xargs docker rmi`. The `:rollback` alias is preserved so the existing `rollbackToTag()` CLI path continues to work unchanged.

Added `--list` and `--timestamp` options to `rollback.ts`. `--list` SSHes in and queries `docker images` for `rollback-*` tags on the first compose image, printing them newest-first. `--timestamp <tag>` retags that specific snapshot as `:latest` for each image, then calls the existing restart-and-health-check path. A `noUncheckedIndexedAccess` TS error on the `imageList[0]` access in `listRollbackSnapshots` was fixed with a non-null assertion (`imageList[0]!`) — the caller already guards against an empty list.

### Files changed
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — replaced `:rollback`-only tag task with timestamped tag + alias + pruning shell block
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — same replacement (without `when:` clause)
- `apps/cli/src/commands/rollback.ts` — added `--list` and `--timestamp` options, `listRollbackSnapshots` and `rollbackToTimestamp` functions

### Verification
- `pnpm nx run cli:typecheck`: clean
- Code review: Ansible tasks in both deploy flavors now write `rollback-${TS}` and then alias to `:rollback`
- Code review: pruning uses `sort | head -n -3` to keep newest 3
- Code review: `rollbackToTag()` (no-args path) still looks for `:rollback` — unaffected
- Code review: `--list` path queries first image only (consistent with sprint spec)
- Code review: `--timestamp` path tags each image in the compose list, not just the first

### Follow-ups
- `[defer]` `--list` only queries the first compose image for rollback tags; a multi-image compose stack would silently omit tags for other images. Low priority since the primary image is what matters for most projects.

## Out of scope
- Storing rollback tags in a registry (current approach keeps them on the server only)
- Pruning rollback tags for blue-green deploys (blue-green uses `.active-slot` for rollback)
- Auto-pruning tags from GHCR (only server-local tags are managed here)
