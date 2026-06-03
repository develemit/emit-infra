# Sprint 16 — Ops multi-tool handling

> _Promoted from sprint-05 follow-up, 2026-06-03._

## Goal
Fix Claude ops so it correctly handles a Claude turn that calls multiple tools — specifically: run all non-destructive tools in order before pausing on a destructive one.

## Context
- Builds on sprint 05.
- `apps/api/src/routes/ops.ts` — the tool-use loop (`for (const block of first.content)`) breaks on the first destructive tool. This means if Claude returns `[get_status, deploy]` in a single turn, `get_status` result is never sent back to Claude and the user gets an empty reply with a confirmation card. The correct behavior: run `get_status`, then pause on `deploy`.
- The loop also has an implicit single-tool-per-turn assumption: `toolResultContent` is only sent in the follow-up call if `pendingConfirmation` is undefined. If a destructive tool appears after some non-destructive tools, the results of the non-destructive tools are discarded.
- The fix: collect all non-destructive tool results up until the first destructive tool, then send those results as a follow-up to Claude to get an intermediate reply, then return the confirmation. If no destructive tool, continue as-is.

## Tasks

1. **Audit and fix the tool-use loop in `apps/api/src/routes/ops.ts`**:
   - Iterate all `tool_use` blocks in `first.content`.
   - For each block: if it's a destructive tool, save it as `pendingConfirmation` and stop iterating (break).
   - For non-destructive tools: execute them, accumulate results in `toolResultContent` and `toolResults`.
   - After the loop:
     - If there are non-destructive results AND a pending confirmation: send the tool results to Claude as a follow-up to get an intermediate summary, then return `{ reply: summaryText, toolResults, pendingConfirmation }`.
     - If there are only non-destructive results (no destructive): get the final Claude reply as before.
     - If there is only a pending confirmation with no non-destructive results: return `{ reply: '', toolResults: [], pendingConfirmation }` as before.

2. **Update the `ChatResponse` type** in `apps/dashboard/src/components/ops/types.ts` if the response shape changes.

## Files involved
- `apps/api/src/routes/ops.ts` — fix tool-use loop

## Completed

**Date:** 2026-06-03

### Summary
Fixed the tool-use loop in `ops.ts` to correctly handle a Claude turn that mixes non-destructive and destructive tools. When non-destructive results are collected before hitting a destructive tool, the results are now sent as a follow-up to Claude to get an intermediate summary, and the response returns `{ reply: summaryText, toolResults, pendingConfirmation }`. The all-destructive-only and all-non-destructive paths are unchanged. `ChatResponse` type already covered this shape — no changes needed to the dashboard types.

### Files changed
- `apps/api/src/routes/ops.ts` — when `pendingConfirmation` is set and `toolResultContent` is non-empty, make an intermediate Claude call and return the summary alongside the pending confirmation

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- Code inspection: three distinct paths — (1) destructive only → `{ reply: '', toolResults: [], pendingConfirmation }`, (2) mixed → intermediate Claude call then `{ reply: summaryText, toolResults, pendingConfirmation }`, (3) non-destructive only → existing follow-up path unchanged

### Follow-ups
none

## Acceptance criteria
- [x] A Claude turn that returns `[get_status, get_containers]` (two non-destructive tools) returns both tool results in one response
- [x] A Claude turn that returns `[get_status, deploy]` runs `get_status`, returns its result, and returns a `pendingConfirmation` for `deploy`
- [x] A Claude turn that returns `[deploy]` alone still returns just the confirmation card (no tool results)
- [x] `pnpm typecheck` and `pnpm lint` pass
