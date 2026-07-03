# API hardening: error shape normalization, domain validation, safer shell passing, tail-efficient readJsonl
**Difficulty:** 4

## Goal
API routes return a consistent error shape, all remaining shell-interpolated values are validated or passed safely, and `readJsonl` no longer loads entire files into memory to read a tail.

## Reason
Sprint 179 sanitized project names everywhere (`SAFE_NAME_RE`); the follow-up scan (2026-07-02) found the remaining loose ends: a few interpolated values that are regex-validated but still interpolated (defense-in-depth gap), an unvalidated `config.domain` used in a cert path, a fragile base64-over-echo pattern in secrets-sync, inconsistent error shapes that force clients to sniff response types, and an O(file-size) memory spike on every JSONL tail read.

## Context
- `SAFE_NAME_RE` is exported from `apps/api/src/lib/project-helpers.ts` and used across routes (see sprint 179 for the pattern).
- `apps/api/src/routes/container-logs.ts` line ~31 and `apps/api/src/routes/operations.ts` line ~213: container/service names are Zod-validated (`/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/`) then interpolated into `docker logs ...` strings. The regex blocks injection today; keep the regex AND make interpolation unambiguous (keep single-quoting consistent; the regex already excludes quotes — verify and add a comment-free assertion or reuse a shared safe-name constant so the invariant is enforced in one place).
- `apps/api/src/routes/projects.ts` line ~192-198: `project.config.domain` is used raw in `/etc/letsencrypt/live/${domain}/fullchain.pem`. Validate with a domain regex (one already exists client-side in `project-settings-panel.tsx`: `/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/`) before building the path; skip the cert probe if invalid.
- `apps/api/src/routes/secrets-sync.ts` line ~75: `echo -n '${b64}' | base64 -d > /opt/${name}/.env`. Base64 output is single-line so risk is low, but pass the payload via stdin to the SSH command instead of interpolating, if the ssh helper supports it — read `apps/api/src/lib/` ssh helper first. If stdin isn't supported, add a strict `/^[A-Za-z0-9+/=]+$/` check on `b64` before interpolation.
- Error shapes: some routes return `{ error }`, others `{ ok: false, error }`. Pick ONE (recommend `{ error: string }` with proper HTTP status; success keeps route-specific shape) and normalize. Check dashboard client modules `apps/dashboard/src/lib/api-*.ts` — e.g. `api-containers.ts` line ~42 sniffs `Array.isArray(data)` to detect errors — and simplify where the normalization allows.
- `apps/api/src/lib/jsonl.ts` lines ~10-22: `readJsonl` reads the whole file, splits, parses every line, then tails. Implement a reverse/tail read: read the last N bytes (grow the window if fewer than `tail` lines found), split, parse. Keep the same function signature so callers don't change.

## Tasks
1. Read the ssh helper in `apps/api/src/lib/` to learn whether stdin payloads are supported; fix secrets-sync accordingly.
2. Validate `config.domain` in projects.ts before the letsencrypt path; on invalid domain, return the same shape as "no cert".
3. Unify the interpolation invariants for container-logs.ts and operations.ts (shared constant or schema for container/service names).
4. Normalize error response shape across routes; update dashboard clients that sniff shapes.
5. Rewrite `readJsonl` tail path to read from the end of the file; verify all callers still behave (history routes, incidents).
6. Update/extend affected route tests (`container-logs.test.ts`, `projects.test.ts`, `history.test.ts`, secrets tests). Add a `jsonl` unit test for tail reads spanning the byte-window boundary.
7. Typecheck both apps; run full API test suite.

## Files involved
- `apps/api/src/routes/container-logs.ts`, `operations.ts` — shared safe-name invariant
- `apps/api/src/routes/projects.ts` — domain validation
- `apps/api/src/routes/secrets-sync.ts` — stdin or strict base64 check
- `apps/api/src/lib/jsonl.ts` — tail-efficient read
- multiple `apps/api/src/routes/*.ts` — error shape normalization
- `apps/dashboard/src/lib/api-*.ts` — remove shape-sniffing where possible
- corresponding `*.test.ts` files

