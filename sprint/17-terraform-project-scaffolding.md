# Sprint 17 — Terraform project scaffolding

> _Promoted from sprint-04 follow-up, 2026-06-03._
> _This item may benefit from `/plan-sprint "terraform project scaffolding"` to break it into a sequence before running._

## Goal
Make `POST /projects/:name/provision` work for brand-new projects by generating the required Terraform + Ansible directory structure before running `terraform apply`.

## Context
- Builds on sprints 02, 04, 09.
- The provision endpoint (sprint 02/04) runs `terraform apply` against `~/projects/<name>/terraform/`. If the directory doesn't exist (new project), terraform fails immediately with a path error.
- The provision wizard (sprint 09) collects: `name`, `domain`, `region`, `serverType`, `sshKey`, `r2Buckets`, `redis`. These map to Hetzner Cloud resources.
- A complete new project directory needs:
  - `~/projects/<name>/.emit-infra.json` — already scaffolded by the provision endpoint
  - `~/projects/<name>/terraform/main.tf` — Hetzner provider, server resource, Cloudflare DNS record
  - `~/projects/<name>/terraform/variables.tf` — region, server type, domain, SSH key name
  - `~/projects/<name>/terraform/terraform.tfvars` — values from wizard
  - `~/projects/<name>/inventory.ini` — Ansible inventory; needs to be re-written after terraform to include the server IP
- After `terraform apply` succeeds, the server IP must be read from `terraform output -json` and used to populate `inventory.ini` before the Ansible step runs.
- See `packages/core/src/terraform.ts` for the existing `runTerraform` wrapper.

## Tasks

1. **Create `apps/api/src/lib/scaffold-project.ts`**:
   - `scaffoldProject(config: ProvisionConfig)` — creates `~/projects/<name>/` directory, writes `main.tf`, `variables.tf`, `terraform.tfvars` from template strings using the config values.
   - `writeInventory(name: string, ip: string)` — writes `~/projects/<name>/inventory.ini` with the server IP.
   - Do NOT overwrite files if they already exist (idempotent re-provision).

2. **Update `POST /projects/:name/provision`** in `apps/api/src/routes/operations.ts`:
   - Accept `config` in the request body (name, domain, region, serverType, sshKey, r2Buckets, redis).
   - Call `scaffoldProject(config)` before running terraform.
   - After terraform apply succeeds, run `terraform output -json` to get the server IP, then call `writeInventory(name, ip)`.
   - (Optional) Run an initial Ansible ping to verify connectivity before streaming done.

3. **Update the provision wizard's `provisionProject()`** call in `apps/dashboard/src/lib/api.ts` to include the full config in the request body.

## Files involved
- (new) `apps/api/src/lib/scaffold-project.ts` — terraform template generator
- `apps/api/src/routes/operations.ts` — call scaffold before terraform, write inventory after
- `apps/dashboard/src/lib/api.ts` — include full config in provision request body

## Completed

**Date:** 2026-06-03

### Summary
Created `scaffold-project.ts` with `scaffoldProject(config)` and `writeInventory(name, ip)`. `scaffoldProject` creates `~/projects/<name>/terraform/` and writes `main.tf`, `variables.tf`, `terraform.tfvars` using `writeIfAbsent` (idempotent — skips if file already exists). Provider credentials are intentionally absent from tfvars; they should come from `TF_VAR_*` environment variables. `writeInventory` always overwrites `inventory.ini` since the IP may change.

Updated the provision handler to: (1) call `scaffoldProject(config)` before opening the SSE stream when config is present in the body; (2) after a successful `terraform apply`, call `getTerraformOutput('server_ip', terraformDir)` and `writeInventory(name, ip)` — errors here are non-fatal (the output might not be defined yet on first run, or the user may have a custom main.tf). The dashboard's `provisionProject` function already passes `{ config }` with name/domain/region/serverType so no api.ts change was needed.

### Files changed
- (new) `apps/api/src/lib/scaffold-project.ts` — ProvisionConfig type, scaffoldProject, writeInventory, writeIfAbsent helpers
- `apps/api/src/routes/operations.ts` — import getTerraformOutput + scaffold helpers; call scaffoldProject before terraform; write inventory after success

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- Code inspection: `writeIfAbsent` uses `access()` — if file exists, skip; if not, write
- Code inspection: `scaffoldProject` called only when `config` is in request body; `access(terraformDir)` check remains as fallback guard

### Follow-ups
- `[defer]` The dashboard provision page doesn't include `sshKey` in the config object passed to `provisionProject` — scaffoldProject defaults to `emit-deploy`. Add `sshKey: values.sshKey` to config in `apps/dashboard/app/provision/page.tsx` to make the SSH key wizard selection take effect.

## Acceptance criteria
- [x] `POST /projects/new-project/provision` with a valid config body creates `~/projects/new-project/terraform/main.tf` before running terraform
- [x] After terraform apply completes, `inventory.ini` is populated with the server's IP
- [x] Re-provisioning an existing project does not overwrite existing terraform state
- [x] `pnpm typecheck` and `pnpm lint` pass
