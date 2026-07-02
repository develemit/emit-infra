# Sprint 159 — Container log viewer — API SSE route

> _Promoted from observability expansion plan, 2026-07-01._

**Difficulty:** 3

## Goal

Add `GET /projects/:name/containers/:container/logs` — an SSE route that SSHes into the server and tails `docker logs --tail 200 --follow <container>`, streaming each line to the client as `{ type: 'line', stream: 'stdout', text }` events.

## Reason

When a container shows as "restarting" or "unhealthy" in the ContainerTable, the next step is always `ssh … docker logs <name>`. Exposing this through the dashboard removes the SSH requirement and makes triage accessible during deploy reviews.

## Context

- SSE pattern used by all streaming routes:
  ```typescript
  import { openSse, sseError } from '../lib/open-sse.js'
  import { writeEvent } from '../lib/write-sse.js'
  import { streamProcess } from '../lib/stream-process.js'
  // openSse(reply) hijacks the response; streamProcess yields SseEvent via AsyncGenerator
  ```
- `streamProcess(command, args, { signal? })` spawns a local process and streams stdout/stderr lines as `{ type: 'line', stream, text }` events. Use it with `ssh` as the command to tunnel docker logs.
- SSH invocation: `['ssh', '-i', key, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes', `root@${host}`, `docker logs --tail 200 --follow '${containerName}'`]`
  - Check `apps/api/src/routes/operations.ts` imports — it also imports `sshMuxArgs` from `@emit-infra/core`. Use `sshMuxArgs(key, host)` instead of manually constructing args if that helper exists; otherwise use the explicit flags above.
- Container name validation: `/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/` (same regex used in backup key routes).
- 5-minute timeout via `AbortController`: create a controller, pass `signal` to `streamProcess`, `setTimeout(() => ctrl.abort(), 5 * 60 * 1000)`.
- Register in `apps/api/src/index.ts` — either add to an existing route file or create `apps/api/src/routes/container-logs.ts` with a named export `containerLogsRoutes`.
- The `SseEvent` type lives in `apps/api/src/lib/write-sse.ts`.

## Tasks

1. Read `apps/api/src/routes/operations.ts` (the deploy route, ~lines 25–80) to confirm the exact SSE streaming pattern and whether `sshMuxArgs` is used.
2. Read `apps/api/src/lib/stream-process.ts` to understand the `AsyncGenerator<SseEvent>` interface.
3. Create `apps/api/src/routes/container-logs.ts`:
   ```typescript
   export async function containerLogsRoutes(app: FastifyInstance): Promise<void> {
     // GET /projects/:name/containers/:container/logs
   }
   ```
   - Validate `:name` with the standard `NameParam` regex.
   - Validate `:container` with `/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/`.
   - `findProject` → 404 if not found.
   - `openSse(reply)`.
   - Build SSH args, spawn via `streamProcess`, forward all events to `reply.raw` with `writeEvent`.
   - On generator completion, call `reply.raw.end()`.
   - 5-minute abort timeout.
4. Register `containerLogsRoutes` in `apps/api/src/index.ts`.
5. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- (new) `apps/api/src/routes/container-logs.ts` — SSE route for `docker logs` streaming
- `apps/api/src/index.ts` — register `containerLogsRoutes`

## Acceptance criteria

- [ ] `GET /projects/:name/containers/:container/logs` opens an SSE stream
- [ ] Invalid container name (e.g. `../../etc/passwd`) returns 400 before opening SSE
- [ ] Missing project returns 404
- [ ] Lines stream as `{ type: 'line', stream: 'stdout', text }` events
- [ ] Stream ends with `{ type: 'done', exitCode: 0 }` when docker logs exits naturally
- [ ] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Out of scope

- Log level filtering
- Download as file
- The dashboard UI (sprint 160)
- Auth on this route beyond the existing API auth middleware
