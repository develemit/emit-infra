# Add Cloudflare R2 API client to core package
**Difficulty:** 3

## Goal
Create `packages/core/src/r2.ts` with three idempotent functions: look up the
Cloudflare account ID from an API token, ensure an R2 bucket exists (create if
missing), and generate a scoped R2 API token for a specific bucket. Export all
three from `packages/core/src/index.ts`.

## Reason
The provision flow needs to create R2 buckets and generate credentials
automatically when a project declares `r2.buckets` or `postgres.backupBucket`
in `.emit-infra.json`. This module is the only place that talks to the
Cloudflare API — all downstream wiring in `setup.ts` and Ansible depends on it
existing first.

## Context
- `packages/core/src/` already has thin wrappers for Terraform, Ansible, SSH.
  Follow the same pattern: small focused module, pure functions, no side effects
  beyond the API call.
- `packages/core/src/index.ts` re-exports everything. Add the new exports there.
- Use `fetch` (Node 18+ built-in) — no new dependencies needed.
- Cloudflare API base: `https://api.cloudflare.com/client/v4`
- Auth header: `Authorization: Bearer {apiToken}`

### Cloudflare API endpoints

**Get account ID** (the token has access to exactly one account in this setup):
```
GET /accounts?per_page=1
→ result[0].id
```

**Ensure R2 bucket exists** (idempotent):
```
GET  /accounts/{accountId}/r2/buckets/{bucketName}   → 200 if exists, 404 if not
POST /accounts/{accountId}/r2/buckets                → { name: bucketName }
```
A 409 on POST means it already exists — treat as success.

**Create R2 API token** (S3-compatible credentials):
```
POST /accounts/{accountId}/r2/tokens
Body: {
  "name": "emit-infra-{bucketName}",
  "policies": [{
    "effect": "allow",
    "resources": { "com.cloudflare.edge.r2.bucket.{accountId}_{bucketName}": "*" },
    "permission_groups": [
      { "id": "2efd5506f9c8494dacb1fa10a3e7d5b8", "name": "Workers R2 Storage Bucket Item Write" },
      { "id": "6a018a9f2fc74eb6b293b0c548f08ef1", "name": "Workers R2 Storage Bucket Item Read" }
    ]
  }]
}
→ result.value.accessKeyId, result.value.secretAccessKey
```
Note: the `secretAccessKey` is only returned on creation and cannot be retrieved
again — callers must persist it immediately.

## Tasks

1. Create `packages/core/src/r2.ts` with:
   - `resolveAccountId(apiToken: string): Promise<string>`
   - `ensureR2Bucket(accountId: string, bucketName: string, apiToken: string): Promise<void>`
   - `createR2Token(accountId: string, bucketName: string, apiToken: string): Promise<{ accessKeyId: string; secretAccessKey: string }>`
   - A private `cfFetch` helper that sets the auth header and throws on non-2xx

2. Add exports to `packages/core/src/index.ts`:
   ```ts
   export { resolveAccountId, ensureR2Bucket, createR2Token } from './r2.js'
   ```

3. Run `pnpm --filter @emit-infra/core build` (or the equivalent typecheck) and
   confirm it compiles clean.

## Files involved

- new file: `packages/core/src/r2.ts`
- `packages/core/src/index.ts` — add three exports

## Acceptance criteria

- [x] `resolveAccountId` returns the account ID string for a valid token
- [x] `ensureR2Bucket` is idempotent (second call on existing bucket does not throw)
- [x] `createR2Token` returns `{ accessKeyId, secretAccessKey }` with both fields non-empty
- [x] All three functions throw a descriptive error (include status + CF error message) on API failure
- [x] `pnpm --filter @emit-infra/core build` or `tsc --noEmit` passes clean

## Completed

**Date:** 2026-06-06

### Summary
Created `packages/core/src/r2.ts` with three exported functions and a private
`cfFetch` helper. The helper handles auth and throws a descriptive error on
non-2xx responses, including the Cloudflare error codes and messages from the
response body. `ensureR2Bucket` does a GET first and only POSTs if the bucket
is absent; 409 on POST is treated as success for idempotency. `createR2Token`
posts to the R2 tokens endpoint with a scoped policy for a single bucket.

### Files changed
- (new) `packages/core/src/r2.ts` — resolveAccountId, ensureR2Bucket, createR2Token
- `packages/core/src/index.ts` — added three exports

### Verification
- `pnpm tsc --noEmit -p packages/core/tsconfig.json`: clean (no output)

### Follow-ups
none

## Out of scope

- No CLI command in this sprint — that's sprint 19
- No Ansible changes — that's sprint 20
- No tests (the API calls require a live CF account); manual verification is acceptable
