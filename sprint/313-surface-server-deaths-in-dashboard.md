# Surface server deaths in the dashboard
**Difficulty:** 3

## Goal
Server deaths recorded by the supervisor are visible in the develemit-hq
dashboard alongside deploy and CI history, so a crash is something you notice
rather than something you go looking for.

## Reason
The point of recording deaths was to answer "why did it die." A JSONL file you
have to remember to `cat` does not achieve that — on 2026-08-23 the API was
down 14 hours precisely because nothing surfaced it. The dashboard is where the
user already looks for pipeline state, so that is where a death belongs.

This is cheap because the plumbing exists. `apps/api/src/routes/history.ts`
already serves per-project JSONL files to the dashboard with a settled pattern:
validate params, resolve the project, read the file from
`~/projects/<name>/<file>.jsonl`, slice and reverse. Adding one more file to
that pattern is a small, well-precedented change.

## Context

### The existing route pattern
`apps/api/src/routes/history.ts:96` is the closest model:
```ts
app.get('/projects/:name/deploy-history', async (req, reply) => {
  const params = NameParam.safeParse(req.params)
  if (!params.success) return reply.status(400).send({ error: params.error.message })
  const query = LimitQuery.safeParse(req.query)
  if (!query.success) return reply.status(400).send({ error: query.error.message })

  const project = await findProject(params.data.name)
  if (!project) return reply.status(404).send({ error: 'not found' })

  const filePath = join(homedir(), 'projects', params.data.name, '.deploy-history.jsonl')
  const all = await readJsonl<DeployHistoryEntry>(filePath, undefined, { tail: 50_000 })
  const deploys = all.slice(-query.data.limit).reverse()

  return { deploys }
})
```
Reuse `readJsonl` from `../lib/jsonl.js` (it takes a `tail` byte budget so a
large file doesn't get fully buffered), `NameParam`, `LimitQuery`, and
`findProject`. Follow the same 400/404 handling — do not invent new error
shapes.

**A missing file must not be an error.** Most projects will never have a
`.server-deaths.jsonl`. Return an empty list, the same way the other history
routes tolerate absence. Check how `readJsonl` behaves on ENOENT before
assuming.

### The record shape (written by sprint 310)
One JSON object per line:
`ts`, `name`, `reason` (`health-timeout` | `exited`), `exitCode`, `signal`,
`uptimeSec`, `restartCount`, `pid`, `host`, `lastOutput`.

`lastOutput` is a multi-line blob (~40 lines) — it is the diagnostic payload,
but it must not blow up the list view. Show it collapsed/on demand.

### Dashboard side
The dashboard is `apps/dashboard` in **emit-infra** (Next 15). Sprint 305 added
launch-mode rendering to
`apps/dashboard/src/components/detail/deploy-timeline.tsx` and passed the field
through `apps/dashboard/src/lib/api-history.ts` — read both for the current
idiom before adding anything. Match the existing card/section styling rather
than introducing a new visual language.

Note the follow-up filed from sprint 305: `deploy-timeline.tsx` has **no test
file**. If you add rendering logic there, adding a first render test is
in-scope and welcome.

### Typing
`apps/api/src/routes/history.ts` defines its entry interfaces locally
(e.g. `DeployHistoryEntry`). Add a `ServerDeathEntry` in the same place unless
the type is genuinely shared, in which case `packages/types` is the home.

## Tasks
1. Add `GET /projects/:name/server-deaths` to
   `apps/api/src/routes/history.ts`, reading `.server-deaths.jsonl` with the
   same validation, limit, and reverse-chronological behaviour as
   `deploy-history`.
2. Return an empty list (not a 404/500) when the file does not exist.
3. Add a `ServerDeathEntry` type matching sprint 310's record shape.
4. Extend `apps/dashboard/src/lib/api-history.ts` with a fetcher for the new
   route.
5. Render deaths in the project detail view: timestamp, reason, exit
   code/signal, uptime, restart count — with `lastOutput` collapsed behind a
   disclosure rather than inline.
6. Make the empty state quiet — a project with no deaths should show nothing
   or a single dim line, not an alarming empty panel.
7. Add route tests to `apps/api/src/routes/history.test.ts` (sprint 305 already
   extended this file — follow its structure).

## Files involved
- `apps/api/src/routes/history.ts` — new route + entry type
- `apps/api/src/routes/history.test.ts` — route tests
- `apps/dashboard/src/lib/api-history.ts` — fetcher
- `apps/dashboard/src/components/detail/` — rendering (match existing card idiom)
- possibly `packages/types` — only if the type is genuinely shared

## Acceptance criteria
- [x] `GET /projects/:name/server-deaths` returns records newest-first and
      honours `limit`.
- [x] A project with no `.server-deaths.jsonl` returns an empty list with a 2xx,
      not an error.
- [x] Unknown project → 404; bad params → 400, matching sibling routes.
- [x] `apps/api/src/routes/history.test.ts` covers: records returned newest
      first, `limit` honoured, missing file → empty, unknown project → 404.
- [x] The dashboard renders deaths on the project detail view with
      `lastOutput` collapsed by default.
- [x] A project with zero deaths shows a quiet empty state.
- [x] `pnpm test` and `pnpm typecheck` clean.

## Out of scope
- Alerting, push notifications, or any "you are down right now" indicator —
  this sprint displays history only.
- Changing the supervisor or the record shape (sprint 310 owns that).
- Retrofitting death records onto anything other than the two supervised
  servers.

## Completed

**Date:** 2026-08-26

### Summary
Added `GET /projects/:name/server-deaths`, following `deploy-history`'s exact
validate/find/read/slice/reverse shape, and wired it through to a new
`ServerDeathsPanel` on the Reliability sub-page (next to `IncidentPanel` and
`AlertHistoryPanel` — a crash record is a reliability signal, not a pipeline
one, so it lives there rather than on the Pipelines page that hosts
`DeployTimeline`/`CiTimeline`). The panel self-fetches via `name` (same
pattern as `IncidentPanel`/`AlertHistoryPanel`), shows a quiet one-line empty
state ("No crashes recorded.") when there are zero deaths, and keeps
`lastOutput` behind a per-row disclosure toggle so a 40-line log blob never
pushes the list around by default.

While adding the route, `apps/api/src/routes/history.ts` was about to cross
this repo's 300-line file-size target (271 → 303 with the new route +
type). Rather than let it grow past the line, `disk-trend` and
`memory-trend` — the two routes that duplicated an identical
sum-of-squares linear-regression block verbatim, differing only in which
`MetricPoint` field they tracked — were extracted into
`apps/api/src/routes/trend-routes.ts`, backed by a new pure
`computeLinearTrend(points, key)` helper in `apps/api/src/lib/trend.ts` (unit
tested directly, no HTTP mocking needed) and a shared `MetricPoint` type in
`apps/api/src/lib/metric-point.ts`. This was a deduplication that fell out
of the size budget, not sprint-scope creep — no route's request/response
shape changed, confirmed by moving their existing tests over verbatim into
`trend-routes.test.ts` and having them pass unmodified against the new
registration.

