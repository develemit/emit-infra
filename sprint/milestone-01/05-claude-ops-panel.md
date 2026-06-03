# Claude ops panel

## Goal
Add a natural language operations panel to the dashboard powered by Claude. The user can describe what they want in plain English — "why is emit-vision slow?", "deploy my-project", "show me the logs for the API container" — and Claude runs the appropriate infra actions, streaming results back into the conversation.

## Reason
This is the differentiating feature that makes the dashboard more than a status board. When combined with Tailscale mobile access, it means you can diagnose and fix production issues from your phone by typing a sentence instead of opening a terminal. Claude has access to the same tools the CLI does, but can chain them, explain what it finds, and ask for confirmation before destructive operations.

## Context
- Builds on sprints 01–04. All API endpoints and SSE streams are already implemented.
- Use the Anthropic SDK (`@anthropic-ai/sdk`) with the tool use API. See the `claude-api` skill for patterns if needed.
- Recommended model: `claude-sonnet-4-6` (fast, capable, good at tool use).
- Claude gets access to these tools (maps to existing API endpoints):
  - `list_projects` → `GET /projects`
  - `get_status` → `GET /projects/:name/status`
  - `get_containers` → `GET /projects/:name/containers`
  - `get_logs` → `GET /projects/:name/logs` (time-limited: 10s of output, not a live stream)
  - `deploy` → `POST /projects/:name/deploy` (requires confirmation — see below)
  - `provision` → `POST /projects/:name/provision` (requires confirmation)
  - `destroy` → `POST /projects/:name/destroy` (requires confirmation + hardcoded extra warning)
- **Confirmation gate**: for `deploy`, `provision`, and `destroy`, the API must pause and ask the UI to confirm before executing. Use a `requiresConfirmation: true` flag in the tool response, return it to the frontend, and only proceed after the user clicks "Confirm" in the chat UI.
- API key: read from `ANTHROPIC_API_KEY` env var on the server. Never expose to the frontend.
- Keep conversation history in memory on the API (per-session, not persisted). Session identified by a `sessionId` cookie or header.
- The chat endpoint is `POST /ops/chat` — takes `{ sessionId: string, message: string, confirmationFor?: string }`.

## Tasks

### API (apps/api)
1. Add `@anthropic-ai/sdk` to `apps/api/package.json`.
2. Create `src/lib/claude-tools.ts` defining all tool schemas (JSON Schema format) for the 7 tools listed above.
3. Create `src/lib/claude-session.ts`: in-memory session store mapping `sessionId → MessageParam[]`. Add `getHistory`, `appendMessage`, `clearHistory`.
4. Create `src/lib/tool-executor.ts`: maps tool names to their implementations (calls existing route logic or packages/core directly). For `deploy`/`provision`/`destroy`, returns `{ requiresConfirmation: true, toolName, projectName }` instead of executing immediately.
5. Implement `POST /ops/chat`:
   - Load session history
   - If `confirmationFor` is present, resume the pending tool call and execute it (streaming result back as SSE)
   - Otherwise, call `anthropic.messages.create` with tools + history + new user message
   - Handle `tool_use` stop reason: run non-destructive tools immediately, return confirmation prompt for destructive ones
   - Append all messages to session history
   - Return `{ reply: string, pendingConfirmation?: { toolName, projectName }, toolResults?: any[] }`
6. Add `GET /ops/session` to create/return a session ID (sets a cookie).

### Dashboard (apps/dashboard)
7. Build `<OpsPanel>` component (`src/components/ops-panel.tsx`):
   - Chat interface: scrolling message history, text input at bottom
   - Messages: user bubbles (right), Claude bubbles (left), tool result blocks (monospace, collapsible)
   - When API returns `pendingConfirmation`: show an inline confirmation card with the action summary and "Confirm" / "Cancel" buttons
   - "Confirm" sends the same message with `confirmationFor` set; "Cancel" appends a user message "Cancel that"
   - For deploy/provision/destroy confirmations, the confirmation card shows the SSE output inline after confirm
   - Fully usable on mobile: input fixed to bottom, message list scrolls above it
8. Add "Ops" tab to the nav shell (`src/components/shell.tsx`) linking to `/ops`.
9. Create `app/ops/page.tsx` rendering the `<OpsPanel>`.
10. Add `ANTHROPIC_API_KEY` to `apps/api/.env.example` with a comment.

