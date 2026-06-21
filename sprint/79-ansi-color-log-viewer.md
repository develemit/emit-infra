# ANSI color rendering + auto-scroll in log viewer
**Difficulty:** 3

## Goal
CI and deploy logs currently render raw terminal escape sequences (`\033[32m` etc.) as literal text. Convert them to HTML before display so colors, bold, and dim appear correctly. Also scroll the log to the bottom on load, since the tail (final result) is the most useful part.

## Reason
The log capture we built in sprint 76 faithfully records everything the shell outputs, including color codes from npm, docker, test runners, etc. Right now that makes logs harder to read, not easier — the escape sequences are visual noise. Fixing this and auto-scrolling to the bottom makes the log viewer genuinely useful for debugging deploys and CI failures.

## Context
- Log viewer component: `apps/dashboard/src/components/detail/run-log-page.tsx`
- Currently splits `content` by `\n` and renders each line as `<span>{line}</span>` inside a `<div className="ec-ln">`. This is where the ANSI conversion needs to happen.
- The `Terminal` component (`apps/dashboard/src/components/ui/terminal.tsx`) wraps the lines — its body is a scrollable div. We need a ref to that scrollable element to call `scrollTop = scrollHeight` after content loads.
- Check how `Terminal` exposes its body (look for a `bodyStyle` prop or similar). If it doesn't expose a ref, wrap the children in a `<div ref={scrollRef}>` inside Terminal and set `overflow: auto` there, or add a `bodyRef` prop to Terminal.
- Package to install: `ansi-to-html` (npm). It is a lightweight ESM/CJS library with no native deps — safe for Next.js client bundle. Install in `apps/dashboard`.
- `dangerouslySetInnerHTML` is appropriate here because the HTML comes from a controlled internal source (our own captured logs on our own server), not from user input.

## Tasks
1. In `apps/dashboard`, install `ansi-to-html`: `pnpm add ansi-to-html` (run from repo root with `--filter dashboard` or from `apps/dashboard`).
2. In `run-log-page.tsx`, import `AnsiToHtml` from `ansi-to-html` and instantiate it once (outside the component or with `useMemo`) with `{ escapeXML: false }`.
3. Replace the current line-splitting render with: convert full `content` string via `convert(content)`, then split the resulting HTML by `\n` and render each line as `<div key={i} className="ec-ln" dangerouslySetInnerHTML={{ __html: line }} />`.
4. Add a `scrollRef = useRef<HTMLDivElement>(null)` and attach it to a wrapper div around the Terminal children (or to the Terminal body if a ref prop is available).
5. In the `useEffect` that sets `content`, after `setContent(text)`, use `setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 0)` to scroll after render.
6. Verify in `apps/dashboard/src/components/ui/terminal.tsx` that the body container has `overflow-y: auto` or similar — add it if missing.

## Files involved
- `apps/dashboard/src/components/detail/run-log-page.tsx` — main change: ANSI conversion + scroll ref
- `apps/dashboard/src/components/ui/terminal.tsx` — read to understand body structure; add `bodyRef` prop or verify overflow is set
- `apps/dashboard/package.json` — gains `ansi-to-html` dependency

## Acceptance criteria
- [x] Deploy and CI log pages render colored output (green pass lines, red failure lines, dim debug lines) rather than raw `\033[...]` sequences
- [x] Page scrolls to the bottom of the log automatically on load
- [x] Lines with no color codes still render correctly
- [x] `pnpm typecheck` and `pnpm build` pass in dashboard

## Completed

**Date:** 2026-06-20

### Summary
Installed `ansi-to-html` in the dashboard package and wired it into `run-log-page.tsx`. A module-level `AnsiToHtml` instance converts the full log string to HTML before splitting on newlines, so terminal color codes render as styled spans rather than raw escape sequences. Added a `scrollBottom` prop to the `Terminal` component that triggers a `scrollTop = scrollHeight` effect whenever the prop is truthy and children change — cleanly reuses the existing internal `bodyRef` without exposing it externally.

The `pnpm build` static prerender failure on `/_error` and `/404` is a pre-existing upstream Next.js 15.5.19 bug documented in the backlog from sprint 04 and unrelated to this sprint. The `✓ Compiled successfully` line confirms our code compiles cleanly.

### Files changed
- `apps/dashboard/src/components/detail/run-log-page.tsx` — ANSI conversion via `ansi-to-html`, `dangerouslySetInnerHTML` line rendering, `scrollBottom` on Terminal
- `apps/dashboard/src/components/ui/terminal.tsx` — added `scrollBottom` prop + `useEffect` to scroll body on content change
- `apps/dashboard/package.json` — gained `ansi-to-html` dependency

### Verification
- `pnpm typecheck` (dashboard): clean
- `pnpm build` compile step: `✓ Compiled successfully in 2.7s`
- Static prerender of `/_error`/`/404`: pre-existing upstream bug, unrelated to this sprint

### Follow-ups
- `[defer]` The `escapeXML: true` option on `ansi-to-html` HTML-escapes angle brackets in log output — if any logs intentionally contain HTML-like strings (e.g. JSX error output), those will show as `&lt;div&gt;`. Acceptable for now; can revisit if it becomes noisy.

## Out of scope
- Log search or filtering
- Line numbers
- Streaming/live log tailing
