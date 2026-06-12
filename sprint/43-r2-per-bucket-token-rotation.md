# Sprint 43 — R2: Per-Bucket Token Rotation

> _Promoted from sprint-38 follow-up [defer], 2026-06-11._
> _This item may benefit from `/plan-sprint "r2 per-bucket token rotation"` to expand into a sequence if the credential store design needs iteration._

**Difficulty:** 3

## Goal
Extend R2 token rotation to cover per-project application buckets (`r2.buckets` and `postgres.backupBucket`), not just the Terraform state bucket. Store each bucket's `token_id` in a local credential file so re-provision can revoke the old token before creating a new one.

## Reason
Sprint 38 added token rotation for the Terraform state bucket by persisting `token_id` in `~/.emit-infra/<project>/terraform-backend.env`. But R2 application tokens (created in `setup.ts` step 5 for `r2.buckets` and `postgres.backupBucket`) don't track their token IDs — each re-provision creates a new token and leaves the old one alive. Over time this accumulates orphaned tokens in the Cloudflare dashboard with no traceability.

## Context

### Existing state (sprint 37 + 38)
- State bucket token: `~/.emit-infra/<project>/terraform-backend.env` stores `bucket`, `access_key`, `secret_key`, `endpoint`, `token_id`
- App bucket tokens: no local store, no rotation — new token created every provision

### What needs to be added
- A new local credential file: `~/.emit-infra/<project>/r2-app-tokens.json`
  - JSON map: `{ "<bucketName>": { "tokenId": "...", "accessKeyId": "..." } }`
  - `secretAccessKey` is NOT stored (already pushed to GitHub secrets and server `.env`)
  - `tokenId` is stored so rotation can DELETE the old token before creating a new one
- Before creating an app bucket token in `setup.ts`, read this file for the existing `tokenId` and revoke it via `revokeR2Token()` (non-fatal on failure)
- After creating the new token, persist the new `tokenId` (and `accessKeyId` for reference) back to the file

### File locations in the codebase
- `packages/core/src/r2.ts` — `createR2Token()`, `revokeR2Token()`, `ensureR2Bucket()`
- `apps/cli/src/commands/setup.ts` — R2 step (step 5 in the 7-step flow) where app bucket tokens are created
- The existing state token rotation pattern (sprint 37/38) in `setup.ts` is the model to follow

### Credential file format
```json
{
  "my-bucket": {
    "tokenId": "cf-token-id-abc123",
    "accessKeyId": "abc123..."
  },
  "backup-bucket": {
    "tokenId": "cf-token-id-xyz789",
    "accessKeyId": "xyz789..."
  }
}
```

## Tasks

1. Read `apps/cli/src/commands/setup.ts` — find the R2 app-bucket step (where the loop over `config.r2?.buckets` and `config.postgres?.backupBucket` creates tokens). This is the section to modify.

2. Add a helper function (inline in `setup.ts` or extracted to a small util) to read/write `~/.emit-infra/<project>/r2-app-tokens.json`:
   ```ts
   type AppTokenStore = Record<string, { tokenId: string; accessKeyId: string }>
   function readAppTokenStore(project: string): AppTokenStore { ... }
   function writeAppTokenStore(project: string, store: AppTokenStore): void { ... }
   ```
   Use `JSON.parse(readFileSync(...))` and `writeFileSync(..., JSON.stringify(..., null, 2))` with mode 0600. Handle missing file gracefully (return `{}`).

3. Before creating each app bucket token, check the store for an existing `tokenId` and call `revokeR2Token(cfToken, tokenId)`. Non-fatal (warn and continue if revocation fails).

4. After creating each new token, update the store with the new `tokenId` and `accessKeyId`. Write the store back to disk.

5. Run `pnpm tsc --noEmit -p apps/cli/tsconfig.json` — confirm clean.

## Files involved
- `apps/cli/src/commands/setup.ts` — modify R2 app-bucket token creation loop
- `packages/core/src/r2.ts` — read-only reference; no changes needed
- `~/.emit-infra/<project>/r2-app-tokens.json` — runtime output (not in repo)

## Acceptance criteria
- [x] Re-running `emit-infra setup` on a project with `r2.buckets` revokes the previous bucket token before creating a new one
- [x] `r2-app-tokens.json` is written to `~/.emit-infra/<project>/` with mode 0600
- [x] First provision (no existing credential file) runs without error
- [x] Revocation failure (old token already deleted in CF dashboard) is non-fatal — setup continues
- [x] `token_id` for each bucket is stored and used on next run
- [x] TypeScript compiles clean

## Completed

**Date:** 2026-06-12

### Summary
Added per-bucket R2 token rotation to `setup.ts`. Before creating each app bucket token (backup bucket and `r2.buckets` entries), the code now reads `~/.emit-infra/<project>/r2-app-tokens.json` for an existing `tokenId` and calls `revokeR2Token()` — non-fatal on failure. After creating the new token, `tokenId` and `accessKeyId` are persisted back to the JSON file (mode 0600). The two new helper functions `readAppTokenStore` / `writeAppTokenStore` live at the bottom of `setup.ts` alongside the existing `step`/`ok`/`warn` helpers.

The `secretAccessKey` is intentionally not stored in the JSON file — it's already pushed to GitHub secrets and the server `.env`. Only the `tokenId` (needed for next-run revocation) and `accessKeyId` (for reference/debugging) are persisted locally.

### Files changed
- `apps/cli/src/commands/setup.ts` — added token store read/revoke/write to R2 app-bucket step; added `readAppTokenStore` and `writeAppTokenStore` helper functions

### Verification
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: clean (no output)
- Code review: first-provision path returns `{}` from `readAppTokenStore` → `existing?.tokenId` is undefined → no revocation call
- Code review: revocation failure uses `warn()` and continues (non-fatal)
- Code review: `writeFileSync(..., { mode: 0o600 })` matches requirement

### Follow-ups
none

## Out of scope
- Rotating the Terraform state bucket token (already handled by sprint 38)
- Exposing a standalone `r2:rotate-app-token` command (can be added later)
- Migrating projects that already have old orphaned tokens (manual CF dashboard cleanup)
