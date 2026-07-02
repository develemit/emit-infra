# Sprint 110 — Extract `useOpsChat()` hook

**Difficulty:** 3

## Goal

Extract chat session state and message management from `apps/dashboard/app/ops/page.tsx` (currently ~277 lines) into a `useOpsChat()` custom hook, leaving the page as a thin render shell.

## Reason

`ops/page.tsx` mixes SSE stream management, session lifecycle (create/delete), message history, context injection, and rendering in one component. The chat state machine is complex (pending state, streaming tokens, confirmation cards, error recovery) and currently untestable in isolation. Extracting it to a hook makes the logic unit-testable and brings the page file under the 300-line limit.

## Context

- Read `apps/dashboard/app/ops/page.tsx` fully before touching anything. The hook needs to own: session creation/deletion, the `messages` array, `pending`/`streaming` state, `statusContext` and the context-fetch effect, the `sendMessage` function that POSTs to `/ops/chat`, and the SSE streaming logic. The `confirmationFor` flow should also live in the hook.
- The page was last modified in sprint 99 (ops context injection) — the `statusContext`, `buildContextString()`, and the `useEffect` that fetches project status are all part of the state to extract.
- The `contextProject` (derived from `useSearchParams`) stays in the page — it's a routing concern. Pass it into `useOpsChat(contextProject)` as a param.
- Place the hook in `apps/dashboard/src/lib/use-ops-chat.ts`. Return value should include: `{ messages, pending, streaming, sendMessage, resetSession, statusContext }`.
- After extraction, the page should contain: `useSearchParams()` for `contextProject`, the `useOpsChat(contextProject)` call, and the JSX. No chat-related `useState` or `useEffect` in the page.
- Preserve exact existing behavior — this is a pure refactor.

## Tasks

1. Read `apps/dashboard/app/ops/page.tsx` fully. Note every useState, useEffect, and function defined in the component.
2. Create `apps/dashboard/src/lib/use-ops-chat.ts`. Move all chat/session/context state and logic into `useOpsChat(contextProject: string | null)`.
3. Update `apps/dashboard/app/ops/page.tsx` to call `useOpsChat` and destructure its return. Remove all the moved state/logic.
4. Verify the page file is under 150 lines after extraction.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any type errors.

## Files involved

- (new) `apps/dashboard/src/lib/use-ops-chat.ts` — owns session, messages, streaming, context injection
- `apps/dashboard/app/ops/page.tsx` — reduced to render shell

## Acceptance criteria

- [x] `use-ops-chat.ts` created; owns all session/message/streaming/context state from the page
- [x] `ops/page.tsx` has no chat-related `useState` or `useEffect` calls
- [x] `ops/page.tsx` is under 150 lines after extraction
- [x] Existing behavior preserved: session creation, message streaming, confirmation flow, context injection, "New conversation" reset
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Created `apps/dashboard/src/lib/use-ops-chat.ts` owning all chat state: `sessionId`, `messages`, `loading`, `resetting`, `contextProject`, `statusContext`, `contextBuildLabel`. Both useEffects (session init, context build) and all functions (`submit`, `handleCancel`, `handleNewConversation`, `push`) moved into the hook. The three pure helpers (`genId`, `getConfirmText`, `formatTime`, `buildContextString`) also moved into the hook file. Exposed `clearContext()` instead of raw setters so the page doesn't need to call two setters for the banner dismiss.

The page was rewritten to 82 lines: `useSearchParams()` → pass `projectName` to `useOpsChat()` → destructure → JSX only. No useState, useEffect, or useCallback remain in the page.

### Files changed
- (new) `apps/dashboard/src/lib/use-ops-chat.ts` — session/message/streaming/context state + helpers
- `apps/dashboard/app/ops/page.tsx` — rewritten as thin render shell (285 → 82 lines)

### Verification
- Page line count: 82 (under 150)
- No useState/useEffect in page: confirmed
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `use-ops-chat.ts` has no unit tests — follow-up test sprint can cover submit/cancel flows

## Out of scope

- Tests for the hook (follow-up sprint)
- Changing the SSE streaming protocol or chat API contract
- Adding new chat features
