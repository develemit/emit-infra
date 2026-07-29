# Nitpick sweep: split audit.ts and add global unhandledRejection handler
**Difficulty:** 2

## Goal
`apps/cli/src/commands/audit.ts` (310 lines) drops under the 300-line house cap by extracting its check logic to a lib module, and the API server gains a global `unhandledRejection` handler so background task failures are never silently dropped.

## Reason
2026-07-11 audit: these are the last two flagged nitpicks — the only source file over the 300-line cap, and the only observability gap (background promises like fire-and-forget deploy tasks have per-call `.catch()` logging, but nothing catches a missed one process-wide). Closing both finishes the audit's below-A findings.

## Context
- `apps/cli/src/commands/audit.ts` (310 lines): read it first. Expect a series of check functions + report assembly around a commander action. Preferred split per house rules: pure check logic → `apps/cli/src/lib/audit-checks.ts` (exported, individually testable); the command file keeps flag parsing + orchestration + output. Follow the naming/layout conventions of existing `apps/cli/src/lib/` modules (check what's there first — if commands keep logic elsewhere, match it).
- Note: backlog has a sprint-214 defer about pre-existing lint errors in `audit.ts` — if the extraction naturally clears them, fine; don't chase lint fixes beyond the files you touch.
- Add at least a small test for the extracted checks (pure functions; `apps/cli` has a vitest suite since sprint 214).
- `apps/api/src/index.ts`: register once at startup:
  - `process.on('unhandledRejection', ...)` logging via the Fastify app logger (`app.log.error`) — not `console.*`
  - Log and continue (do not exit) — this is a long-running local daemon; a background SSH failure shouldn't kill the dashboard API
  - Keep it minimal: no retry logic, no error classification. If `index.ts` already registers other process handlers, place it alongside them.
- Verify with `pnpm nx typecheck api` / `pnpm nx test api` and `pnpm nx test cli` / `pnpm nx typecheck cli` / lint on both.

## Tasks
1. Read `audit.ts`; classify each function as pure check vs command orchestration.
2. Extract checks to `apps/cli/src/lib/audit-checks.ts`; command file imports and orchestrates. No behavior change to the audit command's output.
3. Add `audit-checks.test.ts` covering 2-3 representative checks.
4. Add the `unhandledRejection` handler to `apps/api/src/index.ts` using the app logger.
5. Confirm `audit.ts` and the new lib file are each ≤ 300 lines.
6. Run test/typecheck/lint for both `cli` and `api`.

## Files involved
- `apps/cli/src/commands/audit.ts` — slims to orchestration
- new file: `apps/cli/src/lib/audit-checks.ts` + `audit-checks.test.ts`
- `apps/api/src/index.ts` — adds process-level rejection handler

## Acceptance criteria
- [x] No source file in the repo exceeds 300 lines (audit.ts was the last)
- [x] `emit-infra audit` output unchanged for the same inputs
- [x] Unhandled rejections are logged through the app logger; process stays up
- [x] Tests pass, typecheck clean, lint clean in cli and api

## Out of scope
- Sweeping the backlog's pre-existing lint errors in other files (separate backlog item)
- Adding new audit checks or changing check thresholds
- `uncaughtException` handling / process-exit policy changes

## Completed

**Date:** 2026-07-11

### Summary
Extracted all pure check logic from `audit.ts` (310 → 90 lines) into `apps/cli/src/lib/audit-checks.ts` (227 lines). The command file now imports and orchestrates the checks, maintaining 100% behavioral compatibility with the existing audit output. Added `audit-checks.test.ts` covering Dockerfile validation, size parsing, and dockerignore checks. Added global `unhandledRejection` handler to `apps/api/src/index.ts` that logs through the Fastify app logger and continues running (process doesn't exit on background promise failures).

### Files changed
- `apps/cli/src/commands/audit.ts` — reduced to command orchestration (90 lines)
- (new) `apps/cli/src/lib/audit-checks.ts` — all pure check functions (227 lines)
- (new) `apps/cli/src/lib/audit-checks.test.ts` — 9 tests for checks
- `apps/api/src/index.ts` — added process.on('unhandledRejection') handler

### Verification
- `pnpm nx test cli`: 63/63 pass (9 test files including new audit-checks.test.ts)
- `pnpm nx test api`: 293/293 pass (37 test files)
- `pnpm nx typecheck cli`: clean
- `pnpm nx typecheck api`: clean
- Sprint-touched files pass lint (audit.ts, audit-checks.ts, index.ts all clean)
- audit.ts: 90 lines, audit-checks.ts: 227 lines (both ≤ 300)

### Follow-ups
- `[defer]` Pre-existing lint errors in init-deploy.ts/init-deploy.test.ts and vitest.config.ts remain (noted in backlog); not in sprint scope
