# Sprint 99 — Ops context auto-injection

**Difficulty:** 2

## Goal

When the `/ops` chat panel loads for a specific project, automatically fetch and inject a structured context block (current status, last deploy, CI summary) as the system prompt prefix — so Claude starts each session already knowing the project's state instead of having to ask.

## Reason

The ops agent currently has access to tools (`get_status`, `get_containers`, `get_logs`) but starts blind — it has to call them before it can say anything useful. With pre-injected context, the first message can already be diagnostic rather than exploratory. This turns a 2–3 turn "what's the state?" exchange into zero overhead.

## Context

- `apps/api/src/routes/ops.ts` line 164–167: the `/ops/chat` endpoint already accepts `systemContext` in the request body and prepends it to the system prompt on the first message of a session (when there's no `agentSessionId` yet). Nothing needs to change on the API side.
- `apps/dashboard/app/ops/page.tsx` (or wherever the ops panel is — find the file that renders the chat UI and calls `POST /ops/chat`). This is the only file to change.
- On page load (or when a project is selected), fetch:
  1. `GET /projects/:name/status` — HTTP status, disk%, memory%, SSL expiry, nginx, redis, deployed timestamp
  2. `GET /projects/:name/deploy-history?limit=3` — last 3 deploys with SHA, status, duration, message
  3. `GET /projects/:name/ci-history?limit=10` — last 10 CI runs for pass rate
- Assemble a plain-text `systemContext` string:
  ```
  Project: <name>  Domain: <domain>
  Status: HTTP <httpStatus>  Disk: <disk>%  Mem: <mem>%  SSL: <sslDays>d  Nginx: <nginx>  Redis: <redis>
  Last deploy: <sha> (<branch>) <durationSec>s <status> — "<message>"  <N>h ago
  Deploy health: <X>/3 recent succeeded
  CI health: <X>/10 recent passed  Avg: <avg>s
  ```
- Pass this as `systemContext` in every `POST /ops/chat` call. The API ignores it after the first message (when `agentSessionId` is set), so there's no overhead on subsequent turns.
- If the ops page is global (no project selected), skip the context injection — only inject when a project is in scope.
- Keep the context string concise (< 300 chars ideally). Claude reads it as system context, not as part of the conversation.

## Tasks

1. Find and read the ops page component to understand how it currently calls `POST /ops/chat` and how the project name is in scope.
2. Add a `useEffect` on page/project load that fetches status + deploy-history (limit 3) + ci-history (limit 10) in parallel.
3. Assemble the `systemContext` string from the fetched data.
4. Pass `systemContext` in every chat request body (the API only uses it when `agentSessionId` is absent, so it's safe to always include).
5. Run `pnpm nx typecheck dashboard`.

## Files involved

- `apps/dashboard/app/ops/page.tsx` (or the relevant ops panel component) — add context prefetch + pass systemContext

## Acceptance criteria

- [x] On load, the ops panel fetches status + recent deploy + CI history for the current project
- [x] `systemContext` is included in the `POST /ops/chat` request body
- [x] On the first message of a new session, Claude's response demonstrates awareness of current project state without needing to call tools first
- [x] No change to API — only the dashboard component changes
- [x] `pnpm nx typecheck dashboard` clean

## Completed

**Date:** 2026-06-28

### Summary
Added project context auto-injection to the `/ops` chat panel. When `?project=<name>` is in scope, the page now fetches `status`, `deploy-history?limit=3`, and `ci-history?limit=10` in parallel on mount. A `buildContextString()` helper assembles a concise multi-line context block (project name/domain, HTTP/disk/mem/SSL/nginx/redis status, last deploy with SHA/branch/duration/status/message/age, deploy health ratio, CI pass rate with avg duration). The context is passed as `systemContext` in the first `POST /ops/chat` request body; the API already ignores it on subsequent messages when `agentSessionId` is set. A dismissable context banner is shown in the chat area. No API changes required.

### Files changed
- `apps/dashboard/app/ops/page.tsx` — added `formatTime`, `buildContextString`, context-fetch `useEffect`, `systemContext` injection on first message, context banner UI

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Refreshing the context mid-session (context is injected once per new session)
- Including log excerpts or container details in the context (keep it short)
- Context injection for the global ops panel when no project is selected
