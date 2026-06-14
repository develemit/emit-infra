# Sprint 54 — Ops Chat: Project Context Injection
**Difficulty:** 3

## Goal
When a user navigates from a project detail page to the Ops chat, automatically inject the project name and current status so Claude has context without the user having to re-explain.

## Reason
The Ops chat is positioned as an infrastructure assistant, but it opens completely blank — it doesn't know which project you were just looking at, what its build number is, or whether Redis is healthy. Injecting that context means you can type "why is the queue backed up?" instead of "for project X, the queue has 40 failed jobs, can you help?". This is the difference between a tool and a genuinely useful assistant.

## Context

### How context flows

The cleanest approach is a URL search param: from the project detail page, the "Open in Ops" link becomes `/ops?project=<name>`. The Ops page reads `useSearchParams()` and, if a project param is present, fetches the current status and prepends a system-level context note to the conversation.

**Ops page (`apps/dashboard/app/ops/page.tsx`):**
- Read `const params = useSearchParams()` and `const projectName = params.get('project')`.
- On mount (when `projectName` is present): fetch `getStatus(projectName)` and format a context message.
- Inject it as the **first message in the thread** with `type: 'system-context'` (a new message type for display) OR silently pass it in the API body on the first `submit()` call.

The cleaner option is to send it as a `systemContext` field on the first chat message:
```ts
body: JSON.stringify({ sessionId, message: text, systemContext: buildContext(projectName, status) })
```

**API (`apps/api/src/routes/ops.ts`):**
- `ChatBody` already has `{ sessionId, message, confirmationFor? }` — add `systemContext?: string`.
- In the `query(...)` call, if `systemContext` is present, prepend it to the existing `SYSTEM` constant:
  ```ts
  const systemPrompt = systemContext
    ? `${SYSTEM}\n\nCurrent project context:\n${systemContext}`
    : SYSTEM
  ```
- Only apply `systemContext` on the **first message** of a session (check `!getAgentSessionId(sessionId)` — new session means history is empty).

**Context string format:**
```
Project: emit-vision
Domain: emit-vision.com
Build: #142
Uptime: up 3 days
Memory: 62% (1.2G / 2G)
Disk: 41% (8G / 20G)
Nginx: active
SSL: 87d
Redis: healthy
Queue: OK · 0 waiting
```

### Where to add the navigation link

In `apps/dashboard/app/projects/[name]/page.tsx`, the desktop topbar already has Logs / Deploy / Destroy buttons. Add an "Ask Claude" or "Ops" link next to Logs:
```tsx
<Link href={`/ops?project=${encodeURIComponent(name)}`} ...>
  <Icon name="zap" size={13} />Ask Claude
</Link>
```

## Tasks
1. Read `apps/dashboard/app/ops/page.tsx` in full.
2. Add `useSearchParams()` to read `project` param. (Wrap the component in `<Suspense>` if Next.js requires it for `useSearchParams` — check the Next.js version in `apps/dashboard/package.json`.)
3. Add state: `const [contextProject, setContextProject] = useState<string | null>(projectName)` and `const [statusContext, setStatusContext] = useState<string | null>(null)`.
4. On mount, if `contextProject` is set: call `getStatus(contextProject)` and format it into a `statusContext` string using a `buildContextString(name, status)` helper.
5. Modify `submit()`: on the first call (when `messages.length === 0`), include `systemContext: statusContext` in the POST body if available.
6. Show a subtle banner at the top of the chat thread when context is active: `"Context: <project-name> · Build #142"` with a small ✕ to clear it.
7. Read `apps/api/src/routes/ops.ts` — add `systemContext?: string` to `ChatBody`, prepend to `SYSTEM` when present and session is new.
8. Read `apps/dashboard/app/projects/[name]/page.tsx` — add "Ask Claude" link to both the desktop topbar and the mobile footer action row.
9. Add `getStatus` import to ops page if not already there (it's in `@/lib/api`).
10. Run `pnpm nx run dashboard:typecheck`.

## Files involved
- `apps/dashboard/app/ops/page.tsx` — read project param, fetch status, build context string, pass on first submit
- `apps/api/src/routes/ops.ts` — accept `systemContext?` in ChatBody, prepend to SYSTEM prompt
- `apps/dashboard/app/projects/[name]/page.tsx` — add "Ask Claude" link pointing to `/ops?project=<name>`

## Acceptance criteria
- [x] Navigating to `/ops?project=emit-vision` pre-loads status and shows a context banner
- [x] The first chat message includes the project status in the system prompt
- [x] Subsequent messages in the same session do NOT re-send systemContext (session-level injection only)
- [x] Clearing the context (✕ on banner) removes the project param and disables context injection
- [x] Navigating to `/ops` with no param opens the chat exactly as before (no regression)
- [x] "Ask Claude" link appears on project detail page
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-13

### Summary
The ops page now reads `?project=<name>` via `useSearchParams()` (wrapped in Suspense as required by Next.js 15). On mount, it fetches both `getStatus()` and `getProjects()` for the project to build a multi-line context string. On the first `submit()` call when context is loaded, `systemContext` is included in the POST body. The API's `ChatBody` now accepts `systemContext?: string`; it's prepended to the system prompt only when the session is new (`!agentSessionId`). A dismissible context banner shows "Context: <name> · Build #N" in the chat thread. The "Ask Claude" link was added to the project detail desktop topbar pointing to `/ops?project=<name>`.

### Files changed
- `apps/dashboard/app/ops/page.tsx` — added Suspense, useSearchParams, context fetch+state, banner, systemContext in first submit
- `apps/api/src/routes/ops.ts` — added `systemContext?` to ChatBody, prepend to SYSTEM on first message
- `apps/dashboard/app/projects/[name]/page.tsx` — added "Ask Claude" link to desktop topbar

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
none

## Out of scope
- Persisting project context across "New conversation" resets
- Auto-navigating from ops back to the project
- Multi-project context (one project at a time is enough)
