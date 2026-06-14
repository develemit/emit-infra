# Sprint 37 — Terraform: CF Token Persistence + Init CLI Wrapper

> _Promoted from sprint-21 follow-up [defer]×2, 2026-06-09._

**Difficulty:** 2

## Goal
Store the Cloudflare R2 state bucket token in a local `.env`-style file after R2 setup so subsequent `terraform plan/apply` runs work without re-running full setup. Add a `terraform-init` sub-command to the emit-infra CLI that auto-injects the backend config.

## Reason
After sprint 21 set up Terraform R2 remote state, every `terraform plan` requires the CF API token to be available as a backend-config flag. Currently operators must re-run the full R2 setup or manually set the token. This is friction that makes infrastructure iteration slower than it should be.

## Context
- Sprint 21 created the R2 state bucket + CF API token and wrote a Cloudflare credentials file
- The Terraform backend config requires: `bucket`, `access_key_id`, `secret_access_key`, `endpoint`
- These values come from the CF API token created during provision — they're written to the server's `.env` but not stored locally for developer CLI use
- The emit-infra CLI entry point is at `apps/api/src/cli.ts` or similar — read before editing
- `emit-infra r2:setup` (or equivalent) is the command that creates the token; its output should be persisted
- A reasonable local store: `~/.emit-infra/<project>/terraform-backend.env` — a gitignored file with the backend vars
- `terraform init -backend-config=<file>` accepts a file of `key=value` pairs

## Tasks
1. Read the CLI source to understand the command structure and how R2 setup is currently implemented. Find where the CF token is created and where its credentials are currently output.

2. After the R2 token is created, write the backend credentials to `~/.emit-infra/<project>/terraform-backend.env`:
   ```
   bucket=<bucket-name>
   access_key_id=<token-access-key>
   secret_access_key=<token-secret-key>
   endpoint=https://<account-id>.r2.cloudflarestorage.com
   ```
   Use `0600` permissions. Create the directory if it doesn't exist.

3. Add a `terraform-init` sub-command (or `terraform:init`) to the CLI:
   ```
   emit-infra terraform-init [project]
   ```
   This command:
   - Reads `~/.emit-infra/<project>/terraform-backend.env`
   - Runs `terraform init -backend-config=<path-to-file>` in the project's terraform directory
   - Prints a clear error if the credentials file doesn't exist yet (with instructions to run R2 setup first)

4. Document the command in the CLI help output.

5. Update `~/.gitignore` or the project's `.gitignore` to ensure `~/.emit-infra/` token files aren't accidentally committed. (The directory is in `~`, so this is more of a `~/.gitignore_global` consideration — just document it.)

## Files involved
- CLI source (likely `apps/api/src/cli.ts` or `apps/cli/`) — add terraform-init command
- R2 setup command source — add credential persistence after token creation
- `~/.emit-infra/<project>/terraform-backend.env` — runtime output (created by CLI, not in repo)

## Acceptance criteria
- [x] After running R2 setup for a project, `~/.emit-infra/<project>/terraform-backend.env` exists and contains the four backend config vars
- [x] `emit-infra terraform-init <project>` runs `terraform init` with the backend config injected automatically
- [x] Clear error message if credentials file is missing
- [x] `terraform plan` works after `emit-infra terraform-init` without any manual env var setting

## Completed

**Date:** 2026-06-10

### Summary
Added credential persistence to `setup.ts`: after creating the R2 state bucket token (step 3), the backend credentials (`bucket`, `access_key`, `secret_key`, `endpoint`) are written to `~/.emit-infra/<project>/terraform-backend.env` with mode 0600. Created a new `terraform-init` CLI command that reads this file and passes it to `terraform init -backend-config=<path>`, allowing `terraform plan/apply` to work without re-running full setup. The command falls back to reading project name from `.emit-infra.json` when no project argument is given.

### Files changed
- `apps/cli/src/commands/setup.ts` — added credential file write after state token creation
- (new) `apps/cli/src/commands/terraform-init.ts` — `terraform-init` sub-command
- `apps/cli/src/index.ts` — registered `terraform-init` command

### Verification
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: clean (no output)
- Code review: credential file uses `access_key` and `secret_key` matching S3 backend config key names
- Code review: missing credentials file produces clear error with instructions to run setup
- Code review: `-backend-config=<path>` passes the file directly to terraform init

### Follow-ups
- `[defer]` `~/.emit-infra/` directory is in the home dir so not at risk of git commits, but a note in the project README about this local state would help onboarding
- `[defer]` Sprint 38 will extend this file with `token_id` for token rotation

## Out of scope
- Secrets rotation / token refresh
- Multi-account Cloudflare support
- Vault-based secret storage
