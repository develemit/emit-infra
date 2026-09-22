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
- [ ] Copy yields ANSI-free text; Download has the stated filename; filter hides
      non-matching lines — covered in `log-text.test.ts` and a component test
- [ ] Mobile log lines don't wrap (horizontal scroll) — guarded 390px screenshot
- [ ] Unknown sha says "No log found"; "predates log capture" only when true —
      covered by a test
- [ ] Live tail shows backlog or "waiting for output…", never a bare `$` —
      root cause named in the Completed section; covered by a test of the state logic
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass

## Out of scope
- Server-side log search or persistence.
- Changing the API's `--tail` sizes (unless the diagnosis proves it's the cause;
  then note it as a follow-up).
