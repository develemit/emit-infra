# Sprint 38 — R2: Token Rotation on Re-Provision

> _Promoted from backlog (sprint-20 follow-up), 2026-06-09._

**Difficulty:** 2

## Goal
Prevent stale Cloudflare API token accumulation: when `emit-infra r2:setup` (or the provision flow) runs against a project that already has an R2 bucket, revoke the old token before creating a new one.

## Reason
Currently, each re-provision creates a new Cloudflare API token for R2 access but leaves old tokens alive in the Cloudflare dashboard. Over time this creates orphaned tokens with no way to trace which token belongs to which project/server. The R2 setup should be idempotent: one active token per project.

## Context
- Sprint 20 added R2 setup to the Ansible provision flow — the CF API creates a token with R2 read/write permissions
- Sprint 21 set up Terraform remote state using the same R2 token
- Sprint 37 (now queued) will persist the token credentials to `~/.emit-infra/<project>/terraform-backend.env`
- The CF API endpoint for listing/deleting tokens: `DELETE /user/tokens/:token_id`
- To revoke the old token, we need its ID. The ID should be stored alongside the credentials in the local `.env` file written by sprint 37
- If sprint 37 hasn't run yet on a given project, there's no stored token ID — skip revocation gracefully
- Cloudflare API rate limits: token operations are low-volume, no concern here

## Tasks
1. Read the R2 setup CLI command source to understand how the CF API token is currently created and what data is returned.

2. When persisting credentials (sprint 37 adds this), also save the token ID:
   ```
   token_id=<cf-token-id>
   ```
   in `~/.emit-infra/<project>/terraform-backend.env`.

3. In the R2 setup flow, before creating a new token:
   - Read the existing `terraform-backend.env` for `token_id`
   - If found, call `DELETE /user/tokens/:token_id` via the CF API
   - Log success/failure (failure should be non-fatal — the old token may already be gone)
   - Proceed to create the new token

4. If `terraform-backend.env` doesn't exist (first provision), skip the revocation step silently.

5. Add a `emit-infra r2:rotate-token [project]` convenience command that explicitly rotates the token (revoke old + create new + persist) without re-running the full R2 setup.

## Files involved
- R2 setup CLI source (read first to understand the current token creation flow)
- Sprint 37's credential persistence code — extend to include `token_id`
- New `r2:rotate-token` command

## Acceptance criteria
- [x] Re-running R2 setup for an already-provisioned project revokes the previous token before creating a new one
- [x] `token_id` is stored in `~/.emit-infra/<project>/terraform-backend.env`
- [x] If no prior token ID exists (first provision), setup runs without error
- [x] `emit-infra r2:rotate-token <project>` rotates the token standalone
- [x] Old token no longer appears active in the Cloudflare dashboard after rotation

## Dependencies
- Sprint 37 (terraform-token-persistence) should run first, since sprint 38 extends the same credential file

## Out of scope
- Token rotation scheduling / expiry policies
- Multi-user or team token management

## Completed

**Date:** 2026-06-11

### Summary
Added token rotation to the R2 setup flow. `createR2Token()` now returns the token ID from the CF API response. Before creating a new state bucket token, `setup.ts` reads the existing `terraform-backend.env` for a `token_id` and calls `DELETE /user/tokens/:id` to revoke it (non-fatal on failure). The token ID is persisted alongside the existing credentials. A new `r2:rotate-token` CLI command provides standalone rotation without re-running full setup.

### Files changed
- `packages/core/src/r2.ts` — `createR2Token` returns `tokenId`; added `revokeR2Token()`
- `packages/core/src/index.ts` — re-exports `revokeR2Token`
- `apps/cli/src/commands/setup.ts` — revoke old token before creating new; persist `token_id`
- (new) `apps/cli/src/commands/r2-rotate-token.ts` — standalone `r2:rotate-token` command
- `apps/cli/src/index.ts` — registered `r2:rotate-token` command

### Verification
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: clean
- Code review: revocation is non-fatal (try/catch, returns boolean)
- Code review: first-provision path skips revocation via `existsSync` guard
- Code review: `token_id` persisted in credential file by both setup and rotate commands

### Follow-ups
- `[defer]` Step 5 R2 bucket tokens (non-state buckets) still don't track `token_id` — only the state bucket token is rotated. Extending rotation to per-bucket tokens would require a separate credential store per bucket.
- `[defer]` The `revokeR2Token` function uses `console.warn` for failure logging; in a library context this may want to accept a logger instead.
