# Enable Hetzner server backups and delete/rebuild protection fleet-wide
**Difficulty:** 3

## Goal
The `hetzner-server` Terraform module turns on Hetzner's automated daily
server backups and delete/rebuild protection by default, and every
Terraform-managed fleet server has them applied. emit-vision (not under
Terraform) gets the same settings through the `hcloud` CLI, and that is
documented.

## Reason
Each project has one server with its database on it. Hetzner backups give a
second, whole-disk recovery path, independent of the app-level `pg_dump`
pipeline (sprints 359 and 361). They cover Docker volumes, nginx config,
certs and the drift that Ansible doesn't capture, for about 20% of the server
price (on the order of €1/month per server). Delete protection stops a
mistyped `terraform destroy` or a console click from erasing a production
box.

## Context
- **Module:** `terraform/modules/hetzner-server/main.tf` (`hcloud_server.main`,
  provider `hetznercloud/hcloud ~> 1.48`) and `variables.tf`.
- **Add variables:**
  - `backups` (bool, default `true`);
  - `delete_protection` (bool, default `true`);
  - `rebuild_protection` (bool, default `true`).
  - Map them onto `hcloud_server` arguments `backups`, `delete_protection`
    and `rebuild_protection`. The provider requires these two protection
    flags to match each other; check the provider docs for 1.48.
- **Who consumes it:** 6 repos reference the module as
  `github.com/develemit/emit-infra//terraform/modules/hetzner-server?ref=main`:
  develemail, diner-decider, emit-billing, emit-social, martialops, tastease.
  The change reaches them **only after it's pushed to main here** and each
  repo runs `terraform init -upgrade`.
- **Applying:**
  - `emit-infra provision` runs Terraform; check `provision.ts` for its
    plan-only flag (`--plan-only`).
  - **Always plan first** and confirm the plan shows only an in-place
    `update` on `hcloud_server.main`. Abort on any replace/destroy.
  - State is in R2 (S3 backend). There's no state lock, so don't run two
    applies at once.
- **Destroy path:** delete protection blocks `emit-infra destroy`. Update
  `apps/cli/src/commands/destroy.ts` to detect it and print how to disable
  it (set `delete_protection = false` and apply, or `hcloud server
  disable-protection`), instead of failing with a raw provider error.
  Remember sprint 362's runbook uses destroy on its scratch server.
- **emit-vision:** at 46.225.249.8 it isn't in Terraform. Use `hcloud server
  enable-backup <name>` and `hcloud server enable-protection <name> delete
  rebuild`. The `hcloud` token is wherever `apps/api/src/lib/hetzner.ts`
  reads it from; that file also maps the project name to the server name
  (`emit-vision` → `emit-vision-prod`).
- **Scaffolding:** check whether `setup.ts` or `init.ts` scaffolds a module
  block with explicit args that should mention the new variables.

## Tasks
1. Add the variables and arguments to the module. Run `terraform fmt` and
   `terraform validate` in a scratch root that uses the local module path.
2. Make destroy handle protection with a clear message. Add a test.
3. Commit and push (the user's pre-push flow).
4. For each of the 6 repos, run `terraform init -upgrade`, then plan. Check
   the plan is in-place only, then apply.
5. Enable the same settings on emit-vision with the `hcloud` CLI.
6. Verify with `hcloud server list -o columns=name,backup_window,protection`
   (or `describe`) that every fleet server has backups and protection on.
7. Record a "Hetzner backups" column in `docs/BACKUP-INVENTORY.md` and add
   the snapshot-restore path to `docs/DISASTER-RECOVERY.md` scenario 2.

## Files involved
- `terraform/modules/hetzner-server/main.tf`, `variables.tf`
- `apps/cli/src/commands/destroy.ts` (+ `destroy.test.ts`)
- `docs/BACKUP-INVENTORY.md`, `docs/DISASTER-RECOVERY.md`
- possibly `apps/cli/src/commands/setup.ts` / `init.ts` scaffolding

## Acceptance criteria
- [ ] `terraform validate` passes on the module.
- [ ] `destroy.test.ts` covers that a protected server produces a clear,
      actionable error.
- [ ] Every fleet server (all 7) shows backups enabled and delete protection
      on, with the `hcloud` output pasted into the inventory doc.
- [ ] No plan contained a replace or destroy. Plans were reviewed before each
      apply.
- [ ] `pnpm test`, `pnpm typecheck` and `pnpm lint` pass.

## Out of scope
- Moving emit-vision under Terraform.
- Terraform state locking (backlog it if it isn't there already).
- Snapshot-based restore automation.
