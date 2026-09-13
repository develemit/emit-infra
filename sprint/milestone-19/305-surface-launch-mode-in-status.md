# Surface a deploy's launch mode in `status` and the dashboard, and quiet the empty pipeline section
**Difficulty:** 2

> _Promoted from backlog: sprint-284 and sprint-291 follow-ups, 2026-08-22._

## Goal
`launch.mode` and `launch.marker` — the record of *how* a deploy was started —
are readable without opening the raw JSON, and `emit-infra status` stops
printing a two-line "no local record" block for projects that have never been
pushed through the hooks.

## Reason
Sprint 290 added a `launch` block to every deploy record:
```json
{"mode": "detached|interactive|unattended-override", "marker": "CLAUDECODE"}
```
Unlike `writer`, it deliberately survives onto terminal records — it's a fact
about how the deploy started, not a liveness signal. That makes it exactly the
field you want when a deploy behaved oddly and you're asking "was this one of
my agent-launched deploys, or did I run it from a terminal?"

Today nothing prints it. `emit-infra status` doesn't, the dashboard doesn't, and
the docs (sprint 291) tell you to read the raw JSON. For a workflow built
specifically around agent-triggered deploys, "which launch path produced this
record" is a first-class question and shouldn't require `jq`.

Separately, `printLocalPipelineState` unconditionally prints its header plus two
`no local record` lines even when neither `.ci-status.json` nor
`.deploy-status.json` exists. That's *correct* — absence is real information the
first time you look — but for a project that has never been pushed through the
hooks it's three lines of noise on every invocation.

## Context
- `apps/cli/src/commands/status.ts` (124 lines) holds
  `printLocalPipelineState`, `formatPipelineLine`, and `formatGateStalenessLine`.
  The section header is printed at line ~84, before either record is known to
  exist.
- `formatPipelineLine(label, record)` returns
  `  ${label}: ${color(state)}${progress} ${dim(reason)}`. The launch info would
  naturally hang off the Deploy line, but only deploy records carry a `launch`
  block — CI records never do. Don't add a branch that silently prints nothing
  for CI; make the asymmetry explicit.
- `launch.mode` is one of three values. `interactive` is the boring default and
  probably doesn't deserve visual weight; `unattended-override` is the one worth
  making visible, since it means someone set `EMIT_DEPLOY_DETACHED=1` (or the
  deprecated `EMIT_ALLOW_UNATTENDED_DEPLOY=1`) to get past the gate.
- The field is written by `deploy_launch_mode` (bash, `deploy-launch.sh`) and
  `deployLaunchMode` (TS). **Old records predate it** — treat a missing `launch`
  block as normal, not as an error, and don't print a placeholder for it.
- Dashboard side: the deploy status shape is rendered by
  `pipeline-progress-card.tsx` and friends under `apps/dashboard/src`. Find the
  component that already renders deploy state rather than adding a new one.
- Sprint 299's `formatGateStalenessLine` already models the right pattern for
  the quieting change: it returns `null` for the uninteresting case and the
  caller skips printing. Reuse that shape.

## Tasks
1. Print `launch.mode` on the Deploy line in `emit-infra status` when the record
   carries one. Decide and justify the treatment for each of the three values —
   in particular whether `interactive` is worth showing at all, and how
   `unattended-override` is distinguished visually.
2. Include `launch.marker` when it adds information (which env var tripped the
   detection), suppressing it when it would just repeat the mode.
3. Surface the same on the dashboard's existing deploy card. Match whatever the
   card already does for secondary metadata; don't invent a new visual idiom.
4. Suppress the whole `Local pipeline (this machine):` section when **both**
   records are absent. Keep the current output whenever at least one exists —
   "CI ran, deploy never did" is meaningful and must still print both lines.
5. Cover the new behaviour in `status.test.ts`: each launch mode, a record with
   no `launch` block (old record), both-absent (section suppressed), and
   one-present (section still fully printed).
6. Update sprint 291's docs where they say to read the raw JSON for these
   fields.

## Out of scope
- Changing what `deploy_launch_mode` / `deployLaunchMode` decide, or the marker
  list. Sprints 288 and 290 settled that; this sprint only displays it.
- Extracting a shared source of truth for the duplicated bash/TS launch-mode
  logic — that's separately filed, and its own trigger condition (a third
  implementation) hasn't been met. **Adding a dashboard-side *read* of an
  existing field is not a third implementation** — do not let this sprint
  reimplement the decision logic anywhere.
