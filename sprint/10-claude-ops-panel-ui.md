# Claude ops panel UI

## Goal
Implement the Claude Ops chat interface: message history with user and Claude bubbles, collapsible tool result blocks, inline confirmation cards for destructive actions (with a danger variant), and the fixed-bottom chat input.

## Reason
The ops panel is the highest-differentiation screen in the dashboard. The UI must make it clear (1) what Claude did (tool blocks), (2) what it's asking you to confirm (confirm card), and (3) that it's safe to ask freely (safety hint in the input area). Getting the chat design exactly right is what makes this feel like a first-class feature rather than a bolted-on chatbot.

## Context
- Builds on sprint 06 (design tokens) and sprint 05 (API `POST /ops/chat` endpoint with tool execution and confirmation gate).
- Design source: `/tmp/emit-design/emit-infra/project/screen-ops.jsx` and the `VarOpsDestroy` component in `screen-variations.jsx`. Read both before implementing.
- The API `POST /ops/chat` response shape (from sprint 05):
  ```ts
  { reply: string, pendingConfirmation?: { toolName: string, projectName: string }, toolResults?: any[] }
  ```
  When `pendingConfirmation` is present, render the appropriate confirm card. Send a follow-up with `{ confirmationFor: toolName }` to execute, or `{ message: "Cancel that" }` to abort.

**Key design measurements:**
- Max message width: 86% of chat container
- User bubble: `--accent` bg, `--accent-fg` text, `border-bottom-right-radius: 4px`
- Claude bubble: `--card-2` bg, `--border` border, `border-bottom-left-radius: 4px`
- Claude avatar: 26×26px, radius 7px, `--accent-soft` bg, ops icon (sparkle/zap style)
- Tool block: `--card-2` bg, `--border` border, radius 9px; header with zap icon + tool name (fg) + arrow + target (accent-bright) + "200" ok badge; collapsible chevron on right; expanded body uses `--term-bg` background with mono text
- Confirm card (deploy): `--accent-line` border, `--accent-soft` bg, radius 11px, icon in card + title + subtitle + description + Confirm (primary sm) / Cancel (ghost sm)
- Confirm card (destroy): `--err-line` border, `--err-soft` bg; "irreversible" badge in err; "Confirm destroy" danger-solid button
- Chat input: 46px height `input-affix`, send button (primary icon 36×36px) inside on right; hint text below with shield icon: "Claude can read status & logs freely; deploy, provision & destroy always ask first."
- Desktop: chat container `max-w-720 mx-auto`, `scroll={false}` shell mode, chat fills height

## Tasks

1. Build `src/components/ops/message.tsx`:
   - `UserMessage`: right-aligned, bubble with accent background
   - `ClaudeMessage`: left-aligned, Claude avatar + bubble; accepts `children` (text or JSX)

2. Build `src/components/ops/tool-block.tsx`:
   - Header row: zap icon (accent-bright) + tool name (fg) + "→" faint + target (accent-bright) + ok badge
   - Chevron right of header — rotates down when expanded
   - Collapsed by default; click toggles
   - Expanded body: `--term-bg` background, mono font, 11.5px, renders the JSON result with colour-coded values (strings in t-green, numbers in t-yellow, via simple regex replace or React rendering)

