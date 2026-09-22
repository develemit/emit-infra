# Make the dashboard's numbers true
**Difficulty:** 2

## Goal
Five places where the dashboard shows a wrong value show the right one:
deploy age, the Warning filter tab, backup storage size, the "healthy" count
while loading, and nginx error counts.

## Reason
From the read-only UI audit, `qa/ui-audit-2026-09-22.md` (findings UI-01,
UI-05, UI-06, UI-12, UI-24). This is an ops tool; its whole job is to show the
fleet's state accurately. Today Fleet Health says **every project deployed
"just now"**, the Warning tab lists failing projects, and a normal page load
briefly reads "2 / 8 healthy" as if half the fleet were down. Each fix is a pure
helper, so this is the cheapest, highest-trust cluster in the report.

## Context

### UI-01 — every "Last Deploy" reads "just now" (broken)
`apps/dashboard/app/health/helpers.ts:64` `deployAge(deployedAt)` does
`new Date(deployedAt)`. The API's `GET /projects/:name/status` returns
`deployedAt` as a **Unix-seconds string**. Verified live on 2026-09-22:
`'1790047707'`. `new Date('1790047707')` is Invalid Date, so the maths gives NaN,
both `d > 0` and `h >= 1` are false, and it returns `'just now'`. Used on
`app/health/page.tsx:136` and `:177` (table + mobile cards). The overview cards
show correct ages ("14h ago"), so another parser already handles this shape.
Find it (`grep -rn deployedAt apps/dashboard/src`) and reuse it rather than
writing a second one. Return `'—'` for anything unparseable. Never fall back to
"just now".

### UI-05 — Warning tab includes failing rows (broken)
`app/health/page.tsx:95` counts Warning as `rowLevel(r) !== 'ok' && rowLevel(r) !== 'fail'`
(strictly warn), but the table filter at `:116` uses `rowLevel(r) !== 'ok'`,
which includes fail. Result: "Warning (2)" shows 3 rows. `/ci`
(`app/ci/page.tsx:127` vs `:151` and `:198`) has the identical bug with
`statsLevel`. Make the filters match the badge: the Warning tab shows exactly
`warn`. Extract the predicate into a helper that both the count and the filter
call, so they can't drift apart again.

### UI-06 — cost panel prints "null B stored" (broken)
`src/components/detail/cost-panel.tsx:85`:
`` cost?.storage ? `${formatBytes(cost.storage.totalBytes)} stored` : '—' ``.
`totalBytes` is `null` for every project today (no backup buckets), and
`formatBytes` (line 6, typed `number`) doesn't guard. Show `'—'` or "No backups
stored" when `totalBytes` is null, and fix the type to admit `null`.

### UI-12 — "2 / 8 healthy" during load (degraded)
`app/page.tsx:76-78` counts projects whose status has resolved without error.
While statuses are still loading, unresolved projects count as unhealthy. Only
report the count once every status has settled, or render
`checking… (n / total)` until then. The colour logic on line 77 must not show
red during load either.

### UI-24 — fractional nginx error counts (polish)
`src/components/detail/health-card.tsx:126` and `:147` render
`` `4xx: ${nginx4xx} · 5xx: ${nginx5xx}` ``. On 7d/30d ranges they're averages
(e.g. `12.25`). Either round to integers, or keep one decimal and label it as a
per-day average. Pick one, and make the label say what the number is.

### Conventions
- Vitest beside source (`apps/dashboard/vitest.config.ts`; 24 existing test files).
  `app/health/helpers.ts` is a pure module, the natural place for new unit tests.
- The suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`
  in this repo). Scope while iterating with `pnpm exec nx run dashboard:test`.
- **Never run `pnpm build`** — the dashboard runs as `next dev` under launchd
  and a build clobbers its `.next` cache (every page 500s until restart).
- Optional visual check: the dashboard's buttons act on production, so any
  browser check must use `tools/ui-audit/read-only-guard.mjs`
  (`newGuardedContext` + `assertGuardActive`). See `docs/qa-page-inventory.md`.

## Tasks
1. Fix `deployAge` to parse the real API shape; add unit tests.
2. Extract the warn/fail predicates for `/health` and `/ci`; use them for both
   the counts and the filters; add unit tests.
3. Guard `formatBytes` against null in the cost panel.
4. Make the overview healthy count wait for loaded statuses.
5. Round or label the nginx error counts.

## Files involved
- `apps/dashboard/app/health/helpers.ts` — `deployAge`, new filter predicate
- `apps/dashboard/app/health/page.tsx` — use the predicate for the filter
- `apps/dashboard/app/ci/page.tsx` — same fix for `statsLevel`
- `apps/dashboard/src/components/detail/cost-panel.tsx` — null guard
- `apps/dashboard/app/page.tsx` — healthy count during load
- `apps/dashboard/src/components/detail/health-card.tsx` — nginx counts
- new file: `apps/dashboard/app/health/helpers.test.ts` (or extend an existing one)

## Acceptance criteria
- [ ] `deployAge('1790047707')` returns an hours/days string, not "just now";
      `deployAge` of an ISO string still works; garbage returns `'—'` —
      covered in `app/health/helpers.test.ts`
- [ ] The Warning tab and its badge agree on `/health` and `/ci` (a fixture
      with 2 warn + 1 fail rows shows 2 under Warning) — covered by a unit test
      of the shared predicate
- [ ] Cost panel never renders "null" — covered by a test, or by a unit test
      of the extracted formatter
- [ ] Overview doesn't show a partial healthy count while statuses load —
      covered by a test of the count helper
- [ ] Nginx error counts are integers or explicitly labelled averages
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- API changes to `deployedAt`'s format — fix the reader, not the producer.
- Error-vs-empty states (sprints 347-348).
