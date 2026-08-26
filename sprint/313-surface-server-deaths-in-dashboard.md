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
- [ ] `GET /projects/:name/server-deaths` returns records newest-first and
      honours `limit`.
- [ ] A project with no `.server-deaths.jsonl` returns an empty list with a 2xx,
      not an error.
- [ ] Unknown project → 404; bad params → 400, matching sibling routes.
- [ ] `apps/api/src/routes/history.test.ts` covers: records returned newest
      first, `limit` honoured, missing file → empty, unknown project → 404.
- [ ] The dashboard renders deaths on the project detail view with
      `lastOutput` collapsed by default.
- [ ] A project with zero deaths shows a quiet empty state.
- [ ] `pnpm test` and `pnpm typecheck` clean.

## Out of scope
- Alerting, push notifications, or any "you are down right now" indicator —
  this sprint displays history only.
- Changing the supervisor or the record shape (sprint 310 owns that).
- Retrofitting death records onto anything other than the two supervised
  servers.