## Acceptance criteria
- [x] One error response shape across all routes; dashboard clients updated
- [x] `config.domain` validated before use in cert path
- [x] secrets payload no longer interpolated unchecked (stdin or strict base64 regex)
- [x] `readJsonl` tail reads do not load the whole file; unit test proves boundary behavior
- [x] All API tests pass; typecheck clean

## Out of scope
- Splitting the monolithic status SSH command (backlog)
- Streaming JSONL writes or file compaction (rotation already handled server-side)

## Completed

**Date:** 2026-07-02

### Summary
Four hardening tracks landed. (1) Shared safe-name invariants: `SAFE_CONTAINER_RE` and `SAFE_DOMAIN_RE` now live in `project-helpers.ts` alongside `SAFE_NAME_RE`; container-logs.ts, operations.ts, and projects.ts (ContainerRestartParam) all reference them instead of inline regex copies, and operations.ts's service interpolation is now single-quoted like container-logs. (2) `config.domain` is validated against `SAFE_DOMAIN_RE` before being interpolated into the letsencrypt cert path in the status SSH command; bare-IP domains (common in configs) skip the probe via an `echo ""` placeholder so the 14-line output contract is preserved. (3) The ssh helper (`packages/core/src/ssh.ts`) has no stdin support, so per the sprint's fallback secrets-apply asserts the payload matches `/^[A-Za-z0-9+/=]+$/` before interpolation. (4) `readJsonl` tail reads now open the file and read a growing byte window from the end (64KB doubling until enough matching items or file start), keeping the same signature.

Error shape normalized to `{ error: string }` + proper HTTP status: restart failure 200-`{ok:false,output}` → 503, backup delete/trigger failures 200 → 503, secrets-apply 404/400/503 all `{ error }`. Notable side-effect fix: a failed container restart previously returned 200 `{ok:false}` and the UI showed a *success* toast (callers only try/catch); with 503 the client now throws and the error toast fires. Dashboard: `getContainers` dropped its `Array.isArray` sniff, `restartContainer` and `triggerBackup` surface the API's `error` message.

Test infrastructure gotcha for future sprints: any test mocking `../lib/project-helpers.js` must now also export `SAFE_CONTAINER_RE` and `SAFE_DOMAIN_RE` (backup.test.ts hit this); the ttl-cache mock in projects.test.ts also needed an `invalidate` no-op for the restart route.

### Files changed
- `apps/api/src/lib/project-helpers.ts` — added `SAFE_CONTAINER_RE`, `SAFE_DOMAIN_RE`
- `apps/api/src/routes/container-logs.ts` — use shared regex constants
- `apps/api/src/routes/operations.ts` — shared constants + single-quoted service interpolation
- `apps/api/src/routes/projects.ts` — domain-gated ssl probe, shared container regex, 503 `{error}` for restart/backup-delete/backup-trigger failures
- `apps/api/src/routes/secrets-sync.ts` — `{ error }` shapes (404/400/503) + strict base64 assertion
- `apps/api/src/lib/jsonl.ts` — tail-efficient windowed read from end of file
- (new) `apps/api/src/lib/jsonl.test.ts` — 7 tests incl. window-boundary growth and filtered-tail growth
- (new) `apps/api/src/routes/secrets-sync.test.ts` — 5 tests for secrets-apply error shapes + base64 payload
- `apps/api/src/routes/projects.test.ts` — ssl-probe skip/include tests, restart success/failure tests, ttl-cache mock `invalidate`
- `apps/api/src/routes/backup.test.ts` — project-helpers mock exports new constants
- `apps/dashboard/src/lib/api-containers.ts` — dropped Array.isArray sniff; restart surfaces API error message
- `apps/dashboard/src/lib/api-ops.ts` — triggerBackup surfaces API error message

### Verification
- `npx vitest run` (apps/api): 131/131 pass (16 files, +12 new tests)
- `npx nx run api:typecheck`: clean
- `npx nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` sshExec in packages/core could grow an optional stdin `input` param (execa supports it) — would let secrets-apply drop the interpolated base64 entirely
- `[defer]` prune route catch collapses all failures to `{ error: 'unreachable' }` — could pass through the real error message like restart now does
- `[defer]` readJsonlTail with `tail: 0` returns the first window's items instead of all items (old code returned all); no caller passes 0, noting for completeness
