# Sprint 46 — rollback --list: Show Snapshots for All Compose Images

> _Promoted from sprint-44 follow-up [defer], 2026-06-12._

## Goal

`emit-infra rollback --list` currently queries only the first image in the
compose stack. Extend it to query every unique image base so multi-image
projects see all available rollback snapshots.

## Context

`apps/cli/src/commands/rollback.ts` — `listRollbackSnapshots(host, key, imageList)`.

Current implementation:

```ts
async function listRollbackSnapshots(...): Promise<void> {
  const firstImage = imageList[0]!.split(':')[0]
  const output = await sshExec(
    host,
    `docker images --format "{{.Repository}}:{{.Tag}}" "${firstImage}" | grep ":rollback-" | sort -r`,
    key,
  )
  ...
}
```

It only queries `imageList[0]`. A compose stack with `web` + `worker` images
would silently omit rollback snapshots for any image after the first.

The fix: build a query for each unique image base, run them in one compound
shell command (piped through `sort -u -r`), and print the merged result.

Example compound command:

```sh
{ docker images --format "{{.Repository}}:{{.Tag}}" "my-app/web" | grep ":rollback-";
  docker images --format "{{.Repository}}:{{.Tag}}" "my-app/worker" | grep ":rollback-"; } \
  | sort -u -r
```

## Tasks

1. Read `apps/cli/src/commands/rollback.ts` — note the full body of
   `listRollbackSnapshots` and any imports already in use.
2. In `listRollbackSnapshots`, derive a deduplicated list of image bases:
   ```ts
   const bases = [...new Set(imageList.map(img => img.split(':')[0]))]
   ```
3. Build the compound shell snippet from `bases` — one `docker images ... | grep`
   clause per base, wrapped in `{ ... }`, piped to `sort -u -r`.
4. Replace the existing single-image `sshExec` call with the multi-image version.
5. Keep the existing "no snapshots found" fallback for empty output.
6. Run `pnpm nx run cli:typecheck` — confirm clean.

## Acceptance criteria

- [x] `listRollbackSnapshots` queries each unique image base, not just the first
- [x] Output is deduplicated and sorted newest-first
- [x] Single-image stacks still work (no regression)
- [x] `pnpm nx run cli:typecheck` clean

## Completed

**Date:** 2026-06-12

### Summary
Replaced the single-image query in `listRollbackSnapshots` with a compound shell command that queries every unique image base from the compose stack. The bases list is deduplicated via `new Set` before building the shell clauses. The compound command wraps all `docker images | grep` clauses in `{ ...; }` and pipes through `sort -u -r` to merge, deduplicate, and sort newest-first in one SSH round trip. Single-image stacks produce the same output as before.

### Files changed
- `apps/cli/src/commands/rollback.ts` — replaced single-image query in `listRollbackSnapshots` with multi-image compound command

### Verification
- `pnpm nx run cli:typecheck`: clean
- Code review: `new Set(imageList.map(...))` handles deduplication before building clauses
- Code review: single-image case still works — `{ clause; } | sort -u -r` is valid shell with one clause

### Follow-ups
none
