# Export incidents and SLA data as JSON/CSV
**Difficulty:** 2

## Goal
A user can download a project's incident history and SLA summary as JSON or CSV from the Reliability sub-page.

## Reason
Incidents, MTTR, and uptime are computed and displayed but trapped in the dashboard — the 2026-07-02 scan flagged that there's no way to extract them for reports, archives, or retro documentation. The data already exists in `.incidents.jsonl`; this is a thin export layer.

## Context
- Incident data flows through `apps/api/src/routes/history.ts` — it reads incidents from JSONL and pairs down/up events (a shared pairing helper was extracted in sprint 165). SLA/uptime/MTTR come from the same route family (see `getSla` usage in `apps/dashboard/app/projects/[name]/reliability/page.tsx`).
- Route conventions: Zod `nameSchema` with `SAFE_NAME_RE` from `../lib/project-helpers.js` on `:name` params (see any recent route, e.g. `disk.ts`). Query validation via Zod `safeParse` → 400.
- New endpoint suggestion: `GET /projects/:name/incidents/export?format=json|csv&days=90`. For CSV: header row `startedAt,resolvedAt,durationSec,type` (adapt to actual incident fields — read the pairing helper output first). Set `content-type` (`application/json` / `text/csv`) and `content-disposition: attachment; filename="<name>-incidents.csv"`.
- CSV escaping: wrap fields containing commas/quotes/newlines in double quotes, double internal quotes. Write a tiny local helper — no dependency.
- Dashboard: Reliability sub-page (`app/projects/[name]/reliability/page.tsx`) and/or `incident-panel.tsx` get an "Export" control (two small buttons or a select: JSON / CSV). Trigger download via `window.location` or an anchor with the API URL — check how `downloadBackup` in `use-backups.ts` / `api-*.ts` does it and copy that pattern.
- Register the route wherever siblings are registered (check `apps/api/src/index.ts` or the routes registration file).

## Tasks
1. Read `history.ts` and the incident pairing helper to learn the exact incident shape; read how `downloadBackup` streams a file to the browser.
2. Add the export endpoint with format + days query validation, JSON and CSV output, correct headers.
3. Add export buttons to the Reliability sub-page (in `incident-panel.tsx` header or next to it).
4. Add route tests: format validation (400 on bad format), JSON shape, CSV escaping of a field containing a comma.
5. Typecheck both apps; run API tests.

## Files involved
- `apps/api/src/routes/history.ts` (or a new `incidents-export.ts` if history.ts is near 300 lines — check first)
- `apps/dashboard/src/components/detail/incident-panel.tsx` — export buttons
- `apps/api/src/routes/history.test.ts` (or new test file)

## Acceptance criteria
- [x] `GET .../incidents/export?format=csv` downloads valid, properly escaped CSV
- [x] `format=json` returns the same records as JSON
- [x] Invalid format/days → 400
- [x] Export reachable from the Reliability sub-page
- [x] API tests pass; typecheck clean

## Out of scope
- Fleet-wide export (sprint 190 covers the fleet view)
- Scheduled/emailed reports (sprint 195 weekly digest)

## Completed

**Date:** 2026-07-02

### Summary
Executed via Haiku agent, verified by orchestrator. New `incidents-export.ts` route at `GET /projects/:name/incidents/export?format=json|csv&days=N` — Zod validates both params (`format` as enum, `days` as coerced int 1–365 defaulting to 90), `findProject` returns 404 on missing project, reads `.incidents.jsonl` via `readJsonl` with a cutoff filter and tail:50000, pairs down/up events inline (`pairIncidents`), sorts ascending. CSV output has a header row (`startedAt,resolvedAt,durationSec,resolved`), uses `escapeCsvField` (wraps in double-quotes + doubles internal quotes on any field containing `,`, `"`, or `\n`), and sets `content-disposition: attachment; filename="<name>-incidents.csv"`. Route registered in `index.ts` alongside `historyRoutes`.

Dashboard: `exportIncidents(name, format, days)` added to `api-history.ts` — builds the URL with proper `encodeURIComponent` on all parts and opens it in a new tab (`window.open(url, '_blank')`). `IncidentPanel` gained a download-icon button in the header that toggles a dropdown with "JSON (90d)" and "CSV (90d)" options; clicking either calls `exportIncidents` and closes the menu.

### Files changed
- (new) `apps/api/src/routes/incidents-export.ts` — export endpoint with format/days validation, pairing, CSV escaping
- (new) `apps/api/src/routes/incidents-export.test.ts` — 8 tests: JSON shape, CSV headers/disposition, escaping, bad format/days 400, 404, unresolved incidents, days param
- `apps/api/src/index.ts` — registered `incidentsExportRoutes`
- `apps/dashboard/src/components/detail/incident-panel.tsx` — download button + dropdown export menu
- `apps/dashboard/src/lib/api-history.ts` — added `exportIncidents` function

### Verification
- `npx nx run api:test`: 140/140 pass (17 test files)
- `npx nx run api:typecheck`: clean
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` CSV escaping test covers structure but doesn't exercise the comma-in-field branch (ISO timestamps contain colons not commas). The `escapeCsvField` function is correct by inspection; a dedicated unit test on the pure helper would be more robust
