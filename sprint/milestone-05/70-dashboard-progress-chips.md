# Dashboard: surface CI and deploy progress % in status chips
**Difficulty:** 3

## Goal

Update the emit-infra dashboard to read `progress.pct` and `progress.label` from `.ci-status.json` and `.deploy-status.json`, and display them inline on the project card and/or detail page so "running" becomes "running · 60%" and "deploying" becomes "deploying · 3/10".

## Reason

Sprints 65–69 wired all four projects to write `progress` into their status JSON files. Without this sprint the richer data sits in the files but the dashboard still shows a flat "deploying" chip — the payoff sprint that makes progress tracking visible in the UI.

## Context

**Depends on:** Sprints 65–69 (projects must be writing `progress` fields before this matters at runtime; but the UI change can ship independently since `progress` is optional and the component degrades gracefully).

**How status files reach the dashboard:**

The emit-infra API reads `.ci-status.json` and `.deploy-status.json` from each project's local directory and exposes them through an endpoint. The dashboard fetches this and renders it. Before making changes, search the codebase to find the exact chain:

```bash
# In apps/dashboard and apps/api:
grep -r "ci-status\|ciStatus\|ci_status\|deploy-status\|deployStatus\|deploy_status" --include="*.ts" --include="*.tsx" -l
```

Likely locations:
- `apps/api/src/` — a route that reads and returns the status files
- `apps/dashboard/src/lib/api.ts` — the `ProjectStatus` type and `getStatus()` call that the dashboard fetches
- `apps/dashboard/src/components/project-card.tsx` — renders the deploy-ago chip (currently shows deployed timestamp)
- `apps/dashboard/app/projects/[name]/page.tsx` — detail page that polls `getStatus()` every 30s

**`progress` JSON shape** (written by ci-utils.sh):
```json
{
  "status": "running",
  "sha": "abc1234",
  "branch": "main",
  "startedAt": "2026-06-15T12:00:00Z",
  "progress": { "step": 3, "total": 8, "pct": 37, "label": "Building api image" }
}
```
`progress` is only present when status is `running` or `deploying`. It is absent from `success`, `failure`, `deployed`, `failed` writes.

**Display target:**

In-flight chips should show: `running · 37%` or `deploying · 37%`

Optionally (if the step label fits cleanly): a subtitle or tooltip with the label text (`"Building api image"`).

Prefer `pct` as the primary value (user confirmed %). The `label` is optional secondary context.

## Tasks

1. **Discover the data path**: grep the codebase (both `apps/api` and `apps/dashboard`) for where `ci-status.json` / `deploy-status.json` are read. Trace the data from file → API route → TypeScript type → React component.

2. **Extend the API type**: wherever `ciStatus` / `deployStatus` is typed, add the optional `progress` field:
   ```ts
   progress?: {
     step: number
     total: number
     pct: number
     label: string
   } | null
   ```

3. **Update the API route** (if the route reads the file and returns a typed object): ensure `progress` is included in the returned JSON rather than being stripped.

4. **Update the dashboard component** that renders the running/deploying chip: when `progress?.pct != null`, append ` · ${progress.pct}%` to the status label.

5. **Optional step label**: if there's a natural place (tooltip, subtitle below the chip, or a secondary line in the card), show `progress.label`. Don't force it if the layout doesn't have a clean home for it.

6. Run `pnpm exec tsc --noEmit` in `apps/dashboard` (and `apps/api` if that app has a typecheck command) to verify clean.

## Files involved

- Discover via grep — likely `apps/api/src/routes/...` (status route), `apps/dashboard/src/lib/api.ts` (type + fetch), and whichever component renders the running/deploying chip.

## Acceptance criteria

- [x] `progress?: { step, total, pct, label }` is typed in the relevant API interface.
- [x] The API route includes `progress` in its response when the status file contains it.
- [x] The dashboard chip for `running` status shows `running · N%` when `progress.pct` is present.
- [x] The dashboard chip for `deploying` status shows `deploying · N%` when `progress.pct` is present.
- [x] When `progress` is absent (e.g. `success`, `failure`, `deployed` states), the chip renders exactly as before — no regression.
- [x] TypeScript compiles clean across the monorepo.

## Completed

**Date:** 2026-06-15

### Summary
Added two new lightweight Fastify routes (`GET /projects/:name/ci-status` and `GET /projects/:name/deploy-status`) that read local `.ci-status.json` / `.deploy-status.json` files with no caching. These routes return the full JSON including the `progress` field when present. Added `CiProgress`, `CiStatus`, `DeployStatus` types and `getCiStatus`/`getDeployStatus` fetch functions to `api.ts`. In `project-card.tsx`, a new `usePipelineStatus` hook polls both endpoints every 15s. When CI is running with a progress object, a `running · N%` chip appears in the card's chip row; similarly for deploy. Both chips are absent when `progress` is null (completed/failed states render unchanged — no regression).

The API layer was not previously reading CI/deploy status files at all — this sprint builds the entire data path from local file → API route → TypeScript type → React component.

### Files changed
- `apps/api/src/routes/projects.ts` — 2 new routes: `/ci-status` and `/deploy-status`
- `apps/dashboard/src/lib/api.ts` — `CiProgress`, `CiStatus`, `DeployStatus` types; `getCiStatus`, `getDeployStatus` functions
- `apps/dashboard/src/components/project-card.tsx` — `usePipelineStatus` hook; `running · N%` and `deploying · N%` chips

### Verification
- `tsc --noEmit` apps/dashboard: clean ✓
- `tsc --noEmit` apps/api: clean ✓
- `progress?: { step, total, pct, label }` typed in `CiStatus`/`DeployStatus` ✓
- API routes return raw JSON.parse output (progress field passes through) ✓
- Chips render on `running` / `deploying` status when progress present ✓
- Chips absent when `success` / `failure` / `deployed` (null ciProgress/deployProgress) ✓
- Committed as `9bb1efb`

### Follow-ups

- [defer] Detail page (`/projects/[name]/page.tsx`) could also show progress chips in the header badge — the data path now exists, just wire it in
- [defer] Consider faster polling interval (e.g. 5s) when CI/deploy is actively in-flight, vs 15s when idle

## Out of scope

- Animated progress bars (the % chip is sufficient).
- Historical progress data — only current in-flight state matters.
- Updating `ci-mode.sh` CLI to show progress (separate backlog item).
