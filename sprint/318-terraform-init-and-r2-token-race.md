# Fix `terraform-init`'s backend-config format and the R2 token propagation race
**Difficulty:** 3

## Goal
`emit-infra terraform-init` initialises successfully against the stored
credential file, and `emit-infra setup` no longer fails with a 401 when it uses
an R2 token it just minted.

## Reason
Two independent defects in the same setup path. Both cost time rather than
causing damage, both are small, and both were hit during the martialops
rebuild on 2026-08-26.

**`terraform-init` feeds a `.env` file to Terraform as HCL.**
`apps/cli/src/commands/terraform-init.ts:39` passes
`-backend-config=${credPath}`, where `credPath` is
`~/.emit-infra/<project>/terraform-backend.env`. Terraform parses a
`-backend-config=<file>` argument as **HCL**, and the file is unquoted
`key=value` lines. Confirmed on disk — the real file contains:
```
bucket=<…>
access_key=<…>
secret_key=<…>
endpoint=https://<id>.r2.cloudflarestorage.com
token_id=<…>
```
An unquoted URL is an HCL syntax error:
```
Error: Missing newline after argument
  on .../terraform-backend.env line 4:
   4: endpoint=https://<id>.r2.cloudflarestorage.com
```
Meanwhile `setup.ts:154` does it correctly with discrete
`-backend-config=access_key=…` pairs. The two paths disagree, and `setup`'s is
the one that works.

**Quoting the file is not sufficient.** The file also carries `token_id`,
which is not a valid Terraform S3-backend argument — it is emit-infra's own
bookkeeping for token rotation. Even as valid HCL, Terraform would reject it.
So the fix must be to split into discrete `-backend-config=k=v` args and
**filter to backend-valid keys**, not to requote the file.

**`setup` uses a freshly minted R2 token before it propagates.** `setup.ts`
rotates the state-bucket token and immediately runs `terraform init` with it —
there is no `sleep`, `retry`, `backoff`, or `setTimeout` anywhere in the file.
The result:
```
Error: Failed to get existing workspaces: Unable to list objects in S3 bucket
"<project>-tfstate" with prefix "env:/": … StatusCode: 401 … Unauthorized
```
The credentials are valid — the same key/secret worked via `aws s3 ls` minutes
later and `terraform init` then succeeded unchanged. The cost is that this
reads as a permissions problem, and the obvious response (rotate again)
re-enters the same race. It burned two full `setup` runs before the pattern
was clear.

## Context

### Where the credential file is written
Three places touch it — keep them consistent:
- `apps/cli/src/commands/setup.ts:93`
- `apps/cli/src/commands/r2-rotate-token.ts:23`
- `apps/cli/src/commands/terraform-init.ts:26` (reads it)

If you change the file's format, all three must agree. **Preferred fix keeps
the format unchanged** and changes only how `terraform-init` consumes it —
that avoids a migration for every project that already has one on disk.

### Which keys Terraform's S3 backend actually accepts
`setup.ts` passes only `access_key` and `secret_key` on the command line; the
rest (`bucket`, `endpoint`, region skips, `force_path_style`) are baked into
the generated `terraform/backend.tf` — read the `backendTf` template around
`setup.ts:140` to see exactly which. Match that split rather than passing
everything, and derive the allowed key list from what `backend.tf` does
*not* already set.

### The propagation race
Do not "fix" this with a fixed `sleep` — that is the fixed-timing anti-pattern
this repo swept out in sprint 303 (see `docs/TEST-TIMING-PATTERNS.md`). Retry
the first authenticated call with backoff until it succeeds or a bounded
budget expires. If it still fails, the error message should distinguish
"token was minted seconds ago, this is probably propagation" from a genuine
permissions failure — the misdiagnosis is most of the cost here.

There is prior art for R2 token handling in `packages/core/src/r2.ts`
(`createR2Token`, `revokeR2Token`, `deriveR2Credentials`), with tests in
`r2.test.ts`.

### Testing
`terraform-init` has no test file today. `setup` is large and shells out; test
the extracted pure pieces — the key-filtering/arg-building function and the
retry policy — rather than trying to drive the whole command.

## Tasks
1. Change `terraform-init.ts` to read the credential file, filter to
   backend-valid keys (excluding `token_id` and anything `backend.tf` already
   sets), and pass discrete `-backend-config=k=v` args like `setup` does.
2. Extract that parse-and-build step as a pure exported function.
3. Verify `terraform-init` now succeeds against a real existing
   `terraform-backend.env` — name the project used.
4. Add bounded retry-with-backoff around the first authenticated Terraform
   call in `setup.ts` following a freshly minted token.
5. Make the failure message after exhausting retries name the
   minted-just-now case explicitly.
6. Extract the retry policy so it is testable without real network calls.
7. Add tests for both extracted functions.

## Files involved
- `apps/cli/src/commands/terraform-init.ts` — parse + discrete args
- `apps/cli/src/commands/setup.ts` — retry/backoff after token mint
- new file: `apps/cli/src/commands/terraform-init.test.ts` — arg-building tests
- a test for the retry policy (extend an existing suite if one fits)
- `packages/core/src/r2.ts` — reference only

## Acceptance criteria
- [ ] `terraform-init` succeeds against a real stored credential file — paste
      the command and result.
- [ ] `token_id` is excluded from the args passed to Terraform, and so is
      anything already set in `backend.tf`.
- [ ] The credential file format on disk is unchanged (no migration needed for
      existing projects) — or, if changed, all three touch points are updated
      and existing files are handled.
- [ ] A tampered/malformed credential file produces a clear error rather than
      an opaque Terraform parse failure.
- [ ] The post-mint retry succeeds against a transient 401 and gives up after a
      bounded budget with a message naming the propagation case.
- [ ] No fixed `sleep` is used as the retry mechanism.
- [ ] Tests cover the arg-building function (including the `token_id`
      exclusion) and the retry policy — name the files.
- [ ] `pnpm test` and `pnpm typecheck` clean.

## Out of scope
- Changing how R2 tokens are minted or rotated (`packages/core/src/r2.ts`).
- The GitHub credential work — sprints 319 and 320.
- Reworking `setup`'s overall flow or step numbering.
