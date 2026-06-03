# Sprint 15 — Dead code cleanup

> _Promoted from sprint-10 follow-ups, sprint-11 follow-up, 2026-06-03._

## Goal
Remove dead files and dependencies accumulated during sprints 08–11, and fix the ops cancel flow to only remove the most recent confirmation card.

## Context
- Builds on sprints 08, 10, 11.
- `apps/dashboard/src/components/ops-panel.tsx` — the original sprint 05 ops panel scaffold. It was superseded when sprint 10 rewrote the ops page as a composed set of components. It imports `SseOutputPanel` (removed in sprint 08) which will cause a missing-module error if the file is ever compiled.
- `apps/dashboard/src/components/sse-output-panel.tsx` — the original sprint 04 SSE panel. Sprint 08 replaced it with `DeployPanel` and `Terminal`. Check if anything still imports it.
- `apps/dashboard/app/ops/page.tsx` — the `handleCancel` function does `prev.filter(m => m.type !== 'confirm')` which removes ALL confirm-type messages. For single-tool-per-turn this is fine, but it's cleaner to remove only the last confirm.
- `apps/dashboard/package.json` — `png-to-ico@3.0.1` was added in sprint 11 as a planned dependency but the icon script used a hand-written ICO encoder instead. It's unused.

## Tasks

1. **Delete `src/components/ops-panel.tsx`**:
   - Grep for any imports of `ops-panel` across the dashboard. If found, update the importer (should be none since `app/ops/page.tsx` was rewritten in sprint 10). Then delete the file.

2. **Check `src/components/sse-output-panel.tsx`**:
   - Grep for any remaining imports of `sse-output-panel`. If there are none, delete it.
   - If something still imports it, note it as a follow-up instead of fixing.

3. **Fix cancel flow in `app/ops/page.tsx`**:
   - Change `setMessages(prev => prev.filter(m => m.type !== 'confirm'))` to remove only the last confirm:
     ```ts
     setMessages(prev => {
       const idx = [...prev].reverse().findIndex(m => m.type === 'confirm')
       if (idx === -1) return prev
       const realIdx = prev.length - 1 - idx
       return prev.filter((_, i) => i !== realIdx)
     })
     ```

4. **Remove `png-to-ico` from `apps/dashboard/package.json`** devDependencies:
   - Edit the file to remove the `png-to-ico` entry.
   - Run `pnpm install` to update the lockfile.

## Files involved
- `apps/dashboard/src/components/ops-panel.tsx` — delete
- `apps/dashboard/src/components/sse-output-panel.tsx` — delete if unreferenced
- `apps/dashboard/app/ops/page.tsx` — fix cancel flow
- `apps/dashboard/package.json` — remove png-to-ico

## Completed

**Date:** 2026-06-03

### Summary
Deleted `ops-panel.tsx` (sprint 05 scaffold superseded by sprint 10) and `sse-output-panel.tsx` (sprint 04 SSE panel replaced by sprint 08's DeployPanel/Terminal). Neither was imported anywhere outside their own files. Fixed `handleCancel` in the ops page to remove only the last confirm-type message instead of all of them. Removed `png-to-ico` from dashboard devDependencies and ran `pnpm install` to clean the lockfile.

### Files changed
- `apps/dashboard/src/components/ops-panel.tsx` — deleted
- `apps/dashboard/src/components/sse-output-panel.tsx` — deleted
- `apps/dashboard/app/ops/page.tsx` — handleCancel now removes only the last confirm message
- `apps/dashboard/package.json` — removed png-to-ico devDependency
- `pnpm-lock.yaml` — updated by pnpm install

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- Code inspection: no remaining imports of ops-panel or sse-output-panel

### Follow-ups
none

## Acceptance criteria
- [x] `src/components/ops-panel.tsx` no longer exists
- [x] No TypeScript errors caused by removed files
- [x] Cancel in the ops chat removes only the most recent confirm card
- [x] `apps/dashboard/package.json` does not list `png-to-ico`
- [x] `pnpm typecheck` and `pnpm lint` pass
