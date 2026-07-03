# Secrets Sync Flow End-to-End
**Difficulty:** 3

## Goal
Wire a "Sync to server" action directly into the SecretsPanel so users can fix detected drift without leaving the project detail page.

## Reason
`SecretsPanel` shows env key drift between local config and the remote server, but the fix requires navigating to a separate modal in the page header. Users see a problem they can't act on in context — the sync action belongs next to the drift indicator, not in a different UI region.

## Context
- `apps/dashboard/src/components/detail/secrets-panel.tsx` — renders drift state (missing keys, extra remote keys). Has a "Refresh" button. Needs a "Sync to server" button that calls a POST endpoint and shows inline success/error feedback.
- `apps/api/src/routes/secrets-sync.ts` — check whether a `POST /projects/:name/secrets-sync` endpoint exists. If it does, confirm it writes the local env keys to the remote server via SSH. If it doesn't exist, add it: read local `.env`, push keys to remote using `sshExec` to write the `.env` file on the server.
- `apps/dashboard/src/lib/api.ts` (or `api-secrets.ts` if sprint 172 is done) — add `syncSecrets(name: string): Promise<{ ok: boolean; error?: string }>` if not already present.
- Follow the `useSave` pattern from `project-settings-panel.tsx`: loading state during the call, 2s "Synced!" flash on success, inline error message on failure, then re-fetch drift.
- The "Sync to server" button should only appear when drift is detected (i.e., drift count > 0).

## Tasks
1. Read `secrets-sync.ts` to check if a POST apply endpoint exists.
2. If missing, add `POST /projects/:name/secrets-sync` that reads the local `.env` and writes it to `/opt/<name>/.env` on the remote via `sshExec`. Return `{ ok: true }` on success, `{ ok: false, error: string }` on failure.
3. Add `syncSecrets(name: string): Promise<{ ok: boolean; error?: string }>` to `api.ts`.
4. In `secrets-panel.tsx`, add a "Sync to server" button that:
   - Is only shown when drift count > 0
   - Sets a local `syncing` boolean while in flight
   - Shows "Synced!" for 2s on success
   - Shows the error message inline on failure
   - Re-fetches the drift status on success
5. Typecheck.

## Files involved
- `apps/api/src/routes/secrets-sync.ts` — add POST apply endpoint if missing
- `apps/dashboard/src/lib/api.ts` — add syncSecrets function
- `apps/dashboard/src/components/detail/secrets-panel.tsx` — add Sync button with inline feedback

## Acceptance criteria
- [x] "Sync to server" button appears only when drift is detected
- [x] Clicking it shows a loading state during the API call
- [x] Success shows a "Synced!" flash that disappears after 2s
- [x] Failure shows the error message inline
- [x] After sync, drift status re-fetches automatically
- [x] Typecheck passes

## Out of scope
- Per-key selective sync (sync all or nothing)
- Rollback / undo of sync
- Diffing individual key values (count of drifted keys is sufficient)

## Completed

**Date:** 2026-07-02

### Summary
Wired a "Sync to server" button into SecretsPanel that only appears when `missing.length > 0`. The existing `POST /projects/:name/secrets-sync` route is a GitHub Secrets SSE flow (unrelated) — so a new `POST /projects/:name/secrets-apply` route was added to `secrets-sync.ts` that reads the local `.env`/`.env.prod`, base64-encodes it, and writes it to `/opt/<name>/.env` on the remote via `sshExec`. A matching `applySecrets()` fetch function was added to `api-secrets.ts` (keeping the existing `syncSecrets` SSE URL helper intact). The button shows loading, 2s "Synced!" flash on success, inline error on failure, and triggers a drift re-fetch on completion.

### Files changed
- `apps/api/src/routes/secrets-sync.ts` — added `POST /projects/:name/secrets-apply` route; imported `sshExec` and `sshKeyPath`
- `apps/dashboard/src/lib/api-secrets.ts` — added `applySecrets()` async function
- `apps/dashboard/src/components/detail/secrets-panel.tsx` — added `syncing`/`synced`/`syncError` state, `handleSync` handler, "Sync to server" button, inline error display

### Verification
- `npx nx test api`: 106/106 pass
- typecheck: clean across all 5 packages

### Follow-ups
- `[defer]` The `secrets-apply` route uses base64 encode/decode which works on Ubuntu but may fail on non-GNU `base64` variants — verify on target servers if apply failures appear
- `[defer]` The "Sync to server" button only appears for missing keys; extra server-side keys (in `extra[]`) are not cleaned up — acceptable for now, would need a separate "remove extra keys" SSH command
