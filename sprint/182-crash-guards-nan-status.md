# Guard unguarded JSON.parse calls and fix NaN propagation in status parsing
**Difficulty:** 3

## Goal
Three latent crash/corruption bugs in the API are fixed: docker ps parsing can't crash the ops tool, a corrupted project config returns a clean 4xx instead of crashing PATCH, and the status endpoint never sends NaN to clients.

## Reason
This dashboard exists to watch other systems — it should be the most reliable thing in the fleet. An opportunity scan (2026-07-02) found three spots where malformed external input (docker output, a hand-edited config file, short SSH output) crashes an endpoint or silently corrupts the response. All three are cheap to fix and high-trust wins.

## Context
- **Fastify API** at `apps/api/`. Zod is already used everywhere for input validation; these bugs are about *output/external* data, which Zod doesn't cover.
- `apps/api/src/lib/tool-executor.ts` line ~91: `JSON.parse(l)` is called per-line on `docker ps --format json` output with no try/catch. One malformed line throws and fails the whole endpoint.
- `apps/api/src/routes/projects.ts` lines ~54-60: `readProjectConfig` wraps JSON.parse but the PATCH handler around line ~147-148 assumes the parsed value is valid. A corrupted `.emit-infra.json` crashes PATCH rather than returning 400/500 gracefully. Read the actual code first — line numbers may have drifted.
- `apps/api/src/routes/projects.ts` lines ~198-227: the status route runs one big SSH command and destructures `raw.split('\n')` into 14 positional variables. If the server returns fewer lines (cert missing, redis down), later variables are `undefined`, `parseInt(undefined)` yields `NaN`, and NaN flows into the JSON response.

## Tasks
1. Read `apps/api/src/lib/tool-executor.ts` and wrap the per-line `JSON.parse` in a try/catch that skips (and logs via the fastify/app logger if reachable, otherwise `console.warn`) malformed lines instead of throwing.
2. Read the PATCH flow in `apps/api/src/routes/projects.ts`. Ensure a config file that fails to parse or lacks required fields results in a clean error response (500 with `{ error: 'invalid project config' }` or similar), not an uncaught throw.
3. Harden the status parsing: after splitting SSH output, verify the expected line count. For numeric fields, replace raw `parseInt(...)` with a small helper that returns `null` (or a sensible default) when the input is missing/NaN. The response must never contain NaN.
4. Check the dashboard consumers of the status response (`apps/dashboard/src/lib/api-projects.ts` or similar) to confirm null-tolerance for any fields you change from number to number|null; adjust types if needed.
5. Add/extend tests in `apps/api/src/routes/projects.test.ts` covering: short SSH output → no NaN in response; corrupted config → clean error. Follow the existing mock patterns in that file (note: mocks of `project-helpers.js` must export `SAFE_NAME_RE`).
6. Typecheck (`npx nx run api:typecheck`, `npx nx run dashboard:typecheck`) and run API tests (`npx nx run api:test`).

## Files involved
- `apps/api/src/lib/tool-executor.ts` — guard per-line JSON.parse
- `apps/api/src/routes/projects.ts` — config parse error handling + NaN-safe status parsing
- `apps/api/src/routes/projects.test.ts` — new test cases
- `apps/dashboard/src/lib/api-projects.ts` (or wherever status types live) — type updates if fields become nullable

## Acceptance criteria
- [x] A malformed docker ps line is skipped, not fatal
- [x] PATCH with a corrupted config file returns a structured error, not a crash
- [x] Status response contains no NaN when SSH output is short
- [x] New tests cover both failure modes; all API tests pass
- [x] Typecheck clean in api and dashboard

## Out of scope
- Splitting the monolithic 14-command status SSH call into independent probes (backlog — effort:high)
- TTL cache stale-null distinction (separate backlog item)

## Completed

**Date:** 2026-07-02

### Summary
Fixed three latent crash/corruption paths. In `tool-executor.ts`, the per-line `JSON.parse` on `docker ps` output is now wrapped in try/catch inside a `flatMap` — malformed lines are logged via `console.warn` and skipped instead of failing the whole ops-tool call. In `projects.ts`, the PATCH config handler wraps its `readFile` + `JSON.parse` in try/catch and returns a clean 500 `{ error: 'invalid project config' }` for corrupted or unreadable config files. The status route got a `toInt()` helper that returns `undefined` (never NaN) for missing/unparseable SSH output lines; the numeric StatusData fields (`disk`, `memory`, `containerCount`, `containerTotal`, `containerUnhealthy`) are now typed `number | undefined`.

Key decision: chose `number | undefined` over `number | null` because `JSON.stringify` omits undefined keys, which exactly matches the dashboard's existing optional-field types (`disk?: number` in `api-projects.ts`) — verified all dashboard consumers use `!= null` / `!== undefined` / `?? 0` guards, so zero dashboard changes were needed.

### Files changed
- `apps/api/src/lib/tool-executor.ts` — guarded per-line JSON.parse in get_containers (skip + warn on malformed lines)
- `apps/api/src/routes/projects.ts` — PATCH config parse error → clean 500; `toInt()` helper; StatusData numeric fields → `number | undefined`
- `apps/api/src/routes/projects.test.ts` — fs/promises mock; short-SSH-output NaN test; PATCH describe with corrupted/unreadable/happy-path tests

### Verification
- `npx nx run api:test`: 110/110 pass (13 files)
- `npx nx run api:typecheck`: clean
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` `get_status` in tool-executor.ts still returns raw strings for disk/memory without NaN guards — low risk (values interpolated into strings), could adopt the same toInt pattern if the ops chat ever needs numeric values
- `[defer]` queueFailed/queueWait in the status route use `|| 0` (masks missing data as zero) — could switch to the toInt/undefined convention for consistency
