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
- [x] A single exported classifier in `packages/core` is the only place the
      staleness rule is implemented — no duplicate heuristic in the API or CLI
- [x] `GET /projects/:name/deploy-status` returns the classification alongside
      the existing fields, and every field the dashboard reads today is
      unchanged in name and type
- [x] `emit-infra status` prints whether the local pipeline is running,
      orphaned, or idle
- [x] Pre-283 records (no `writer` block) are handled without crashing and are
      never reported as confidently running
- [x] Test coverage in `packages/core/src/deploy-status.test.ts` for all eight
      cases listed in task 6
- [x] `pnpm test`, `pnpm lint`, `pnpm typecheck` green

## Out of scope
- Any dashboard UI change — that's sprint 285, which consumes what this sprint
  exposes.
- Mutating or clearing orphaned records — that's sprint 286. This sprint is
  read-only.
- Changing the writers. If the classifier wants a field that sprint 283 didn't
  write, note it in the sprint follow-ups rather than editing `ci-utils.sh`
  here.

## Completed

**Date:** 2026-08-20

### Summary
`packages/core/src/deploy-status.ts` is now the single implementation of
"is this pipeline record actually running." `classifyRunState(record, opts)`
returns `{ state: 'idle'|'running'|'orphaned'|'unknown', reason,
heartbeatAgeSec, pidAlive, sameHost }`. The rule, in priority order: a
terminal `status` is always `idle`; a live same-host writer pid is the
strongest positive signal and wins even over a stale heartbeat (`running`); a
dead same-host pid is conclusive (`orphaned`); everything else — cross-host
records, or same-host records where the pid can't be checked — falls back to
heartbeat age alone, orphaned past `ORPHAN_HEARTBEAT_THRESHOLD_SEC` (4×
sprint 283's 30s refresh interval = 120s) and running otherwise; pre-283
records with no `writer` block get `unknown` unless they've been claiming to
run for over `UNKNOWN_RECORD_ORPHAN_AGE_SEC` (30 minutes), which flips them to
`orphaned` since a real deploy/CI run doesn't take that long and there's no
positive evidence either way. Both thresholds and the reasoning live as
exported constants with comments next to the rule, per the sprint's ask to
"choose thresholds deliberately and write down the reasoning."

`apps/api/src/routes/project-status.ts`'s `ci-status`/`deploy-status` routes
call it through a small `withRunState` helper that spreads the parsed record
and adds a `runState` field — additive only, so every field the dashboard
already reads is untouched in name and type. 404 (missing file) and 500
(unparseable JSON) behavior is unchanged; the classifier only runs on a
successfully-parsed record.

`apps/cli/src/commands/status.ts` (previously purely an SSH health check) now
opens with a "Local pipeline (this machine)" section that reads
`.ci-status.json`/`.deploy-status.json` from `process.cwd()` and prints each
one's classification and reason via the same `classifyRunState` call the API
uses, before attempting any SSH connection — so a missing/unresolvable server
IP no longer hides whether the local deploy is still running. A record that
was never written prints "no local record" rather than a classification, to
distinguish "never ran here" from "ran but liveness is unknown."

One design note worth flagging for later: `classifyRunState`'s default
`currentHost` is `os.hostname()`, matching the TS writer
(`deployRecordInit`), while the bash writer records `hostname -s` (short
form). On a host where the two forms differ (FQDN vs short name), a genuinely
same-host record could be misclassified as cross-host — which only costs
precision (falls back to the still-correct heartbeat rule), not correctness,
but it's a latent mismatch between the two writers' host format. See
Follow-ups.

### Files changed
- (new) `packages/core/src/deploy-status.ts` — `classifyRunState`, record
  types, and the two threshold constants
- (new) `packages/core/src/deploy-status.test.ts` — 10 tests covering the 8
  required cases (live/dead same-host pid, stale/fresh heartbeat, cross-host,
  missing writer at two ages, terminal, malformed/partial) plus a
  cross-host-stale-heartbeat variant and a null/undefined-record case
- `packages/core/src/index.ts` — exports the new module's public surface
- `apps/api/src/routes/project-status.ts` — `withRunState` helper; both
  `ci-status`/`deploy-status` handlers enrich their response with it
- `apps/api/src/routes/project-status.test.ts` — mocks `classifyRunState`;
  new `describe.each` block for both routes covering 404, 500 (classifier not
  called), and the enrichment-preserves-original-fields case
- `apps/cli/src/commands/status.ts` — local pipeline-state section
  (`readLocalStatusRecord`, `formatPipelineLine`, `printLocalPipelineState`),
  printed before the SSH health check; command description updated
- `apps/cli/src/commands/status.test.ts` — coverage for the two new exported
  helpers (file read/parse robustness, output formatting per state)

### Verification
- `packages/core` classifier tests: 10/10 pass (`vitest run
  packages/core/src/deploy-status.test.ts`)
- `apps/api` route tests: 12/12 pass, including the new enrichment coverage
- `apps/cli` status tests: 11/11 pass
- `pnpm typecheck` (nx, all 5 projects): clean — had to rebuild `core`'s dist
  first (`nx build core`), since the CLI resolves `@emit-infra/core` through
  its compiled output rather than an alias to `src`, unlike the API's vitest
  config which aliases straight to source
- `pnpm lint` (nx, all 5 projects): clean
- `pnpm test` (nx, all 4 test-bearing projects, run with `--skip-nx-cache` to
  force a live run): **356 + 207 + 161 + 126 = all green, 0 failures** across
  92 test files (core 13/126, dashboard 21/207, api 42/356, cli 16/161 —
  dashboard/api numbers are their full existing suites, unaffected by this
  sprint's changes but re-verified green)

### Follow-ups
- `[defer]` `os.hostname()` (TS writer/reader) vs `hostname -s` (bash writer)
  can disagree in form (FQDN vs short) on some hosts, which would misclassify
  a genuinely same-host record as cross-host. Not a correctness bug today —
  the cross-host path still falls back to the heartbeat rule correctly — but
  worth normalizing (e.g. both sides short-hostname) if sprint 286's
  `--reconcile` command ever wants to distinguish "same host, can't verify
  pid" from "different host" more precisely.
- `[defer]` `emit-infra status`'s local pipeline section always prints even
  when neither `.ci-status.json` nor `.deploy-status.json` exists (e.g. a
  project that's never been pushed through the hooks) — it just shows two
  "no local record" lines. That's correct behavior, not a bug, but if it
  turns out noisy in practice, a future pass could suppress the section
  entirely when both files are absent.
- none other
