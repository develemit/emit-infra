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
