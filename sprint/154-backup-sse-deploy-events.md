# Sprint 154 — Backup SSE events in deploy terminal

> _Promoted from sprint-129 follow-up, 2026-07-01._

**Difficulty:** 2

## Goal

Surface `{ type: 'backup', status, message }` SSE events in the deploy terminal UI, instead of silently ignoring them.

## Context

- Sprint-129 added `backup` type to the `SseEvent` union in `apps/api/src/lib/write-sse.ts`:
  ```ts
  | { type: 'backup'; status: 'started' | 'ok' | 'warn'; message: string }
  ```
- The deploy terminal component (somewhere in `apps/dashboard/src/components/`) currently handles `line` and `done` events but likely has an `else` or `default` that ignores unknown types.
- Find the SSE consumer in the dashboard. Add a handler for `type === 'backup'` that renders the message with a visual distinction:
  - `status: 'started'` → dim gray line, e.g. `"● Backup: <message>"`
  - `status: 'ok'` → green line `"✓ Backup: <message>"`
  - `status: 'warn'` → yellow line `"⚠ Backup: <message>"`
- Keep the output inside the existing terminal scroll area — don't add a separate panel.

## Tasks

1. Find the SSE consumer in the deploy terminal. Likely `apps/dashboard/src/components/detail/deploy-terminal.tsx` or similar. Read it.
2. Locate where `SseEvent` types are handled and add the `backup` case.
3. Apply the three-state color styling using existing CSS vars (`var(--ok)`, `var(--warn)`, `var(--fg-muted)`).
4. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Acceptance criteria

- [ ] `backup` SSE events render in the deploy terminal (not silently dropped)
- [ ] `started` / `ok` / `warn` status each has distinct visual treatment
- [ ] Existing `line` and `done` event handling is unchanged
- [ ] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean
