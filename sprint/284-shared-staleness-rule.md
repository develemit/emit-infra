# Define "orphaned" once in packages/core and use it in the API and CLI
**Difficulty:** 3

## Goal
One shared helper decides whether a status record is genuinely in flight or
orphaned, and both the API route and the CLI use it — so the dashboard, the
terminal, and any future reader can never disagree about whether a deploy is
running.

## Reason
Sprint 283 writes liveness metadata into the status files but nothing reads it.
Left there, each consumer would invent its own staleness heuristic — the
dashboard one way, `emit-infra status` another, the running-count badge a third
— and they would drift. That drift is how an operator ends up with a dashboard
insisting a deploy is live while the CLI says otherwise, which is a worse
failure than the original stuck 66% because it destroys trust in both.

Defining the rule once, next to the record types, also gives sprint 286's
`--reconcile` command something authoritative to act on rather than duplicating
a fourth copy of the logic.

## Context
- `packages/core` is the shared library (`@emit-infra/core`) consumed by
  `apps/api`, `apps/cli`, and indirectly by the dashboard through the API.
  `packages/core/src/deploy-records.ts` already owns the writer side and the
  `DeployContext` type — the reader side belongs beside it.
- The API surface is `apps/api/src/routes/project-status.ts`. Two routes matter:
  - `GET /projects/:name/ci-status` (~line 140)
  - `GET /projects/:name/deploy-status` (~line 160)

  Both currently do the same thing: read
  `~/projects/<name>/.deploy-status.json`, `JSON.parse` it, and `reply.send` the
  parsed object verbatim. Neither inspects `status`. A parse failure returns
  500; a missing file returns 404.
- `apps/cli/src/commands/status.ts` today is a *server* health check (SSH,
  uptime, disk, containers) and does not read the local status files at all.
  Adding a local pipeline-state section to it is in scope; rewriting the SSH
  behavior is not.
- The staleness rule needs to handle records written *before* sprint 283 (no
  `writer` block at all). Treat a missing `writer` as "unknown liveness" and
  fall back to age-since-`startedAt` — do not report those as definitively live.
- Choose thresholds deliberately and write down the reasoning. A heartbeat older
  than a few multiples of the refresh interval is a strong orphan signal; a
  same-host pid that no longer exists is conclusive. Cross-host records can only
  use the heartbeat.
- Keep the API response backward compatible: add fields, don't remove or rename
  the ones the dashboard already reads (`status`, `sha`, `branch`, `startedAt`,
  `progress.pct`, `progress.label`).

## Tasks
1. Add a reader module in `packages/core` — e.g.
   `packages/core/src/deploy-status.ts` — exporting the record type and a
   classifier such as `classifyRunState(record, opts)` returning something like
   `'idle' | 'running' | 'orphaned' | 'unknown'` plus the evidence used
   (`heartbeatAgeSec`, `pidAlive`, `sameHost`).
2. Implement the rule: a record whose `status` is terminal is never running; a
   record with a live same-host pid is running; a record whose heartbeat is
   older than the threshold is orphaned; a pre-283 record with no `writer` is
   classified by age with an explicit `unknown` where it can't be decided.
3. Export it from `packages/core`'s index alongside the existing deploy-record
   exports.
4. Use it in `apps/api/src/routes/project-status.ts`: enrich both status route
   responses with the classification (additive fields only). Keep the 404/500
   behavior for missing and unparseable files exactly as it is.
5. Add a local pipeline-state section to `apps/cli/src/commands/status.ts` that
   reads the project's `.deploy-status.json` / `.ci-status.json` and prints the
   classification — so an operator can answer "is it actually deploying?" from
   the terminal without the dashboard.
6. Write unit tests for the classifier covering: live same-host pid; dead
   same-host pid; stale heartbeat; fresh heartbeat; cross-host record; missing
   `writer` block (pre-283); terminal record; malformed/partial record.

## Files involved
- new file: `packages/core/src/deploy-status.ts` — record type + classifier
- new file: `packages/core/src/deploy-status.test.ts` — classifier coverage
- `packages/core/src/index.ts` — export the new module
- `apps/api/src/routes/project-status.ts` — enrich both status responses
- `apps/cli/src/commands/status.ts` — local pipeline-state section
- `apps/cli/src/commands/status.test.ts` — cover the new output section

## Acceptance criteria
- [ ] A single exported classifier in `packages/core` is the only place the
      staleness rule is implemented — no duplicate heuristic in the API or CLI
- [ ] `GET /projects/:name/deploy-status` returns the classification alongside
      the existing fields, and every field the dashboard reads today is
      unchanged in name and type
- [ ] `emit-infra status` prints whether the local pipeline is running,
      orphaned, or idle
- [ ] Pre-283 records (no `writer` block) are handled without crashing and are
      never reported as confidently running
- [ ] Test coverage in `packages/core/src/deploy-status.test.ts` for all eight
      cases listed in task 6
- [ ] `pnpm test`, `pnpm lint`, `pnpm typecheck` green

## Out of scope
- Any dashboard UI change — that's sprint 285, which consumes what this sprint
  exposes.
- Mutating or clearing orphaned records — that's sprint 286. This sprint is
  read-only.
- Changing the writers. If the classifier wants a field that sprint 283 didn't
  write, note it in the sprint follow-ups rather than editing `ci-utils.sh`
  here.
