# Sprint 129 — Pre-deploy snapshot

**Difficulty:** 3

## Goal

Automatically trigger a database backup immediately before every deploy when a project has `postgres.backupBucket` configured. A backup failure logs a warning and streams a notice to the dashboard but never blocks the deploy.

## Reason

A deploy is the highest-risk moment for a production database: migrations run, schema changes land, and rollback is painful without a clean dump to restore from. Triggering a snapshot automatically — zero extra steps for the developer — turns backups from a manual discipline into an automatic safety net. The non-blocking design keeps the deploy flow fast even if R2 is temporarily unreachable.

## Context

- `apps/api/src/routes/operations.ts` — the POST `/projects/:name/deploy` route is the only file to change. It currently resolves the project, opens an SSE stream, then calls `runAnsible('deploy', ...)`. Insert the snapshot step between "open SSE" and "runAnsible".
- SSE event types already in use: `{ type: 'line', stream, text }`, `{ type: 'error', message }`, `{ type: 'done', exitCode }`. Add a new type `{ type: 'backup', status: 'started' | 'ok' | 'warn', message: string }` for the pre-deploy snapshot phase. The dashboard's SSE consumer ignores unknown event types, so this is safe to add without a frontend change.
- `sshExec` from `@emit-infra/core` is already imported. Use it to run the backup script.
- Backup script path: `/usr/local/bin/emit-db-backup-{project_name}` (same pattern as sprint 125).
- `sshKeyPath` and `findProject` helpers are already imported and used in this file.
- The SSE stream is opened with `openSse(reply)` — the raw response object is `reply.raw`. Events are written with `writeEvent(reply.raw, payload)`.
- The operation has a 15-minute total timeout (`operationTimeout()`). The backup step runs before the `Promise.race` with the ansible call — keep it outside that race but apply a separate shorter timeout (30 seconds) so a hung backup doesn't silently stall the deploy indefinitely.

### Pseudocode for the insertion point

```ts
// After: openSse(reply)
// Before: const deployVars = ...

if (project.config.postgres?.backupBucket) {
  writeEvent(reply.raw, { type: 'backup', status: 'started', message: 'Taking pre-deploy snapshot…' })
  try {
    await Promise.race([
      sshExec(host, `/usr/local/bin/emit-db-backup-${name} 2>&1`, key),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('backup timeout')), 30_000)),
    ])
    writeEvent(reply.raw, { type: 'backup', status: 'ok', message: 'Pre-deploy snapshot complete' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    writeEvent(reply.raw, { type: 'backup', status: 'warn', message: `Pre-deploy snapshot failed (continuing): ${msg}` })
  }
}
```

Note: `host` and `key` must be resolved before this block. Read the existing route to see exactly where `host` and `key` are currently set (they're used later in the route for the ansible inventory path — you may need to resolve them earlier).

## Tasks

1. Read `apps/api/src/routes/operations.ts` lines 27–70 in full to understand the deploy route's current structure before making changes.
2. Identify where `host` and `key` are resolved (or add that resolution before the SSE open, since the backup step needs them). Pattern: `const key = sshKeyPath(project.config.sshKeyName)` and `const host = project.config.serverIp ?? project.config.domain`.
3. Insert the pre-deploy backup block after `openSse(reply)` and before `const deployVars = ...`, as described above.
4. Add the `'backup'` event type to the `writeEvent` call site — check `apps/api/src/lib/write-sse.ts` to see if the event payload type needs updating (it may use a discriminated union or `unknown` — match whatever pattern is already there).
5. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/api/src/routes/operations.ts` — insert pre-deploy backup block in the deploy route
- `apps/api/src/lib/write-sse.ts` — add `backup` event type if the existing type union needs it

## Acceptance criteria

- [x] Deploy route triggers `/usr/local/bin/emit-db-backup-{name}` before ansible when `postgres.backupBucket` is set
- [x] Deploy route skips the backup step entirely when `postgres.backupBucket` is not set
- [x] A backup failure (SSH error or 30s timeout) logs a `backup: warn` SSE event and then continues with the deploy — it does not set a non-zero exit code
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `sshExec` to the `@emit-infra/core` import in operations.ts. Resolved `host` and `key` from project config before `openSse()` (they weren't previously needed in the deploy route, which only uses inventory.ini). Inserted the pre-deploy backup block after the inventory access check and before `deployVars` — it's guarded by `postgres?.backupBucket`, fires a 30s-timeout race with the backup script, and catches all failures to emit a `backup: warn` SSE event before continuing with the deploy. Added the `backup` discriminated union member to `SseEvent` in `write-sse.ts`.

### Files changed
- `apps/api/src/routes/operations.ts` — added `sshExec` import, resolved `host`/`key`, inserted pre-deploy backup block
- `apps/api/src/lib/write-sse.ts` — added `{ type: 'backup'; status: 'started' | 'ok' | 'warn'; message: string }` to `SseEvent`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` Dashboard UI to surface `backup` SSE events in the deploy terminal (currently rendered as unknown and ignored)

## Out of scope

- Dashboard UI changes to display the `backup` SSE event (the terminal component already renders all `line` events; `backup` events can be surfaced in a later UI sprint)
- Making backup failure block the deploy (intentional — deploy safety > backup completeness)
- Pre-provision snapshots (deploy is the high-risk moment; provision starts fresh)
