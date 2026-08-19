# Render orphaned deploys distinctly instead of a frozen progress bar
**Difficulty:** 3

## Goal
When a deploy is orphaned, the dashboard says so — plainly, with how long it has
been stale — instead of showing a progress bar parked at a percentage that will
never move.

## Reason
This is where the 2026-08-19 incident actually hurt. The status file was wrong,
but what the operator *saw* was a normal-looking progress bar at 66% with an
elapsed timer counting up, which reads as "a deploy is running, be patient."
They waited, then had to ask whether it was real. Every layer below this can be
correct and the operator will still be misled if the UI renders an orphaned run
identically to a live one.

Sprints 283 and 284 make the truth available in the API response. This sprint is
what turns that into something a human notices.

## Context
- `apps/dashboard/src/components/detail/pipeline-progress-card.tsx` is the
  component that rendered the stuck bar. The relevant lines today:
  - line ~39: `const ciRunning = ci?.status === 'running'`
  - line ~40: `const deployRunning = deploy?.status === 'deploying' || deploy?.status === 'running'`
  - line ~45: `const status = deployRunning ? deploy! : ci!`
  - line ~47: `const pct = progress?.pct ?? 0`
  - line ~78: `{elapsed(status.startedAt)}` — the counting-up timer
  - line ~90: the bar width is `${pct}%`
  - line ~103: the numeric `{pct}%` label

  Note `deployRunning` is derived purely from the `status` string, which is
  exactly the assumption sprint 284 invalidates.
- `apps/dashboard/src/lib/use-pipeline-running-count.ts` line ~24 counts
  `r.value[1]?.status === 'deploying'` for a running-count badge. That badge
  will over-count orphaned runs until it uses the classification too.
- `apps/dashboard/src/components/project-card.tsx` **does** surface deploy
  state and needs the same treatment — confirmed, not a maybe. Line ~51 reads
  `deployStatus?.status === 'deploying' ? deployStatus.progress : null`, the
  same string-equality assumption as the progress card.
- **There is no shared pipeline-status hook to thread through.** Three
  components each fetch and derive run-state independently:
  1. `usePipelinePolling`, defined *locally* at
     `pipeline-progress-card.tsx:7` (not exported, not in `src/lib/`)
  2. `usePipelineStatus`, defined *locally* at `project-card.tsx:15`
  3. `use-pipeline-running-count.ts`, its own polling loop

  `apps/dashboard/src/lib/use-project-detail.ts` does **not** fetch pipeline
  status and is not part of this path — do not start there. Either update all
  three call sites, or extract a shared hook into `src/lib/` first and have all
  three consume it. Prefer the extraction: three copies of this heuristic is
  what sprint 284 exists to prevent, and leaving them separate on the dashboard
  side would undo that at the last hop.
- The classification comes from the API response enriched in sprint 284. Consume
  it; do not re-derive staleness in the dashboard.
- The dashboard is Next.js + TypeScript. Follow the existing component
  conventions in `apps/dashboard/src/components/detail/` — look at
  `alert-banners.tsx` for how this codebase already presents a warning state.
- Keep the live-deploy rendering exactly as it is today. The only visual change
  should be for records the classifier flags as orphaned or unknown.

## Tasks
1. Thread the classification from the API response to the three fetch sites
   listed in Context (`pipeline-progress-card.tsx:7`, `project-card.tsx:15`,
   `use-pipeline-running-count.ts`). Decide up front whether to extract one
   shared hook into `src/lib/` or patch each in place, and say why in the PR.
2. Change `deployRunning` / `ciRunning` so they mean "classified as running",
   not "status string says deploying".
3. Add the orphaned presentation: stop the elapsed timer from implying progress,
   replace or clearly annotate the progress bar, state how long the record has
   been stale, and say what to do about it (once sprint 286 lands, name the
   `--reconcile` command here).
4. Handle the `unknown` classification — a pre-283 record with no liveness
   metadata should read as indeterminate, not as either confidently live or
   confidently dead.
5. Fix `use-pipeline-running-count.ts` so orphaned runs don't inflate the
   running badge.
6. Apply the same treatment to `project-card.tsx` line ~51 — it presents
   deploy state today, so this is required, not conditional.
7. Add component/unit tests covering: live deploy renders as today; orphaned
   deploy renders the stale treatment; unknown renders the indeterminate
   treatment; the running count excludes orphaned runs.

## Files involved
- `apps/dashboard/src/components/detail/pipeline-progress-card.tsx` — the
  primary change
- `apps/dashboard/src/lib/use-pipeline-running-count.ts` — exclude orphaned runs
- `apps/dashboard/src/components/project-card.tsx` — required; local
  `usePipelineStatus` (line ~15) and the derive at line ~51
- possible new file: `apps/dashboard/src/lib/use-pipeline-status.ts` — if the
  three duplicated fetch/derive sites are consolidated into one shared hook
  (preferred; see Context)
- new file: `apps/dashboard/src/components/detail/pipeline-progress-card.test.tsx`
  — render coverage for the three states

## Acceptance criteria
- [ ] An orphaned deploy record renders visibly differently from a live one and
      does not show a progress bar that implies work is happening
- [ ] The stale duration is shown, so "stuck at 66%" becomes "orphaned, no
      heartbeat for 16m"
- [ ] A live deploy renders exactly as it does today (no regression in the happy
      path)
- [ ] `unknown` (pre-283, no liveness metadata) renders as indeterminate rather
      than as running
- [ ] The pipeline running-count badge excludes orphaned runs
- [ ] Test coverage in
      `apps/dashboard/src/components/detail/pipeline-progress-card.test.tsx`
      for live / orphaned / unknown, plus a running-count test
- [ ] `pnpm lint`, `pnpm typecheck`, `pnpm test` green

## Out of scope
- Any change to the staleness rule itself — consume sprint 284's classifier, and
  if it's wrong, fix it there.
- Clearing or mutating orphaned records from the dashboard. Recovery is sprint
  286 and is CLI-first; a dashboard button can be proposed as a follow-up.
- Redesigning the pipeline card generally, or touching the CI-status rendering
  beyond what the classification change requires.