- Any change to the gate's blocking behaviour.

## Acceptance criteria
- `emit-infra status` prints the launch mode for a deploy record that has one,
  omits it cleanly for records that don't, and never prints a launch field on
  the CI line.
- A project with neither status file prints no `Local pipeline` section; a
  project with either one prints the full section unchanged.
- The dashboard shows the same launch information on its existing deploy card.
- `status.test.ts` covers all six cases in task 5.
- Docs no longer instruct readers to open the raw JSON for `launch.*`.
- `apps/cli/src/commands/status.ts` stays under 300 lines; extract a helper
  module if it would cross.
- Typecheck clean, `pnpm test` green.

## Completed

**Date:** 2026-08-23

### Summary
`launch.mode`/`launch.marker` (sprint 290) are now readable without `jq` from
both `emit-infra status` and the dashboard, and the CLI's local-pipeline
section goes quiet for projects that have never been pushed through the hooks.

On the CLI side, `formatPipelineLine` takes `launch` as an explicit third
parameter rather than reading `record.launch` implicitly — the Deploy call
site passes `deploy?.launch`, the CI call site passes nothing at all, so the
"CI records never carry a launch block" asymmetry is visible in the call
sites, not buried in a branch. All three mode values are shown when present
(`interactive`/`detached` dim, matching the rest of the line; `unattended-override`
in the Push-gate's warn yellow so a gate bypass stands out). `marker` is
appended as `via <MARKER>` only when non-empty — an empty marker is the
ordinary case and would just be noise. Section suppression is a small pure
predicate, `hasLocalPipelineRecord(ci, deploy)`, so the "both absent" /
"either present" behavior is testable without wiring up the function's
console/fs/git side effects — same shape as sprint 299's
`formatGateStalenessLine`.

On the dashboard side, the right "existing deploy card" turned out to be
`DeployTimeline` (the Deploy History list), not `PipelineProgressCard` —
the latter unmounts entirely once a deploy goes idle, so it can never show a
terminal record's launch mode. `DeployHistoryEntry`'s TS type (both the API
route's local interface and the dashboard's `api-history.ts` copy) was
silently dropping `launch` even though `deployRecordDone` has written it into
every history line since sprint 290 — the JSON round-tripped, just untyped.
Declaring the field on both interfaces and rendering it in the existing
secondary-metadata row (next to `servicesBuilt`, same `text-[11px] font-mono
text-subtle` idiom, `text-warn` for `unattended-override`) closes that gap
without inventing a new visual pattern or a second launch-mode decision path.

### Files changed
- `apps/cli/src/commands/status.ts` — added `formatLaunchSuffix`, threaded
  `launch` through `formatPipelineLine` as an explicit param, added
  `hasLocalPipelineRecord` and used it to suppress the local-pipeline section.
- `apps/cli/src/commands/status.test.ts` — covers all three launch modes,
  marker inclusion/suppression, no-launch-block records, CI never showing
  launch, and both `hasLocalPipelineRecord` branches.
- `apps/dashboard/src/lib/api-history.ts` — added `DeployLaunchInfo` and
  `launch?` on `DeployHistoryEntry`.
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — renders launch
  mode (+ marker when present) in the existing metadata row.
- `apps/api/src/routes/history.ts` — added the matching `launch?` field to
  this route's own `DeployHistoryEntry` interface so the value it already
  writes through actually has a type.
- `apps/api/src/routes/history.test.ts` — added a launch-passthrough test
  mirroring the existing `phases` passthrough test.
- `docs/DEPLOY-SIGNALS-AND-LIVENESS.md` — replaced the "read it straight out
  of the JSON" instruction with where `launch.mode`/`launch.marker` now show
  up.

### Verification
- `pnpm test`: 916/916 pass (core 153, dashboard 215, cli 191, api 357).
- `pnpm typecheck`: clean across all 5 projects (types, core, dashboard, cli, api).
- `apps/cli/src/commands/status.ts`: 158 lines (well under 300).

### Follow-ups
- `[defer]` No test file exists yet for `deploy-timeline.tsx` itself
  (component-level render tests) — the new launch rendering is only verified
  indirectly via the API passthrough test and manual type-checking of the JSX.
  A future sprint touching that component should add one.