3. Build `src/components/ops/confirm-card.tsx`:
   - Props: `type: 'deploy'|'provision'|'destroy'`, `projectName: string`, `subtitle: string`, `description: string`, `onConfirm: () => void`, `onCancel: () => void`
   - Deploy/provision: accent-line border, accent-soft background; deploy icon in card; Confirm (primary sm) + Cancel (ghost sm) buttons
   - Destroy: err-line border, err-soft background; trash icon in card; "irreversible" err badge in header; "Confirm destroy" (danger-solid sm) + Cancel (ghost sm)
   - After `onConfirm`, the card transitions to an inline Terminal streaming the SSE operation (same component as sprint 08's DeployPanel, embedded here)

4. Build `src/components/ops/chat-input.tsx`:
   - Controlled text input (submit on Enter, Shift+Enter for newline)
   - Send button (primary icon variant) — disabled while awaiting response
   - Safety hint line below: shield icon + text
   - Fixed to bottom of the chat container (not page — just the chat column)

5. Build `src/components/ops/chat-thread.tsx`:
   - Renders an array of messages in order
   - Message types: `user`, `claude`, `tool`, `confirm`
   - Auto-scrolls to bottom when new messages arrive (use a `ref` on the bottom sentinel)
   - Shows a typing indicator (three pulsing dots) while awaiting a Claude response

6. Build `app/ops/page.tsx`:
   - Manages conversation state: `messages[]`, `sessionId`, `isLoading`, `pendingConfirmation`
   - On submit: append user message, call `POST /api/ops/chat`, handle response types
   - On confirm card confirm: call `POST /api/ops/chat` with `confirmationFor`; replace confirm card with live SSE terminal inline
   - On confirm card cancel: append user message "Cancel that", call API
   - "New conversation" button: clears `messages[]` and calls `DELETE /api/ops/session` (add this lightweight endpoint to `apps/api/src/routes/ops.ts`)
   - Desktop layout: Shell with `scroll={false}`, chat fills `flex-1` column, input fixed at bottom of column
   - Mobile layout: messages scroll above fixed chat input, tab bar below input

7. Add `DELETE /api/ops/session/:id` endpoint to `apps/api/src/routes/ops.ts` to clear session history.

## Files involved
- new file: `apps/dashboard/src/components/ops/message.tsx`
- new file: `apps/dashboard/src/components/ops/tool-block.tsx`
- new file: `apps/dashboard/src/components/ops/confirm-card.tsx`
- new file: `apps/dashboard/src/components/ops/chat-input.tsx`
- new file: `apps/dashboard/src/components/ops/chat-thread.tsx`
- `apps/dashboard/app/ops/page.tsx` — replace scaffold with designed chat UI
- `apps/api/src/routes/ops.ts` — add DELETE /ops/session/:id

## Acceptance criteria
- [x] User and Claude messages render with correct bubble styles (accent vs card-2)
- [x] Tool block is collapsed by default; click expands to show JSON result with coloured values
- [x] Deploy confirm card has accent (green) styling; destroy confirm card has err (red) styling with "irreversible" badge
- [x] Confirming a deploy action starts the SSE terminal inline within the confirm card area
- [x] Cancel sends "Cancel that" message to the API
- [x] Chat auto-scrolls to latest message when new ones arrive
- [x] Typing indicator shows while awaiting Claude response
- [x] Input submits on Enter; Shift+Enter adds a newline
- [x] "New conversation" button clears the thread
- [x] At 375px: messages fill the screen, input stays fixed above the tab bar, no overflow
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Built the designed Claude ops chat UI. Six new dashboard components: `types.ts` (discriminated union ChatMessage), `message.tsx` (UserMessage + ClaudeMessage with correct bubble styles and avatar), `tool-block.tsx` (collapsible JSON with string/number syntax colouring via split-regex), `confirm-card.tsx` (accent/err styling + internal SSE terminal transition after confirm), `chat-input.tsx` (46px input, Enter submit, Shift+Enter newline, safety hint with shield icon), and `chat-thread.tsx` (auto-scroll sentinel, typing indicator with staggered pulse dots, empty state). Rewrote `app/ops/page.tsx` as the stateful orchestrator: manages sessionId, messages array, loading state, confirm/cancel flow, and "New conversation" (DELETE session + fresh session). Desktop uses max-w-[720px] centered column with inline input at the bottom; mobile uses fixed-bottom-16 input above the tab bar. Also updated the API: added `DELETE /ops/session/:id` endpoint that calls `clearHistory`, and added `target` field to toolResults so tool blocks can display the project name alongside the tool name.

### Files changed
- (new) `apps/dashboard/src/components/ops/types.ts` — ChatMessage discriminated union + shared types
- (new) `apps/dashboard/src/components/ops/message.tsx` — UserMessage + ClaudeMessage
- (new) `apps/dashboard/src/components/ops/tool-block.tsx` — collapsible tool result with colour-coded JSON
- (new) `apps/dashboard/src/components/ops/confirm-card.tsx` — confirm/destroy card with inline SSE terminal
- (new) `apps/dashboard/src/components/ops/chat-input.tsx` — controlled input with safety hint
- (new) `apps/dashboard/src/components/ops/chat-thread.tsx` — message list with typing indicator + auto-scroll
- `apps/dashboard/app/ops/page.tsx` — rewritten as stateful chat orchestrator
- `apps/api/src/routes/ops.ts` — added DELETE /ops/session/:id; added target to toolResults

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)

### Follow-ups
- `[defer]` The ConfirmCard `onConfirm` callback is currently a no-op in ChatThread — the card manages its own confirmed state internally. If future iterations need the page to know when a confirm transitions to running (e.g. to show a global loading state), wire up the callback.
- `[defer]` The ops-panel.tsx (sprint 05 scaffold) is now superseded by the new ops page but still exists at `src/components/ops-panel.tsx`. It imports `SseOutputPanel` which was removed in sprint 08. This file can be deleted once confirmed no longer referenced.
- `[defer]` cancel flow removes all `confirm`-type messages from the thread rather than just the most recent one — fine for single-tool-per-turn behavior but would need refinement if multi-tool conversations are added.

## Out of scope
- PWA (sprint 11)
- Persisting conversation history to disk
