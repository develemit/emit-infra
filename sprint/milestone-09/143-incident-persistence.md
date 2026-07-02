# Sprint 143 — Uptime incident persistence

**Difficulty:** 3

## Goal

Extend `apps/api/src/lib/status-monitor.ts` to persist up→down and down→up transitions to a per-project JSONL file (`~/projects/{name}/.incidents.jsonl`), so incident history survives API server restarts and can be queried in sprint 144.

## Reason

The status monitor already detects up/down transitions and sends push notifications, but stores nothing to disk — all state is in-memory. A server restart wipes it. Persisting transitions creates a durable incident log that can answer: "How often does this go down? How long did the last outage last?" — questions currently only answerable by digging through logs.

## Context

- `apps/api/src/lib/status-monitor.ts` — the file to modify. It already has `sshState` and `httpState` Maps. The SSH probe fires push notifications on `up→down` and `down→up` transitions (lines ~46–62).
- JSONL file location: `~/projects/{name}/.incidents.jsonl` — same pattern as `.metrics.jsonl` and `.deploy-history.jsonl`.
- Incident record shape:
  ```ts
  interface IncidentRecord {
    type: 'ssh' | 'http'
    projectName: string
    event: 'down' | 'up'
    t: number          // unix seconds
  }
  ```
- Write one record per transition: down when `prev === 'up' && next === 'down'`, up when `prev === 'down' && next === 'up'`.
- Use `appendFile` from `node:fs/promises` to write each line. Wrap in try/catch so a file write failure never propagates to the polling loop.
- File path: `join(homedir(), 'projects', config.name, '.incidents.jsonl')`. Import `homedir` from `node:os` and `join` from `node:path` — check if they're already imported.
- Keep transitions in the same block where push notifications are sent, to avoid duplicating the condition logic.
- No TTL or rotation needed in this sprint — that's an ops concern.

## Tasks

1. Read `apps/api/src/lib/status-monitor.ts` in full to understand the exact transition detection logic and current imports.
2. Add `appendFile` and `join`/`homedir` imports if not already present.
3. After each push notification call (both `ssh` and `http` probe transitions), append a JSON line to `.incidents.jsonl`.
4. Keep the append wrapped in `.catch(() => {})` so file errors never crash the polling loop.
5. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/api/src/lib/status-monitor.ts` — add incident persistence on transitions

## Acceptance criteria

- [x] SSH probe `up→down` writes `{ type: 'ssh', projectName, event: 'down', t }` to `.incidents.jsonl`
- [x] SSH probe `down→up` writes `{ type: 'ssh', projectName, event: 'up', t }` to `.incidents.jsonl`
- [x] HTTP probe transitions write `type: 'http'` records similarly (when `healthCheck.url` is set)
- [x] A file write failure does not crash the status monitor or interrupt polling
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `IncidentRecord` interface and `writeIncident()` helper to `status-monitor.ts`. The helper calls `appendFile` fire-and-forget with `.catch(() => {})` so write failures never affect the polling loop. Added `writeIncident` calls immediately after each push notification in both the SSH and HTTP probe blocks — on `up→down` writes `event: 'down'`, on `down→up` writes `event: 'up'`. File path follows the existing `~/projects/{name}/` pattern.

### Files changed
- `apps/api/src/lib/status-monitor.ts` — added imports, IncidentRecord interface, writeIncident helper, and calls after each push

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- API route for reading incidents (sprint 144)
- Dashboard UI (sprint 145)
- JSONL file rotation or size limits
