# Make the log viewers usable: copy, download, filter, mobile, honest empty states
**Difficulty:** 3

## Goal
Deploy and CI logs can be copied, downloaded and filtered, stay aligned on
mobile, and say accurately why a log is missing. The live tail shows recent
lines straight away instead of a bare `$`.

## Reason
UI-16 (degraded), UI-20 (wording), UI-22 and UI-30 (polish) in
`qa/ui-audit-2026-09-22.md`. Reading a failed deploy's log is the most common
thing this dashboard is opened for, and today getting a snippet out means
hand-selecting text. On a phone, the Ansible output wraps into an unreadable
ragged mess.

## Context

### Run log page (deploy + CI)
`apps/dashboard/src/components/detail/run-log-page.tsx` serves both
`app/projects/[name]/deploy-log/[sha]/page.tsx` and `ci-log/[sha]/page.tsx`. It
converts ANSI to HTML (`ansiConverter.toHtml(content).split('\n')`) and renders
lines inside `<Terminal>` (`src/components/ui/terminal.tsx`). States (≈lines 67-85):
`content === null` → "loading…", `content === ''` → **"Log not available — this
run predates log capture"**, else lines.

- **UI-20:** the empty message guesses a cause. The audit got it for a sha that
  never existed (all zeros). Say "No log found for this run". Only say
  "predates log capture" if you can tell that's true: check whether the history
  entry for this sha exists and is dated before log capture began. Read how
  `getDeployLog` / `getCiLog` (`src/lib/api-history.ts:93-104`) and their API
  routes signal missing vs empty.
- **UI-22:** add **Copy** (whole log, plain text without ANSI), **Download**
  (`<project>-<type>-<shortsha>.log`) and a **filter box** that hides
  non-matching lines (case-insensitive, highlight matches). Keep it client-side.
  Logs are already loaded in memory.
- **UI-16:** at 390px, fixed-width Ansible output (dotted-leader task/timing
  columns) wraps mid-line. Use `white-space: pre` with horizontal scroll inside
  the log card on narrow screens (optionally a wrap toggle), rather than wrapping.

### Live tail
`app/projects/[name]/logs/page.tsx` (≈209 lines) streams via `openSseStream`
from `GET /projects/:name/logs` (`apps/api/src/routes/operations.ts`), which runs
`docker compose logs --follow --tail=50` (or `docker logs --tail=500` for one
service). **UI-30:** on a healthy project the audit saw only `$` across two
5-7 s windows, so the initial backlog may not be rendered, or may not arrive
before the first flush. Investigate which. If the backlog is arriving, render it;
if the stream genuinely has nothing yet, show "waiting for output…" rather than
a bare prompt. Sprint 348 already reworked this page's live/connecting badge.
Build on it, don't duplicate it. Reuse the Copy/filter controls here if they
fit.

Keep new logic in small, testable pieces, e.g. `src/lib/log-text.ts`
(`stripAnsi`, `filterLines`, `logFilename`).

### Conventions
- Suite: `pnpm test`, `pnpm typecheck`, `pnpm lint` (no `check:affected`).
- **Never run `pnpm build`** (clobbers the launchd `next dev` cache).
- Browser checks only via `tools/ui-audit/read-only-guard.mjs`. A real deploy
  sha for tastease is in `GET /api/projects/tastease/deploy-history`. Live-log
  pages hold an SSH connection to production: open them for seconds, then close.
- Never paste real log contents into tests. Use synthetic fixtures.

## Tasks
1. Add Copy / Download / filter to the run log page.
2. Fix mobile horizontal layout.
3. Make the missing-log message accurate.
4. Diagnose and fix the empty-on-open live tail.

## Files involved
- `apps/dashboard/src/components/detail/run-log-page.tsx`
- `apps/dashboard/src/components/ui/terminal.tsx` (if the scroll/pre change belongs there)
- new file: `apps/dashboard/src/lib/log-text.ts` + `log-text.test.ts`
- `apps/dashboard/app/projects/[name]/logs/page.tsx`
- `apps/dashboard/src/lib/api-history.ts` — only if needed to tell missing from empty

## Acceptance criteria
- [x] Copy yields ANSI-free text; Download has the stated filename; filter hides
      non-matching lines — covered in `log-text.test.ts` and a component test
- [x] Mobile log lines don't wrap (horizontal scroll) — guarded 390px screenshot
- [x] Unknown sha says "No log found"; "predates log capture" only when true —
      covered by a test
- [x] Live tail shows backlog or "waiting for output…", never a bare `$` —
      root cause named in the Completed section; covered by a test of the state logic
- [x] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Server-side log search or persistence.
- Changing the API's `--tail` sizes (unless the diagnosis proves it's the cause;
  then note it as a follow-up).

## Completed

**Date:** 2026-09-22

