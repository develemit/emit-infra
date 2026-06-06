# Wire R2 provisioning into `setup` command
**Difficulty:** 3

## Goal
When `config.r2.buckets` or `config.postgres.backupBucket` is declared in
`.emit-infra.json`, `emit-infra setup` automatically creates the R2 bucket(s),
generates scoped API tokens, and pushes the resulting credentials to GitHub
secrets — no manual Cloudflare dashboard steps required.

## Reason
The `setup` command is meant to be the single command that takes a config file
to a fully operational project. Right now it stops short of R2: a developer has
to go to the Cloudflare dashboard, create a bucket, create an API token, copy
the credentials into GitHub secrets, and write them to the server `.env` by
hand. This sprint closes that gap for both the postgres backup use-case and
general-purpose R2 buckets.

## Context
- `apps/cli/src/commands/setup.ts` has 5 labelled steps:
  1. SSH key, 2. Hetzner registration, 3. Terraform, 4. GitHub secrets, 5. Ansible.
  The R2 step slots in **between step 3 and step 4** (we have the server IP after
  Terraform; GitHub secrets are already being pushed in step 4 so R2 creds go there).
- Sprint 18 added `resolveAccountId`, `ensureR2Bucket`, `createR2Token` to
  `@emit-infra/core`. Import them from there.
- `TF_VAR_cloudflare_api_token` is already validated in pre-flight and has
  account-level permissions sufficient to create buckets and tokens.
- Step 4 already pushes `SERVER_IP` and `SSH_PRIVATE_KEY` via
  `execa('gh', ['secret', 'set', ...])`. Add R2 secrets to that same block.
- `config.r2.buckets` is `string[]` (bucket names). Each gets its own token.
- `config.postgres.backupBucket` is a single string. The generated creds for
  this bucket must be named exactly `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY` — that's what the `postgres-backup` Ansible role's
  `db-backup.sh.j2` template reads from the server `.env`.
- For general `r2.buckets`, use namespaced names:
  `R2_{BUCKET_NAME_UPPER}_ACCESS_KEY_ID` and `R2_{BUCKET_NAME_UPPER}_SECRET_ACCESS_KEY`
  (upper-snake-case the bucket name, replace hyphens with underscores).

### Updated step count
The setup flow gains a conditional step. Update the total in `step(n, total, …)`
calls so the counter stays accurate:
- If R2 config present: 6 total steps (R2 becomes step 4, GH secrets step 5, Ansible step 6)
- If no R2 config: keep 5 total steps (unchanged)

## Tasks

1. Import `resolveAccountId`, `ensureR2Bucket`, `createR2Token` from
   `@emit-infra/core` at the top of `setup.ts`.

2. After step 3 (Terraform), add a conditional R2 block:
   ```
   const hasBuckets = (config.r2?.buckets?.length ?? 0) > 0
   const hasBackupBucket = !!config.postgres?.backupBucket
   if (hasBuckets || hasBackupBucket) {
     step(4, total, 'Provisioning R2 buckets and tokens')
     // resolve account ID once
     // loop buckets + backupBucket, call ensureR2Bucket + createR2Token
     // collect into r2Secrets map
   }
   ```

3. Collect all R2 credentials into a `Record<string, string>` called `r2Secrets`.
   - For `postgres.backupBucket`: add keys `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
     `R2_SECRET_ACCESS_KEY`.
   - For each name in `r2.buckets`: add keys
     `R2_{NAME}_ACCESS_KEY_ID`, `R2_{NAME}_SECRET_ACCESS_KEY`
     (upper-snake-cased).

4. In step 4/5 (GitHub secrets), after pushing `SERVER_IP` and `SSH_PRIVATE_KEY`,
   push each entry in `r2Secrets` via the same `execa('gh', ['secret', 'set', ...])` pattern.

5. Print the pushed secret names (not values) so the operator can confirm.

6. Update the step counter logic so `total` is `hasBuckets || hasBackupBucket ? 6 : 5`
   and all `step(n, total, …)` calls reference it.

7. Run `pnpm --filter @emit-infra/cli build` (or typecheck) and confirm clean.

## Files involved

- `apps/cli/src/commands/setup.ts` — add R2 step between Terraform and GH secrets

## Acceptance criteria

- [x] Running `setup` with no `r2` or `postgres.backupBucket` in config behaves identically to today (5 steps, no R2 API calls)
- [x] Running `setup` with `postgres.backupBucket: "my-bucket"` creates the bucket if missing, generates a token, and pushes `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` to GitHub secrets
- [x] Running `setup` a second time (idempotent): bucket already exists → no error, new token generated and secret overwritten
- [x] General `r2.buckets` entries produce namespaced secret names
- [x] Step counter in console output stays correct (6 when R2 present, 5 otherwise)
- [x] TypeScript compiles clean

## Completed

**Date:** 2026-06-06

### Summary
Wired the three R2 API functions from sprint 18 into `setup.ts`. The setup
command now computes `hasBuckets` / `hasBackupBucket` before any steps run and
uses them to set `total` (5 or 6) and to derive `ghStep` / `ansibleStep` so all
step labels stay accurate regardless of config. The R2 block runs after Terraform
(account ID is resolved once, then buckets are ensured and tokens created in a
loop). `r2Secrets` is populated in the R2 step and its entries are pushed to
GitHub secrets alongside `SERVER_IP` and `SSH_PRIVATE_KEY` in the GH secrets step.

### Files changed
- `apps/cli/src/commands/setup.ts` — added R2 step, dynamic step counter, r2Secrets push

### Verification
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: clean (no output)
- code review: no-R2-config path skips the block entirely, `total` stays 5
- code review: backup bucket path produces exactly `CF_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- code review: general bucket names are upper-snake-cased with `R2_` prefix

### Follow-ups
none

## Out of scope

- Writing R2 creds to the server `.env` directly — that's sprint 20 (Ansible)
- No UI changes to the provision wizard
