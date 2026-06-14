# Sprint 51 — Last-Deployed Timestamp in HealthCard
**Difficulty:** 3

## Goal
Show "deployed Xh ago" in the project HealthCard by writing a `.deployed-at` epoch timestamp during Ansible deploy and reading it back in the status poll.

## Reason
The HealthCard shows the current build number but gives no sense of *when* it was deployed. "Build #142, deployed 6 hours ago" is much more useful than "Build #142" — especially when diagnosing whether a recent change is responsible for a problem.

## Context
**Ansible side:** `ansible/roles/app-deploy/tasks/deploy-standard.yml` runs the deploy sequence. Sprint 44 already added timestamped rollback tags here. Add a task at the end of the deploy sequence (after `docker compose up`) that writes the epoch:
```yaml
- name: Record deploy timestamp
  shell: "date +%s > /opt/{{ project_name }}/.deployed-at"
```
Do the same in `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` (after the cutover step).

**Status API:** `apps/api/src/routes/projects.ts` builds a multi-line SSH command (lines 122–130). The existing command ends with the queue line. Append one more line:
```sh
cat /opt/${req.params.name}/.deployed-at 2>/dev/null || echo ""
```
Then destructure the new line from the split result and add `deployedAt: deployedAtLine || null` to `StatusData`.

**Dashboard types:** Add `deployedAt?: string | null` to `ProjectStatus` in `apps/dashboard/src/lib/api.ts`.

**HealthCard:** Add a `StatTile` for "Deployed" next to the Build # tile. Format the epoch string into a human-readable age:
```ts
function deployedAgo(epoch: string | null | undefined): string {
  if (!epoch) return '—'
  const secs = Math.floor(Date.now() / 1000) - parseInt(epoch, 10)
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`
  return `${Math.floor(secs / 86400)}d ago`
}
```

## Tasks
1. Read `ansible/roles/app-deploy/tasks/deploy-standard.yml` — identify where docker compose up completes and add the `date +%s` write task after it.
2. Read `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — add the same task after the compose cutover.
3. Read `apps/api/src/routes/projects.ts` lines 120–165 — extend the SSH command and destructuring.
4. Add `deployedAt` to `StatusData` type and parse it from the raw SSH output.
5. Add `deployedAt?: string | null` to `ProjectStatus` in `apps/dashboard/src/lib/api.ts`.
6. Read `apps/dashboard/src/components/detail/health-card.tsx` — add `deployedAgo` helper and a new `StatTile` for it, placed next to the Build # tile. Include it on both desktop (4-col grid) and mobile (2-col grid).
7. Run `pnpm nx run cli:typecheck` and `pnpm nx run dashboard:typecheck`.

## Files involved
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — add deploy timestamp write task
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — same
- `apps/api/src/routes/projects.ts` — extend SSH command + StatusData type
- `apps/dashboard/src/lib/api.ts` — add `deployedAt` to ProjectStatus
- `apps/dashboard/src/components/detail/health-card.tsx` — add "Deployed" StatTile

## Acceptance criteria
- [x] After a deploy, `/opt/<project>/.deployed-at` contains an epoch timestamp
- [x] Status API returns `deployedAt` in the response
- [x] HealthCard shows "deployed Xh ago" (or "just now" / "Xm ago" / "Xd ago") next to Build #
- [x] Projects without a `.deployed-at` file show "—" (no crash)
- [x] Both deploy-standard and deploy-zero-downtime tasks write the timestamp
- [x] TypeCheck clean for both CLI and dashboard packages

## Completed

**Date:** 2026-06-13

### Summary
Added a `date +%s > /opt/{{ project_name }}/.deployed-at` task at the end of both `deploy-standard.yml` and `deploy-zero-downtime.yml` (runs after successful health check). Extended the status SSH command to also `cat .deployed-at` and destructured `deployedAtLine` from the result — added `deployedAt: string | null` to `StatusData` and `ProjectStatus`. Added a `deployedAgo(epoch)` helper to `health-card.tsx` and a "Deployed" StatTile next to Build # in both the desktop 4-col grid and the mobile 2-col grid. Missing file returns "—" with no crash.

### Files changed
- `ansible/roles/app-deploy/tasks/deploy-standard.yml` — added "Record deploy timestamp" task at end
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — same
- `apps/api/src/routes/projects.ts` — appended `.deployed-at` cat to SSH command, added `deployedAt` to StatusData
- `apps/dashboard/src/lib/api.ts` — added `deployedAt?: string | null` to ProjectStatus
- `apps/dashboard/src/components/detail/health-card.tsx` — added `deployedAgo` helper + "Deployed" StatTile in desktop and mobile grids

### Verification
- `pnpm nx run dashboard:typecheck`: clean
- `pnpm nx run cli:typecheck`: clean

### Follow-ups
none

## Out of scope
- Persisting deploy history (more than one timestamp — that's a separate initiative)
- Showing deployed-at on the home-page project cards (add if it looks good after this sprint)