### Files changed
- `apps/api/src/routes/history.ts` — added `ServerDeathEntry` type and the
  `server-deaths` route; removed `disk-trend`/`memory-trend` (moved out);
  `MetricPoint` now imported from `lib/metric-point.ts` instead of declared
  locally.
- `apps/api/src/routes/history.test.ts` — added the `server-deaths` describe
  block (404/400/empty-file/newest-first+limit); removed the
  `disk-trend`/`memory-trend` blocks (moved to `trend-routes.test.ts`).
- (new) `apps/api/src/routes/trend-routes.ts` — `disk-trend` and
  `memory-trend`, now built on `computeLinearTrend`.
- (new) `apps/api/src/routes/trend-routes.test.ts` — the moved
  disk-trend/memory-trend route tests, unchanged in behavior.
- (new) `apps/api/src/lib/trend.ts` — `computeLinearTrend(points, key)`.
- (new) `apps/api/src/lib/trend.test.ts` — direct unit tests of the
  regression math (rising/falling/flat/empty/short series).
- (new) `apps/api/src/lib/metric-point.ts` — shared `MetricPoint` interface.
- `apps/api/src/index.ts` — registers the new `trendRoutes`.
- `apps/dashboard/src/lib/api-history.ts` — added `ServerDeathEntry`,
  `ServerDeathsResponse`, and `getServerDeaths`.
- (new) `apps/dashboard/src/components/detail/server-deaths-panel.tsx` —
  renders the list; collapsed `lastOutput` disclosure; quiet empty state.
- (new) `apps/dashboard/src/components/detail/server-deaths-panel.test.tsx`
  — render tests covering empty state, fetch failure, cause labeling (signal
  vs exit code vs health-timeout), disclosure toggle, and the count badge.
- `apps/dashboard/app/projects/[name]/reliability/page.tsx` — mounts
  `ServerDeathsPanel` between `IncidentPanel` and `AlertHistoryPanel`.

### Verification
- `pnpm test`: 370/370 pass in `api` (45 files, up from 43), 224/224 pass in
  `dashboard` (up from 23 to 24 files) — full monorepo run green.
- `pnpm typecheck`: clean across all 5 projects.
- Manually traced `readJsonl`'s `existsSync` check (`apps/api/src/lib/jsonl.ts`)
  to confirm a missing `.server-deaths.jsonl` returns `[]` rather than
  throwing, before writing the "missing file" test.

### Follow-ups
- `[defer]` `apps/api/src/routes/history.test.ts` is still 476 lines (down
  from 507 pre-sprint, after moving the trend tests out) — over this repo's
  300-line target. A future touch of this file should split `ci-log`/
  `deploy-log` tests into their own file, following the same pattern used
  here for trend-routes.
- `[defer]` No test file exists yet for `deploy-timeline.tsx` (carried over
  from sprint 305 — untouched by this sprint, still open).