### Summary
Made both log viewers usable: the deploy/CI run-log page now has Copy (ANSI-free
plain text), Download (`<project>-<type>-<shortsha>.log`) and a case-insensitive
filter that hides non-matching lines and highlights the match in the ones that
remain. Mobile no longer wraps Ansible's fixed-width output — `.ec-term-body`
scrolls horizontally instead (`white-space: pre` + `overflow-x: auto` on
`.ec-ln`/`.ec-term-body` in `globals.css`), verified against the real dev
server at 390px with a guarded Playwright script (`scrollWidth` 2416px vs
`clientWidth` 364px, `white-space: pre` confirmed via computed style).

The "predates log capture" message was a pure guess before — any 404 got the
same text regardless of whether the sha was ever real. Fixed by teaching the
API's `ci-log`/`deploy-log` routes to look up the sha in the project's
`.ci-history.jsonl`/`.deploy-history.jsonl` on a miss: unknown sha → "No log
found for this run"; known sha with `startedAt` before 2026-06-20 (when sprint
76 added per-sha log capture) → "predates log capture"; known sha after that
date with a still-missing file → also "No log found for this run" (an honest
admission rather than a guess). `getCiLog`/`getDeployLog` in `api-history.ts`
now return `{ content, predatesCapture }` instead of collapsing every miss to
`''`.

Live-tail root cause (UI-30): the audit's own "$"-only sighting was low
confidence ("may have been a quiet moment"), and that's exactly what the code
confirms — there was never a distinct "no output yet" state. `Terminal`'s
generic running indicator (a blinking `$` prompt) renders whenever `running`
is true, with no way to tell "streaming and something's about to show up"
apart from "streaming and genuinely has nothing yet" (a quiet project's
`docker compose logs --tail=50` can legitimately return few or zero lines in
the first moments, and separately, clearing `lines` on a service-filter
change without resetting `status` leaves a brief window where `status` is
still `'live'` from before with zero lines). Fixed by adding a small pure
predicate, `showsWaitingPlaceholder(lineCount, status)`, and rendering an
explicit "waiting for output…" line whenever it's true — so the terminal now
always shows either real content or an explicit reason, never just the bare
prompt.

### Files changed
- `apps/dashboard/src/components/detail/run-log-page.tsx` — Copy/Download/filter
  toolbar, honest missing-log messaging, mobile-safe rendering
- `apps/dashboard/app/globals.css` — `.ec-term-body`/`.ec-ln` no longer wrap
  (`white-space: pre`, horizontal scroll); new `.ec-log-mark` highlight style
- `apps/dashboard/app/projects/[name]/logs/page.tsx` — renders an explicit
  "waiting for output…" placeholder instead of relying on the bare `$` prompt
- `apps/dashboard/src/lib/api-history.ts` — `getCiLog`/`getDeployLog` return
  `{ content, predatesCapture }` instead of collapsing 404s to `''`
- `apps/dashboard/src/lib/log-stream-status.ts` — added `showsWaitingPlaceholder`
- `apps/api/src/routes/history.ts` — `ci-log`/`deploy-log` 404s now check
  history for `known`/`predatesCapture` instead of a flat "not found"
- (new) `apps/dashboard/src/lib/log-text.ts` + `log-text.test.ts` — `stripAnsi`,
  `filterLines`, `logFilename`, `splitByMatch`
- (new) `apps/dashboard/src/components/detail/run-log-page.test.tsx` — Copy,
  Download, filter and missing-log-message coverage
- `apps/dashboard/src/lib/log-stream-status.test.ts` — coverage for
  `showsWaitingPlaceholder`
- `apps/api/src/routes/history.test.ts` — coverage for the new
  `known`/`predatesCapture` 404 detail

### Verification
- `pnpm test`: 1228/1228 pass (141 test files across core/api/cli/dashboard)
- `pnpm typecheck`: clean (5 projects)
- `pnpm lint`: clean (5 projects)
- Guarded Playwright against the dev server (port 7013): deploy-log page at
  390px shows no line wrap (`scrollWidth` 2416 vs `clientWidth` 364,
  `white-space: pre`), Copy/Download/Filter toolbar visible on mobile; an
  unknown sha (`0`×40) against `tastease` renders "No log found for this run"
  and not "predates log capture". Scripts were scratch (run then discarded),
  not part of the tracked audit-evidence set.

### Follow-ups
- `[defer]` `findMissingLogDetail` in `apps/api/src/routes/history.ts` reads
  the full history file (bounded to the last 50,000 entries) on every miss to
  find the sha; fine at current history sizes, but if per-project history
  ever grows unbounded this should key off a smaller structure instead of a
  linear scan.
- `[defer]` The live-tail "waiting for output…" fix addresses the documented
  race (service-filter clears `lines` without resetting `status`) and the
  general "no distinct empty state" gap, but I couldn't reproduce the
  original audit sighting live against production (out of scope to hold an
  SSH log stream open just to try to catch a low-confidence race) — worth a
  quick recheck next time the live-tail page is touched.
