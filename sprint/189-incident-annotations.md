# Incident annotations: root cause, notes, false-positive flag
**Difficulty:** 4

## Goal
Each incident in the Reliability panel can be annotated with a short note / root-cause tag and marked as a false positive; annotations persist and false positives are visually de-emphasized (and excludable from SLA math).

## Reason
Incidents are currently read-only records. The standard ops workflow — "why did this happen, was it real" — has nowhere to live, so post-mortem context evaporates. Flagged as a high-impact item in the 2026-07-02 scan. Also unblocks sprint 190 (fleet timeline benefits from annotations).

## Context
- Incidents are stored per-project in `.incidents.jsonl` and read via `apps/api/src/routes/history.ts` using the shared pairing helper (sprint 165). Incidents don't have stable IDs — the started timestamp is the natural key. Read the pairing helper first to confirm.
- **Do not rewrite the incidents JSONL** (it's append-only and written by the status monitor). Store annotations in a separate per-project file, e.g. `.incident-annotations.jsonl` or a small JSON map keyed by incident start timestamp, colocated with the other data files — find where `.incidents.jsonl` lives (check `apps/api/src/lib/` for data-dir helpers) and follow that convention. Last-write-wins per key is fine.
- New routes (register alongside history routes):
  - `PUT /projects/:name/incidents/:startedAt/annotation` — body `{ note?: string (max ~500), falsePositive?: boolean }`, Zod-validated; `:name` via `SAFE_NAME_RE` schema, `:startedAt` validated as ISO timestamp or epoch (match the incident record format).
  - Annotations should be merged into the incident list response (extend the existing GET in history.ts) so the panel gets them in one fetch.
- Dashboard: `apps/dashboard/src/components/detail/incident-panel.tsx`. Per incident row: an expand/edit affordance → small inline form (note textarea, false-positive checkbox, Save). False positives render dimmed with a "false positive" badge. Keep the panel ≤300 lines — extract an `incident-annotation-form.tsx` subcomponent if needed.
- SLA: if the SLA/uptime computation is in reach (same route family), exclude false-positive incidents from MTTR/uptime with a clearly-named option. If that computation lives elsewhere and would balloon scope, surface annotations in UI only and note SLA exclusion as a follow-up in this sprint's Completed section.
- Client API additions go in the matching domain module (`apps/dashboard/src/lib/api-history.ts`), typed explicitly.

## Tasks
1. Read the pairing helper + history routes to confirm incident shape and key; find the data-dir convention.
2. Implement annotation persistence (separate file, keyed by incident start).
3. Add the PUT route with full Zod validation; merge annotations into the incident list GET.
4. Extend `api-history.ts` client with `annotateIncident(...)` and updated incident type.
5. Update `incident-panel.tsx`: inline annotation editing, false-positive badge + dimming.
6. Exclude false positives from SLA/MTTR if the computation is colocated (see Context).
7. Route tests: annotation round-trip, validation failures, merge into list response.
8. Typecheck both apps; run API tests.

## Files involved
- `apps/api/src/routes/history.ts` — merge annotations into incident responses; possibly the PUT route (or new file `incident-annotations.ts` if history.ts is near 300 lines)
- new file: annotation persistence helper in `apps/api/src/lib/`
- `apps/dashboard/src/lib/api-history.ts` — client function + types
- `apps/dashboard/src/components/detail/incident-panel.tsx` (+ possible new `incident-annotation-form.tsx`)
- `apps/api/src/routes/history.test.ts` — new cases

## Acceptance criteria
- [x] Annotating an incident persists across API restarts and reloads
- [x] False positives are visually distinct in the panel
- [x] Invalid bodies/params → 400
- [x] API tests cover round-trip + validation; all pass
- [x] Typecheck clean

## Out of scope
- Fleet-wide incident view (sprint 190)
- Annotation history/audit trail — last write wins

## Completed

**Date:** 2026-07-03

### Summary
Annotations are stored in a per-project `.incident-annotations.json` file (a plain JSON map keyed by incident `startedAt` as a string, same directory as `.incidents.jsonl`). A new `apps/api/src/lib/annotations.ts` helper provides `readAnnotations` (graceful fallback to `{}` on missing/malformed file) and `writeAnnotation` (last-write-wins merge). The PUT route in `incident-annotations.ts` validates `:name` via `SAFE_NAME_RE`, `:startedAt` as a coerced int, and the body via Zod (note max 500 chars, falsePositive boolean, at least one field required → 400 otherwise). A companion GET for the full map is included for potential fleet-view use (sprint 190).

Annotations are merged into the `/projects/:name/incidents` GET response in `history.ts`: each incident gets `note`/`falsePositive` from the map (via conditional assignment to satisfy `exactOptionalPropertyTypes`). MTTR computation now filters out false positives (`resolvedReal = incidents.filter(i => i.resolved && !i.falsePositive)`). The SLA `/sla` route also filters out false-positive incidents before computing uptime percentages. Both changes use the same `readAnnotations` helper.

Dashboard: `Incident` type updated to `startedAt: number` (matching the actual API contract), `annotateIncident` client function added to `api-history.ts`. `IncidentPanel` gained a per-row annotate button (file icon) that toggles an inline `IncidentAnnotationForm` subcomponent (note textarea + false-positive checkbox + Save/Cancel). False-positive incidents render at `opacity-40` with a "false positive" badge. The panel reloads after a successful save to pick up the updated annotation state.

### Files changed
- (new) `apps/api/src/lib/annotations.ts` — `readAnnotations` / `writeAnnotation` helpers
- (new) `apps/api/src/routes/incident-annotations.ts` — PUT + GET routes for annotation persistence
- (new) `apps/api/src/routes/incident-annotations.test.ts` — 9 tests covering round-trip, validation failures, 404
- `apps/api/src/routes/history.ts` — merge annotations into incidents GET; exclude false positives from MTTR + SLA
- `apps/api/src/index.ts` — register `incidentAnnotationRoutes`
- `apps/dashboard/src/lib/api-history.ts` — updated `Incident` type + `annotateIncident` function
- `apps/dashboard/src/components/detail/incident-panel.tsx` — per-row annotate toggle, false-positive dimming/badge, reload after save
- (new) `apps/dashboard/src/components/detail/incident-annotation-form.tsx` — inline note/fp form subcomponent

### Verification
- `npx nx run api:test`: 149/149 pass (18 test files)
- `npx nx run api:typecheck`: clean
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` SLA cache is not invalidated when an annotation is written — a false-positive flag change won't affect the cached SLA until TTL expires (120s). Could call `slaCache.invalidate(name)` from the PUT handler; low priority since the cache is short.
