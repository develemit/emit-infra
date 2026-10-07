# Write and dry-run the disaster-recovery runbook
**Difficulty:** 3

## Goal
`docs/DISASTER-RECOVERY.md` gives step-by-step, copy-pasteable procedures for
three scenarios:
1. **bad data**: restore a DB from a backup onto the existing server;
2. **server lost**: rebuild a project on a fresh server from Terraform,
   Ansible, deploy and the latest backup;
3. **Mac lost**: what credentials and state live only on the laptop, and how
   to recover them.

At least one rebuild is rehearsed on a throwaway server.

## Reason
`docs/scaling.md:97` lists "failover runbook" as future work. Each project
runs on a single server with its database colocated, so a dead server is a
full outage. The recovery path exists in pieces (provision, configure,
deploy, sprint 361's restore drill), but nobody has walked them in order
under pressure. A runbook written and rehearsed in calm time is the
difference between a 1-hour outage and a 1-day outage.

## Context
- **Building blocks:**
  - `emit-infra provision`: Terraform apply via the `hetzner-server` and
    `cloudflare-dns` modules;
  - `emit-infra configure` (`--only` from sprint 360);
  - `emit-infra deploy`;
  - `emit-infra backup verify` (sprint 361), which shows how to fetch and
    restore a dump.
- **Per-project tables:** each project's backup bucket, prefix, format and
  DB service name are in `docs/BACKUP-INVENTORY.md` (sprint 359).
- **Production restore pattern** (put this in the runbook, not in code):
  1. stop app containers, but keep `db` up;
  2. take a safety dump of the current DB first;
  3. drop and recreate the DB;
  4. restore inside the db container;
  5. start the app;
  6. run the health checks.
  Include the Drizzle gotcha (seen during a past server migration): a `pg_dump` restore can leave
  `drizzle.__drizzle_migrations` missing, which makes the app crash-loop on
  `CREATE TYPE` at startup. Say how to check for it and repair it (see
  `docs/DEPLOYMENT-PITFALLS.md` for the existing write-up if it's there).
- **Env:** deploys copy the project's local `ci.envFile` to the server. On a
  rebuilt server the `.env` comes from the next deploy, so a rebuild doesn't
  need the old server's `.env`. Say so explicitly.
- **TLS and DNS:**
  - DNS records come from Terraform. Cloudflare-proxied records follow the
    new IP immediately; unproxied ones depend on TTL.
  - Certs are issued fresh by certbot (DNS-01 with
    `TF_VAR_cloudflare_api_token`, or webroot; see the diner-decider webroot
    note in `docs/DEPLOYMENT-PITFALLS.md`).
- **Mac-only state to inventory:**
  - `~/.emit-infra/**` (Terraform backend creds, R2 tokens, push keys,
    alert state);
  - SSH deploy keys;
  - each repo's local env files (the `ci.envFile`s);
  - `~/.config/develemail/auth.json`;
  - the emit-vision CLI profile.
  Say where each one is backed up, or flag it as **not backed up**. That gap
  is a finding for the user. Don't solve it in this sprint.
- **Rehearsal:**
  - Use the `test-smoke` project (it has a `.emit-infra.json` and no prod
    traffic), or a fresh CX22 created with Terraform from a scratch
    workspace.
  - Restore the newest dump of a small real project into it, but **never
    point real DNS at it**.
  - Destroy it afterwards (`emit-infra destroy` on the scratch project only,
    after a confirming look at the plan).
  - Expected cost is cents.
  - Time each step, then put the measured RTO, and the RPO (24h from daily
    dumps), at the top of the doc.

## Tasks
1. Draft `docs/DISASTER-RECOVERY.md` with the three scenarios, each a
   numbered checklist with exact commands.
2. Add a per-project quick-reference table: server IP, DB service, backup
   location and the restore command variant.
3. Rehearse scenario 2 on a scratch server. Fix the doc wherever reality
   differed.
4. Rehearse scenario 1's restore steps against the scratch server's DB.
5. Link the runbook from `README.md` and `docs/MONITORING.md`.

## Files involved
- new: `docs/DISASTER-RECOVERY.md`
- `README.md`, `docs/MONITORING.md`, `docs/scaling.md`: links. Remove
  "failover runbook" from the future-work list.

## Acceptance criteria
- [ ] The runbook covers all three scenarios with commands, not prose.
- [ ] A rehearsal log section records the date, project used, step timings
      and the measured RTO.
- [ ] The scratch server was destroyed. `hcloud server list` (or the
      Terraform state) shows no leftover.
- [ ] Laptop-only state that isn't backed up is listed and was raised with
      the user.
- [ ] Docs-only sprint: `pnpm lint` passes. No code-test criterion applies.

## Out of scope
- High availability or DB replication.
- Automating the full rebuild into one command.
- Backing up the Mac's state. Raise it, don't build it.

### Approved by the user (2026-10-06, "approve all")
The production actions this sprint describes are approved. Proceed without asking again, with these exceptions where you must still stop for the user:
- confirming a real email arrived;
- any step that needs the user's password manager;
- any server **reboot**.

Guardrails:
- deploy sibling repos only through `~/projects/emit-infra/scripts/deploy-detached.sh --dir <repo>`;
- skip a repo whose tree is dirty or that has an active sprint loop (record it as deferred);
- before deploying a sibling repo, run `git log origin/main..HEAD --oneline`. If it carries **other people's unpushed commits that include DB migrations**, skip it and report. Otherwise proceed, and list the extra commits in Completed;
- Terraform: apply only plans that are in-place updates;
- SSH changes: one server at a time, with a second session held open.
