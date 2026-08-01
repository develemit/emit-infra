# Surface deploy phase timings in the dashboard
**Difficulty:** 2

## Goal
Show the per-phase breakdown (`ci`, `auth`, `build`, `retag`, `preDeploy`,
`deploy`) for each deploy in the dashboard's deploy history, so slow deploys
are diagnosable at a glance instead of by reading `.deploy-history.jsonl` by
hand.

## Reason
Sprint 252 shipped phase timing into `.deploy-history.jsonl` and sprints
253–254 use it to attack the deploy floor — but nothing renders it. The 1500s
retag-only outlier in develemail's history would be invisible in the dashboard
today: just a big total with no indication whether build, push, or server-side
deploy ate the time. Once phases are visible next to each deploy, regressions
like that get spotted when they happen, not sprints later.

## Context
- Data shape (written by `deploy_done` in `scripts/lib/ci-utils.sh`):
  `"phases": {"ci": 88, "auth": 2, "build": 297, "retag": 4, "deploy": 40}` —
  keys are optional (a retag-only deploy has no `build`; a no-retag deploy has
  no `retag`), and **entries written before 2026-08 have no `phases` at all**.
  Old entries must render exactly as they do today.
- Types already updated in sprint 252: `phases?: Record<string, number>` on
  `DeployHistoryEntry` in both `apps/api/src/routes/history.ts` and
  `apps/dashboard/src/lib/api-history.ts`. The API route reads the jsonl and
  returns entries as-is — verify `phases` actually passes through (it should,
  but the route may pick fields explicitly).
- Find the rendering site: `grep -rn "servicesBuilt\|DeployHistoryEntry"
  apps/dashboard/src` — the component that lists deploys with duration +
  services built is where phases belong.
- Presentation: a single horizontal stacked bar per deploy (one segment per
  phase, width ∝ seconds) with a text fallback/tooltip like
  `ci 88s · build 297s · deploy 40s`. Consult the `dataviz` skill before
  writing chart markup — it's the repo standard for any visualization work.
  Keep it small; this is a row detail, not a chart page.
- Dashboard conventions: components live near their route/feature, hooks in
  `apps/dashboard/src/lib/use-*.ts`, pure helpers in `apps/dashboard/src/lib/`
  with colocated `*.test.ts` (see `fleet-timeline-helpers.test.ts` for the
  testing pattern).
- Global file-size rule: target ≤300 lines per file — if the host component is
  already near the limit, extract the phase bar as its own component rather
  than growing it.

## Tasks
1. Verify end-to-end plumbing: hit the deploy-history API for develemail
   (which now has real `phases` entries) and confirm `phases` arrives in the
   response; fix the route's field-picking if it doesn't.
2. Write a pure helper (e.g. `apps/dashboard/src/lib/deploy-phases.ts`):
   ordering, labeling, and percentage math from a `phases` object —
   handles missing keys, zero-second phases, and absent `phases`.
3. Build the phase-bar subcomponent per the dataviz skill's guidance; wire it
   into the deploy history rows, rendering nothing (current appearance) when
   `phases` is absent.
4. Handle the degenerate cases visually: total 0s, a single dominant phase
   (e.g. `deploy: 1400` — the outlier case must be obvious).
5. Tests: helper unit tests covering absent/partial/complete phases; extend
   the API route test with a history fixture line that includes `phases` and
   one without.
6. Run dashboard + api typecheck/lint/test; view the result against real
   develemail data; commit.

## Files involved
- `apps/api/src/routes/history.ts` — verify/fix `phases` passthrough
- `apps/api/src/routes/history.test.ts` — fixture with and without `phases`
- `apps/dashboard/src/lib/api-history.ts` — type already present; no change
  expected
- new file: `apps/dashboard/src/lib/deploy-phases.ts` — pure phase math
- new file: `apps/dashboard/src/lib/deploy-phases.test.ts` — its tests
- new file: `apps/dashboard/src/components/` (or feature-local) phase bar
  subcomponent — follow where deploy history rows live
- the existing deploy-history row component — one-line integration

## Acceptance criteria
- [ ] Deploys with `phases` show the stacked bar + per-phase seconds; deploys
      without render exactly as before (no layout shift, no crash)
- [ ] The develemail 1500s-style case (one phase dominating) is visually
      unmistakable
- [ ] Test coverage: `apps/dashboard/src/lib/deploy-phases.test.ts` covers
      absent/partial/complete/zero cases; `apps/api/src/routes/history.test.ts`
      asserts `phases` passthrough for new-format lines and absence for old
- [ ] dataviz skill consulted for the bar's colors/markup
- [ ] api + dashboard typecheck, lint, test green

## Out of scope
- Aggregations/trends across deploys (avg build time charts, etc.)
- CI history phases (`.ci-history.jsonl` has no phase data)
- Alerting on slow phases
- Backfilling `phases` for old history entries
