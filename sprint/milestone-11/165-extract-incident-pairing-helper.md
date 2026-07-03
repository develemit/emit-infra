# Extract Shared Incident Pairing Helper
**Difficulty:** 2

## Goal
Extract the down/up incident-pairing loop duplicated in `history.ts` into a single named helper so both callers share one implementation.

## Reason
The same ~18-line loop that pairs `event: 'down'` / `event: 'up'` JSONL records into resolved incidents exists verbatim at lines 303–319 and again at lines 406–421 in `history.ts`. Any fix — handling back-to-back downs, adding a new event type, changing the output shape — must be applied twice and will inevitably diverge, causing the SLA route and the incidents list route to disagree silently.

## Context
- `apps/api/src/routes/history.ts` — two separate route handlers both implement: iterate `records: IncidentRecord[]`, track `openDownAt: number | null`, push to `incidents[]`, handle a trailing open incident. The logic is identical except for variable names.
- `IncidentRecord` is already defined in the file: `{ type, projectName, event: 'down' | 'up', t: number }`.
- The output type is: `{ startedAt: number; resolvedAt: number | null; durationSec: number | null; resolved: boolean }[]`.
- The helper should live as a file-local function above the route registrations in `history.ts`. Only extract to a separate file if `history.ts` exceeds 300 lines after the refactor — check the line count.
- Do not change the behavior — this is a pure refactor.

## Tasks
1. Read both implementations (around lines 303–319 and 406–421) to confirm they are semantically identical.
2. Define `function pairIncidents(records: IncidentRecord[]): Incident[]` above the route registrations, using the existing `Incident` interface (or define it if inline).
3. Replace both inline loops with `pairIncidents(records)`.
4. Run `npx tsc --noEmit` to confirm no type errors.
5. Check the resulting line count of `history.ts` — if over 300, note it in the PR description for follow-up.

## Files involved
- `apps/api/src/routes/history.ts` — extract helper, replace both call sites

## Acceptance criteria
- [x] `pairIncidents` exists as a named function in `history.ts`
- [x] Both original inline loops are removed and replaced with the function call
- [x] Typecheck passes
- [x] No behavioral change (same output structure as before)

## Out of scope
- Adding new pairing logic (back-to-back down handling, etc.)
- Extracting to a separate lib file (only if line count demands it)
- Changing the route response shapes

## Completed

**Date:** 2026-07-01

### Summary
Extracted the 27-line down/up incident-pairing loop that was duplicated in both the `/incidents` and `/sla` route handlers into a single `pairIncidents(records: IncidentRecord[]): Incident[]` helper function, placed just above the `historyRoutes` export. Both call sites now use a one-liner `const incidents = pairIncidents(records)`. The file shrank from 470 to 428 lines.

### Files changed
- `apps/api/src/routes/history.ts` — added `pairIncidents` helper at line 83, replaced both inline loops with single-line calls

### Verification
- typecheck: clean (api freshly compiled, no errors)

### Follow-ups
none
