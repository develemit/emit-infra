# API routes to serve CI and deploy log files by SHA
**Difficulty:** 2

## Goal
Two new GET routes on the history API serve the raw log content for a given CI run or deploy run by SHA. A corresponding client function is added to `api.ts` for each. Returns 404 with a clear message when no log exists (runs that predate sprint 76).

## Reason
Sprint 76 writes log files to disk. Without an API route to read them, the dashboard has no way to fetch them. This sprint closes that gap and is a prerequisite for sprint 78's log viewer UI.

## Context
- `apps/api/src/routes/history.ts` already has `GET /projects/:name/ci-history` and `GET /projects/:name/deploy-history` — new routes follow the exact same pattern (findProject check, homedir path construction, file read, 404 on missing).
- Log files are written by sprint 76 to `~/projects/<name>/.ci-logs/<sha>.log` and `~/projects/<name>/.deploy-logs/<sha>.log`.
- SHA in the route param will be the full 40-char SHA (same as stored in the filename). The dashboard sends whatever it received from the history API.
- File size is bounded (~100KB max per file, 100 files max) so reading the whole file into memory with `readFile` is fine — no streaming needed.
- Return `Content-Type: text/plain` with the raw file content. Do not JSON-wrap it.
- `apps/dashboard/src/lib/api.ts` exports all client-side fetch helpers. Add `getCiLog(name, sha): Promise<string>` and `getDeployLog(name, sha): Promise<string>` — both return the raw text, and throw if status is not 200/404. On 404, return empty string so the UI can show "log not available" without error handling complexity.

## Tasks
1. In `apps/api/src/routes/history.ts`, add two new routes inside `historyRoutes`:

   ```ts
   app.get<{ Params: { name: string; sha: string } }>(
     '/projects/:name/ci-log/:sha',
     async (req, reply) => {
       const project = await findProject(req.params.name)
       if (!project) return reply.status(404).send('not found')
       const filePath = join(homedir(), 'projects', req.params.name, '.ci-logs', `${req.params.sha}.log`)
       try {
         const content = await readFile(filePath, 'utf8')
         return reply.type('text/plain').send(content)
       } catch {
         return reply.status(404).send('log not found')
       }
     }
   )
   ```

   Add the mirror for `/projects/:name/deploy-log/:sha` reading from `.deploy-logs/`.

2. In `apps/dashboard/src/lib/api.ts`, add:
   ```ts
   export async function getCiLog(name: string, sha: string): Promise<string> {
     const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/ci-log/${encodeURIComponent(sha)}`, { cache: 'no-store' })
     if (res.status === 404) return ''
     if (!res.ok) throw new Error(`getCiLog failed: ${res.status}`)
     return res.text()
   }

   export async function getDeployLog(name: string, sha: string): Promise<string> {
     const res = await fetch(`${API_BASE}/projects/${encodeURIComponent(name)}/deploy-log/${encodeURIComponent(sha)}`, { cache: 'no-store' })
     if (res.status === 404) return ''
     if (!res.ok) throw new Error(`getDeployLog failed: ${res.status}`)
     return res.text()
   }
   ```

3. Run `pnpm nx typecheck api` and confirm clean.

## Files involved
- `apps/api/src/routes/history.ts` — add two new GET route handlers inside `historyRoutes`
- `apps/dashboard/src/lib/api.ts` — add `getCiLog` and `getDeployLog` export functions

## Acceptance criteria
- [x] `GET /projects/:name/ci-log/:sha` returns 200 + plain text content when log exists
- [x] `GET /projects/:name/ci-log/:sha` returns 404 when log file is missing
- [x] Same for `/deploy-log/:sha`
- [x] `getCiLog` and `getDeployLog` exported from `api.ts` with correct types
- [x] `pnpm nx typecheck api` passes clean
- [x] `findProject` check returns 404 for unknown project names (security: can't path-traverse to arbitrary SHAs)

## Completed

**Date:** 2026-06-20

### Summary
Added `GET /projects/:name/ci-log/:sha` and `GET /projects/:name/deploy-log/:sha` to `history.ts`. Both routes guard against path traversal (`/` in SHA → 400), check project existence via `findProject` (→ 404), then read the log file returning `text/plain`. File-not-found returns 404 gracefully. Added `readFile` import from `node:fs/promises`. Client functions `getCiLog` / `getDeployLog` added to `api.ts`, returning empty string on 404 so the UI can show "no log available" without throwing.

### Files changed
- `apps/api/src/routes/history.ts` — added `readFile` import; two new GET route handlers for ci-log and deploy-log by SHA
- `apps/dashboard/src/lib/api.ts` — added `getCiLog` and `getDeployLog` export functions

### Verification
- `pnpm nx typecheck api`: clean

### Follow-ups
none

## Out of scope
- Dashboard log viewer UI (sprint 78)
- Streaming large files (files are bounded at ~100KB)
- SHA validation / sanitization beyond what `findProject` already provides (the SHA is used directly in a path; Node's `join` with `homedir()` prevents traversal as long as SHA contains no `/` — add a simple guard: `if (req.params.sha.includes('/')) return reply.status(400).send('invalid sha')`)