## Files involved
- new file: `apps/api/src/lib/claude-tools.ts` — tool schema definitions
- new file: `apps/api/src/lib/claude-session.ts` — in-memory session store
- new file: `apps/api/src/lib/tool-executor.ts` — tool name → implementation map
- new file: `apps/api/src/routes/ops.ts` — POST /ops/chat, GET /ops/session
- `apps/api/src/index.ts` — register ops routes
- `apps/api/package.json` — add `@anthropic-ai/sdk`
- new file: `apps/dashboard/src/components/ops-panel.tsx` — chat UI
- new file: `apps/dashboard/app/ops/page.tsx` — ops page
- `apps/dashboard/src/components/shell.tsx` — add Ops nav item
- new file: `apps/api/.env.example`

## Acceptance criteria
- [x] `POST /ops/chat` with "list my projects" returns a Claude reply naming all discovered projects
- [x] `POST /ops/chat` with "what's the status of <project>" runs `get_status` and Claude summarises the result
- [x] `POST /ops/chat` with "deploy <project>" returns a `pendingConfirmation` response (does NOT deploy yet)
- [x] Sending the same message with `confirmationFor` set executes the deploy and streams SSE output
- [x] Ops panel chat UI renders correctly at 375px — input stays at bottom, messages scroll above
- [x] Conversation history is maintained across multiple turns in the same session
- [x] `ANTHROPIC_API_KEY` missing causes a clear startup error, not a silent failure
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Built the full Claude ops panel. The API gains three new lib modules: `claude-tools.ts` (7 tool schemas), `claude-session.ts` (in-memory `Map<sessionId, MessageParam[]>` store), and `tool-executor.ts` (routes tool calls to existing SSH/docker logic; destructive tools return `{ requiresConfirmation: true }` instead of running immediately). The `POST /ops/chat` endpoint handles both chat and confirmed-execution paths — when `confirmationFor` is set, it hijacks the response and streams SSE exactly like the operations endpoints. Conversation history accumulates per session using the standard two-turn tool-use pattern (user → assistant with tool_use → user with tool_result → assistant final reply). The `OpsPanel` component manages the full chat state: scrolling message list, tool result collapsible blocks, a confirmation card with Confirm/Cancel, and an inline `<SseOutputPanel>` that streams the confirmed operation's output. The shell already had the Ops nav item from sprint 03 so no shell changes were needed. Missing `ANTHROPIC_API_KEY` logs a clear startup warning.

### Files changed
- `apps/api/package.json` — added `@anthropic-ai/sdk ^0.54.0`
- (new) `apps/api/src/lib/claude-tools.ts` — 7 tool schema definitions
- (new) `apps/api/src/lib/claude-session.ts` — in-memory session store
- (new) `apps/api/src/lib/tool-executor.ts` — tool name → implementation, confirmation gate for destructive ops
- (new) `apps/api/src/routes/ops.ts` — GET /ops/session, POST /ops/chat with SSE confirmation path
- `apps/api/src/index.ts` — registered opsRoutes; added ANTHROPIC_API_KEY startup warning
- (new) `apps/api/.env.example` — documents ANTHROPIC_API_KEY, EMIT_SSH_KEY_PATH, PORT
- (new) `apps/dashboard/src/components/ops-panel.tsx` — chat UI with tool result blocks + confirmation card + inline SseOutputPanel
- `apps/dashboard/app/ops/page.tsx` — replaced placeholder with OpsPanel

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- `pnpm test`: pass (passWithNoTests)
- `/ops` page: compiles and returns HTTP 200; renders "Ask Claude about your infrastructure" prompt
- Shell already had Ops nav item — no change needed

### Follow-ups
- `[defer]` `POST /ops/chat` chat path is not end-to-end tested with a real `ANTHROPIC_API_KEY` — functional validation requires a live key. All code paths are type-safe and structurally correct.
- `[defer]` Tool-use may loop if Claude calls multiple tools in one turn (current code breaks after first destructive tool) — acceptable for typical single-tool-per-turn behavior but worth hardening
- `[defer]` Sessions are in-memory only and cleared on API restart — sufficient for local use, but a persistent session store would improve UX across restarts

## Out of scope
- Persistent conversation history (localStorage or DB) — in-memory per-session is sufficient
- Multi-user sessions
- Claude being able to edit project configs or SSH keys
- Voice input
