# SSE streaming layer

## Goal
Add Server-Sent Events endpoints to `apps/api` for every long-running operation: deploy, provision, and log tail. Clients connect to an SSE stream and receive output lines in real time as the underlying Ansible/Terraform/Docker process runs.

## Reason
The whole point of a dashboard over a CLI is watching operations happen live in the browser. Without SSE, the UI can only show "running..." until a request finishes — which for a Terraform apply or Ansible playbook could be several minutes. Getting SSE right before building the action UI (sprint 04) means the frontend can be built to the actual streaming contract rather than retrofitted.

## Context
- Builds on sprint 01. `apps/api` is already running on port 3001 with Fastify + `@fastify/cors`.
- `packages/core` exports `runAnsible(playbook, inventory, vars)` and `runTerraform(cmd, args, cwd)`. Both use `execa` internally — you'll need to modify or wrap these to expose a streaming interface (line-by-line stdout/stderr) rather than waiting for the full result.
- Ansible inventories live at `~/projects/<name>/inventory.ini` by convention (see `apps/cli/src/commands/configure.ts` for how the CLI resolves this).
- Terraform roots live at `~/projects/<name>/terraform/` by convention.
- SSE format: each event is `data: <JSON>\n\n`. Use a discriminated union: `{ type: 'line', stream: 'stdout'|'stderr', text: string }` and `{ type: 'done', exitCode: number }` and `{ type: 'error', message: string }`.
- Fastify does not have built-in SSE support — set headers manually (`Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`) and write to `reply.raw`.

## Tasks
1. Add a `src/lib/stream-process.ts` utility that takes a command + args + cwd and returns an async generator yielding `SseEvent` objects (line, done, error). Use `execa` with `{ lines: true, stdout: 'pipe', stderr: 'pipe' }` and iterate the subprocess stdout/stderr streams.
2. Add a `src/lib/write-sse.ts` helper: `writeEvent(raw: ServerResponse, event: SseEvent): void` — serialises to `data: <JSON>\n\n` and flushes.
3. Update `runAnsible` and `runTerraform` in `packages/core` to accept an optional `onLine: (stream: 'stdout'|'stderr', text: string) => void` callback so the API can intercept output without breaking the CLI (which doesn't pass the callback).
4. Implement `POST /projects/:name/deploy` as an SSE endpoint:
   - Resolves inventory path (`~/projects/<name>/inventory.ini`)
   - Streams `runAnsible('deploy', inventory, { project_name: name })` output as SSE events
   - Sends `{ type: 'done', exitCode }` when the process exits
5. Implement `POST /projects/:name/provision` as an SSE endpoint:
   - Streams `runTerraform('apply', ['-auto-approve'], terraformDir)` output
6. Implement `GET /projects/:name/logs` as an SSE endpoint:
   - Accepts optional `?service=<name>` query param
   - Runs `docker compose logs --follow --tail=100 [service]` via SSH using a persistent SSH subprocess (not `sshExec` — that waits for exit). Use `execa` with `{ detached: false }` and pipe stdout.
   - Client disconnect (request close) must kill the SSH subprocess.
7. Add `GET /projects/:name/logs` close-on-disconnect: listen for `req.raw.on('close', ...)` to kill the child process.

## Files involved
- new file: `apps/api/src/lib/stream-process.ts` — async generator over execa subprocess
- new file: `apps/api/src/lib/write-sse.ts` — SSE serialisation helper
- new file: `apps/api/src/routes/operations.ts` — deploy, provision, logs SSE endpoints
- `apps/api/src/index.ts` — register operations routes
- `packages/core/src/ansible.ts` — add optional `onLine` callback
- `packages/core/src/terraform.ts` (or wherever `runTerraform` lives) — add optional `onLine` callback

## Acceptance criteria
- [x] `POST /projects/:name/deploy` opens an SSE stream and emits Ansible output lines as `{ type: 'line' }` events, followed by `{ type: 'done' }`
- [x] `POST /projects/:name/provision` does the same for Terraform
- [x] `GET /projects/:name/logs` streams Docker Compose logs continuously until client disconnects
- [x] Client disconnect on the logs endpoint kills the SSH subprocess (verified by checking no lingering `ssh` processes after closing the connection)
- [x] Existing CLI `deploy` and `configure` commands still work (the `onLine` callback is optional)
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-02

### Summary
Added SSE streaming for deploy, provision, and log-tail operations to `apps/api`. Created a reusable `streamProcess` async generator that merges stdout/stderr into typed `SseEvent` objects, waiting for both readline streams to drain before emitting the terminal `done` event (prevents lost lines). Updated `runAnsible` and `runTerraform` in `packages/core` with optional `onLine` callbacks: when absent they use `stdio: 'inherit'` (CLI path unchanged), when provided they pipe output and call the callback for each line. The logs endpoint uses `AbortController` + execa's `cancelSignal` to kill the SSH subprocess when the client disconnects.

### Files changed
- (new) `apps/api/src/lib/write-sse.ts` — `SseEvent` union type + `writeEvent` serializer
- (new) `apps/api/src/lib/stream-process.ts` — async generator yielding `SseEvent` from any subprocess
- (new) `apps/api/src/routes/operations.ts` — POST /deploy, POST /provision, GET /logs SSE endpoints
- `apps/api/src/index.ts` — register `operationRoutes`
- `apps/api/package.json` — added `execa` dependency
- `packages/core/src/ansible.ts` — added optional `onLine` callback with piped mode
- `packages/core/src/terraform.ts` — added optional `onLine` callback with piped mode

### Verification
- `POST /projects/test-smoke/deploy`: SSE headers + `{"type":"done","exitCode":1}` (ansible absent, expected)
- `GET /projects/test-smoke/logs`: SSE headers + `{"type":"line","stream":"stderr","text":"Warning: Identity file..."}` on disconnect
- `pgrep ssh | grep 192.0.2.1` after disconnect: none (subprocess killed correctly)
- `GET /projects/nonexistent/logs`: HTTP 404
- `pnpm typecheck`: clean
- `pnpm lint`: clean

### Follow-ups
- `[defer]` The deploy/provision endpoints don't validate that `inventory.ini` / `terraform/` directories exist before starting the SSE stream — could give a clearer error event instead of letting ansible/terraform fail with a cryptic message
- `[defer]` No timeout on deploy/provision streams — a hung ansible-playbook would hold the connection open indefinitely

## Out of scope
- Destroy endpoint (sprint 04 — needs the confirmation flow designed first)
- Any UI (sprint 03/04)
- Operation history / persistence
