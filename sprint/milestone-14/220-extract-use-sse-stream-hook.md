# Extract generic useSseStream hook and migrate 7 components
**Difficulty:** 3

## Goal
One shared `useSseStream` hook in `apps/dashboard/src/lib/` owns the fetch → `getReader()` → SSE-frame parsing loop. All 7 components that currently hand-roll it delegate to the hook, keeping only their event-shape handling. Zero behavior change.

## Reason
2026-07-11 audit: the SSE reader loop is duplicated across 7 components — the single biggest duplication family left in the repo and the main thing holding frontend architecture at B. A parse bug (e.g. the `\n\n` frame-split or the `data:` prefix handling) fixed in one panel today stays broken in six others. One hook makes the loop testable once and shrinks four of the audit's "trending large" files as a side effect.

## Context
- Reference implementation: `apps/dashboard/src/components/deploy-panel.tsx:19-60` (`useDeploySse`). The loop: `fetch(url, { method: 'POST', signal })` → `res.body!.getReader()` → `TextDecoder` accumulate → split on `'\n\n'` → find line starting `data:` → `JSON.parse(data.slice(5).trim())` → dispatch by `ev.type` → cleanup via `AbortController` on unmount.
- The 7 duplicate sites (each has its own `useXxxSse` or inline effect around these lines):
  - `apps/dashboard/src/components/deploy-panel.tsx:28`
  - `apps/dashboard/src/components/rollback-panel.tsx:37`
  - `apps/dashboard/src/components/secrets-sync-panel.tsx:39`
  - `apps/dashboard/src/components/destroy-modal.tsx:29`
  - `apps/dashboard/src/components/detail/container-log-viewer.tsx:26`
  - `apps/dashboard/src/components/ops/confirm-card.tsx:27`
  - `apps/dashboard/src/components/provision/step-running.tsx:60`
- Read each site before designing the hook API — they differ in: HTTP method (most POST; check each), whether they run immediately or on a trigger (destroy-modal likely starts on confirm), and event shapes (each defines its own `SseEvent` union). Suggested API: `useSseStream<T>(url, { method, enabled, onEvent: (ev: T) => void })` where the caller keeps its own `useState` and maps events in `onEvent`. Adjust after reading — the caller-owns-state design is the constraint; the exact signature is yours.
- Auth: check whether these fetches attach auth headers via `lib/api-auth.ts` — if any site does, the hook must support it uniformly.
- Some callers add unique behavior in the catch/done paths (e.g. deploy-panel colors backup events, sets exit code). That mapping stays in the caller.
- Test conventions: vitest + testing-library, `renderHook`; see `lib/use-backup-polling.test.ts` (sprint 218) for fake-timer/async patterns. For the stream, mock `fetch` returning a `ReadableStream` and assert frame parsing (multi-frame chunk, frame split across chunks, non-`data:` lines ignored, abort on unmount).

## Tasks
1. Read all 7 sites; table their differences (method, trigger, event union, auth, completion handling).
2. Write `apps/dashboard/src/lib/use-sse-stream.ts` covering the union of needs; caller keeps state.
3. Write `use-sse-stream.test.ts`: happy-path multi-event parse, chunk-boundary frame split, malformed frame skipped, abort/cleanup on unmount, `enabled: false` does not fetch.
4. Migrate all 7 components; delete their local reader loops. Each caller's diff should be mostly deletions.
5. Run `pnpm nx test dashboard`, `pnpm nx typecheck dashboard`, `pnpm nx lint dashboard`.

## Files involved
- new file: `apps/dashboard/src/lib/use-sse-stream.ts` + `use-sse-stream.test.ts`
- `apps/dashboard/src/components/deploy-panel.tsx` — delete `useDeploySse` loop body
- `apps/dashboard/src/components/rollback-panel.tsx` — same
- `apps/dashboard/src/components/secrets-sync-panel.tsx` — same
- `apps/dashboard/src/components/destroy-modal.tsx` — same
- `apps/dashboard/src/components/detail/container-log-viewer.tsx` — same
- `apps/dashboard/src/components/ops/confirm-card.tsx` — same
- `apps/dashboard/src/components/provision/step-running.tsx` — same

## Acceptance criteria
- [x] No component contains its own `getReader()` loop; all 7 use the shared hook
- [x] Hook unit-tested including chunk-boundary and cleanup cases
- [x] Zero behavior change in each panel (same events produce same UI state)
- [x] Tests pass, typecheck clean, lint clean

## Completed

**Date:** 2026-07-11

### Summary
Created `apps/dashboard/src/lib/use-sse-stream.ts` — a generic hook that owns the `fetch → getReader() → TextDecoder → \n\n-split → data: parse` loop. Callers own their own state and pass an `onEvent` callback; the hook handles abort on unmount and all the streaming boilerplate. An `onEventRef` ref prevents the callback from being a reactive dependency, so the effect only re-runs when `url`, `method`, `enabled`, or `body` changes.

All 7 components were migrated: deploy-panel, rollback-panel, secrets-sync-panel, destroy-modal, container-log-viewer, ops/confirm-card, and provision/step-running. container-log-viewer keeps a reset `useEffect` before the hook call to clear stale lines when the URL changes (preserving existing behavior). destroy-modal and provision/step-running dropped their `useEffect`/`useState` imports that were only used for the loop.

### Files changed
- (new) `apps/dashboard/src/lib/use-sse-stream.ts` — shared SSE streaming hook
- (new) `apps/dashboard/src/lib/use-sse-stream.test.ts` — 8 tests: happy-path, chunk-boundary split, malformed frame skip, non-data line ignored, unmount abort, enabled=false, method/headers/body pass-through
- `apps/dashboard/src/components/deploy-panel.tsx` — deleted local reader loop, delegates to useSseStream
- `apps/dashboard/src/components/rollback-panel.tsx` — same
- `apps/dashboard/src/components/secrets-sync-panel.tsx` — same (was inline effect)
- `apps/dashboard/src/components/destroy-modal.tsx` — same; removed useEffect import
- `apps/dashboard/src/components/detail/container-log-viewer.tsx` — same; GET + authHeaders; reset effect before hook
- `apps/dashboard/src/components/ops/confirm-card.tsx` — same; removed useEffect import
- `apps/dashboard/src/components/provision/step-running.tsx` — same (was inline effect); removed useEffect import

### Verification
- `pnpm nx test dashboard`: 145/145 pass (8 new in use-sse-stream.test.ts)
- `pnpm nx typecheck dashboard`: clean
- `pnpm nx lint dashboard`: clean

### Follow-ups
- `[defer]` container-log-viewer still re-fetches when url changes but state reset and stream re-run happen in separate effects (one useEffect for reset, one inside useSseStream); ordering is correct in React 18 but could be collapsed into a key-based remount if component-level isolation ever becomes a concern

## Out of scope
- Changing any SSE event shapes or server-side SSE writers
- Slimming these components beyond the loop removal (sprint 224 handles use-ops-chat/container-row/settings-panel)
