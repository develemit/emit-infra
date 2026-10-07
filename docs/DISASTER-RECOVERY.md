# Disaster recovery runbook

Each project runs on one Hetzner server with its database colocated. A dead
server is a full outage; a bad migration or `DROP` is a data loss. This is the
ordered path back. Written and rehearsed 2026-10-06 (see [Rehearsal log](#rehearsal-log)).

| Objective | Value |
|---|---|
| **RPO** (data you can lose) | up to **24 h**. Daily dumps, ~7 days offsite. emit-vision Postgres is hourly (RPO 1 h); its ClickHouse is daily. |
| **RTO** (measured, machine time) | **~3.5 min** from nothing to a restored, queryable database on a fresh server. |
| **RTO** (realistic, scenario 2) | **not measured end to end**: deploy, nginx, certs and DNS were not rehearsed (see log). Budget **1–2 h** until they are. |

Conventions used below: `$P` is the project name, `$IP` the server, `$KEY` the SSH key
(`~/.ssh/emit-deploy`; emit-vision accepts the default key). Per-project facts are in the
[quick reference](#per-project-quick-reference). Backup layout and credentials:
[`BACKUP-INVENTORY.md`](BACKUP-INVENTORY.md). Restore check without touching prod:
`emit-infra backup verify <name>`.

---

## Scenario 1: bad data (restore a DB on the existing server)

Use when the server is fine but the data is wrong (bad migration, `DELETE` without `WHERE`).

1. **Pick the dump.** Newest is usually right; for "before the incident" list and choose.
   ```bash
   set -a; . ~/.emit-infra/$P/r2-backup-token.env; set +a
   export AWS_ACCESS_KEY_ID=$access_key_id AWS_SECRET_ACCESS_KEY=$secret_access_key AWS_DEFAULT_REGION=auto
   aws s3 ls s3://$bucket/db-backups/ --endpoint-url $endpoint | sort | tail -10   # emit-vision: pg/
   aws s3 cp s3://$bucket/db-backups/<file> /tmp/ --endpoint-url $endpoint
   scp -i $KEY /tmp/<file> root@$IP:/root/
   ```
   Credentials fall back to the project's `ci.envFile` (`BACKUP_S3_*`) if the token file is missing.
2. **Stop the app, keep the DB up.**
   ```bash
   ssh -i $KEY root@$IP 'cd /opt/$P && docker compose stop <app services>'   # everything except the db service
   ```
   Blue-green projects: stop both slots (`docker ps` shows `-blue` / `-green`) and the nginx upstream will 502 until step 6.
3. **Safety dump of the current (broken) DB.** Never skip it; the "fix" can be wrong.
   ```bash
   docker exec <db> pg_dump -U <user> -Fc <dbname> > /root/safety-$(date +%s).dump
   ```
4. **Drop and recreate.** Connect to `postgres`, not the DB being dropped.
   ```bash
   docker exec <db> psql -U <user> -d postgres -v ON_ERROR_STOP=1 \
     -c 'DROP DATABASE "<dbname>" WITH (FORCE)' -c 'CREATE DATABASE "<dbname>" OWNER "<user>"'
   ```
5. **Restore inside the db container.** The format depends on the project.
   ```bash
   # .sql.gz (billing, social, tastease, diner-decider, martialops, emit-vision)
   gunzip -c /root/<file> | docker exec -i <db> psql -U <user> -d <dbname> -v ON_ERROR_STOP=1 -q -o /dev/null
   # .dump (develemail, pg_dump -Fc)
   docker exec -i <db> pg_restore -U <user> -d <dbname> --no-owner --exit-on-error < /root/<file>
   ```
   Gotchas, all hit during drills:
   - **Roles.** Plain-SQL dumps contain `OWNER TO <role>` and `GRANT … TO <role>`. If the
     role isn't the container's `POSTGRES_USER` (diner-decider, emit-billing, emit-social,
     tastease dumps reference extra roles) the restore dies with `role "x" does not exist`.
     Create them first: `psql -U <user> -d postgres -c 'CREATE ROLE "<role>"'`.
   - **emit-vision's dump is from pg_dump 17** (`transaction_timeout`); restore only into
     Postgres ≥17 (its container is `postgres:17-alpine`). Everything else is 16.
   - **Drizzle migrations table.** A restore can leave `drizzle.__drizzle_migrations`
     missing; the app then re-runs every migration and crash-loops on `CREATE TYPE`.
     Check: `psql -c "select to_regclass('drizzle.__drizzle_migrations')"` (empty = missing).
     Repair: `CREATE SCHEMA IF NOT EXISTS drizzle; CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial primary key, hash text not null, created_at bigint);`
     then `INSERT … (hash, created_at) VALUES ('<any>', <latest "when" from migrations/meta/_journal.json>)`.
     Only the newest `created_at` is compared, so one row is enough. Prisma projects
     (martialops) use `public._prisma_migrations`, which the dump carries.
6. **Start the app and check health.**
   ```bash
   ssh -i $KEY root@$IP 'cd /opt/$P && docker compose start <app services>'
   curl -fsS https://<domain>/<health path> ; emit-infra status $P
   docker exec <db> psql -U <user> -d <dbname> -Atc "select count(*) from information_schema.tables where table_schema='public'"
   ```
   Then spot-check a business table's newest row against what you expect (RPO: rows after the dump are gone).

---

## Scenario 2: server lost (rebuild on a fresh server)

Order matters: infra, OS, app, data, DNS last (so users never hit a half-built box).

1. **Confirm it's really gone.** `hcloud server list`, `emit-infra status $P`. A reboot
   (`hcloud server reboot <id>`) fixes more than a rebuild does; try it first.
2. **Provision.** From the project repo (its `terraform/` dir; state is in R2, credentials
   in `~/.emit-infra/$P/terraform-backend.env`):
   ```bash
   export TF_VAR_hcloud_token=… TF_VAR_cloudflare_api_token=…
   cd terraform && terraform init && terraform plan    # read it: a replaced server shows -/+ on hcloud_server
   emit-infra provision $P
   ```
   If the old server still exists in state but is dead, `terraform apply -replace=module.server.hcloud_server.main`.
   **`server_type`: `cx22` no longer exists on Hetzner**; use `cx23`/`cx33` (the fleet runs cx33).
   DNS records come from the `cloudflare-dns` module and follow the new IP: Cloudflare-proxied
   records immediately, unproxied ones after their TTL.
3. **Update the IP.** Set `serverIp` in `.emit-infra.json` to `terraform output -raw server_ip`.
   (emit-vision uses a floating IP: `hcloud floating-ip assign <id> <server-id>` instead.)
4. **Configure** (OS hardening, Docker, nginx, deploy user, certs):
   ```bash
   emit-infra configure $P
   ```
   Certs are issued fresh by certbot: DNS-01 uses `TF_VAR_cloudflare_api_token`; HTTP-01 needs
   DNS already pointing at the new IP (diner-decider uses webroot, see `DEPLOYMENT-PITFALLS.md`).
   Wildcard certs need the token. `fleet-pulse` is part of configure.
5. **Deploy the app.** The server's `.env` comes from the next deploy (deploys copy the local
   `ci.envFile` over it), so **you do not need the old server's `.env`**.
   ```bash
   ~/projects/emit-infra/scripts/deploy-detached.sh --dir ~/projects/$P
   ```
   A fresh database will boot empty (migrations run against it); that is expected and replaced in step 6.
6. **Restore the data**: [Scenario 1](#scenario-1-bad-data-restore-a-db-on-the-existing-server)
   steps 1–6 (no safety dump needed on an empty DB, but run it anyway; it's free).
7. **Verify** with `/verify-deploy` or `emit-infra status $P`; confirm the sidecar wrote a fresh
   `/opt/$P/.backup-status.json` (a backup dumps at sidecar start) and the `<project>-backup` pulse is green.
8. **Re-key.** The new host key invalidates `known_hosts`: `ssh-keygen -R $IP`. Re-run
   `emit-infra configure $P --only fleet-pulse` if the pulse URLs were host-bound.
9. **ClickHouse (emit-vision only).** On the new host:
   `docker compose run --rm --volumes-from emit-vision-clickhouse-1 clickhouse-backup clickhouse-backup restore_remote <full-…>`
   (`--volumes-from` is required; the repo's `restore-drill.sh` omits it and is broken).

---

## Scenario 3: the Mac is lost

Nothing here runs on the Mac in prod, but **every credential to change prod lives on it**.
Recreate in this order; each item lists where it is backed up today.

| State | Path | Backed up? | Recovery |
|---|---|---|---|
| SSH deploy key | `~/.ssh/emit-deploy` (+ `.pub`) | **no** | Generate a new key, upload it (`hcloud ssh-key create`), but existing servers only trust the old public key. Recovery then needs the Hetzner console/rescue mode to add it. |
| emit-vision SSH keys | `~/.ssh/emit-vision-deploy`, default `id_ed25519` | **no** | same |
| Terraform state creds | `~/.emit-infra/<p>/terraform-backend.env` | **no** | State itself is in R2; mint a new R2 token in the Cloudflare dashboard and rewrite this file. |
| R2 backup tokens | `~/.emit-infra/<p>/r2-backup-token.env` | **no** | Re-mint in Cloudflare (needed for `backup verify`). The sidecars hold their own copy in the server `.env`. |
| R2 app tokens | `~/.emit-infra/diner-decider/r2-app-token.env` | **no** | Re-mint. |
| Push keys, alert state | `~/.emit-infra/push.json`, `digest-state.json`, `email-outbox.json` | **no** | Regenerate; alert history is lost. |
| Hetzner / Cloudflare tokens | `~/.config/hcloud/cli.toml`, `TF_VAR_*` in `~/.zshrc` | **no** | Re-issue in each dashboard. |
| App secrets | each repo's `ci.envFile` (`.env.prod`; emit-vision `infra/secrets.prod.env`) | **no** (gitignored) | **Also live on each server in `/opt/<p>/.env`**: `scp` them back. This is the main recovery path. |
| develemail CLI auth | `~/.config/develemail/auth.json` | **no** | `develemail login` (use the `/api` URL). |
| emit-vision CLI profile | `~/.emit-vision/config.json` | **no** | Re-run the login. |
| Source code | `~/projects/*` | **yes**, GitHub (`develemit/*`), but unpushed commits are lost | `git clone`. |

Time Machine has no destination configured and no other Mac backup was found, so
**none of the secrets above are backed up**. Account passwords and OAuth login are the
only fallback. This gap is raised with the user (see sprint 362 Completed) and is deliberately
not solved here.

Order: GitHub clone → Hetzner/Cloudflare tokens → new SSH key + console access to the
servers → `scp` each `/opt/<p>/.env` back as `ci.envFile` → re-mint R2 tokens → `pnpm launch`.

---

## Per-project quick reference

| Project | Server IP | Domain | DB container (service `postgres`) | DB / user | Backup location | Dump format |
|---|---|---|---|---|---|---|
| emit-billing | 167.233.158.240 | billing.develemit.com | `emit-billing-postgres-1` | `emit_billing` / `emit_billing` | R2 `emit-billing-backups/db-backups/` | `.sql.gz` |
| emit-social | 167.233.169.206 | social.develemit.com | `emit-social-postgres-1` | `emit-social` / `emit-social` | R2 `emit-social-backups/db-backups/` | `.sql.gz` |
| develemail | 178.105.171.1 | develemail.com | `develemail-postgres` | `develemail` / `develemail` | R2 `develemail-backups/db-backups/` | **`.dump` (-Fc)** |
| tastease | 178.104.195.59 | tastease.app | `tastease-postgres-1` | `easy_living` / `easy_living` | R2 `tastease-backups/db-backups/` | `.sql.gz` |
| diner-decider | 167.233.43.96 | dinerdecider.com | `diner-decider-postgres-1` | `diner_decider` / `diner` | R2 `diner-decider-photos/db-backups/` | `.sql.gz` |
| martialops | 178.105.239.144 | martialops.app | `martialops-postgres-1` (postgres:16) | `martialops` / `postgres` | R2 `martialops-backups/db-backups/` | `.sql.gz` |
| emit-vision | 178.105.227.175 (floating 46.225.249.8) | emitvision.com | `emit-vision-postgres-1` (**postgres:17**) | `emit_vision` / `emit` | R2 `emit-vision-backups/pg/` (+ `full-*` ClickHouse) | `.sql.gz` |

All compose projects live in `/opt/<project>`. SSH: `ssh -i ~/.ssh/emit-deploy root@<ip>`.
Dump formats and retention: [`BACKUP-INVENTORY.md`](BACKUP-INVENTORY.md).

---

## Rehearsal log

**Date:** 2026-10-06. **Project restored:** martialops (newest dump `martialops_20261006_232436.sql.gz`, 13 KB, 31 public tables).
**Server:** scratch `dr-rehearsal` (cx23, nbg1, Ubuntu 24.04), created with Terraform from a scratch
workspace (`hetzner-server` module, local state), **no DNS, no real project config touched**; destroyed afterwards.

| Step | Measured |
|---|---|
| `terraform apply` (firewall + server) | 16 s |
| SSH reachable | 15 s |
| Ansible `common` + `docker` roles (22 tasks, 0 failed) | 157 s |
| Fetch newest dump from R2, copy to server | 6 s |
| Start `postgres:16` (incl. image pull) | 9 s |
| Scenario 1 steps 3–5: safety dump, drop/recreate, restore (rc=0, 31 tables) | 3 s |
| **Total** | **~3.5 min** |

**Not rehearsed (so not in the RTO):** the nginx role and certbot (no domain, no DNS by design),
`emit-infra deploy` of the app (would ship real secrets to a throwaway box), the DNS cutover,
the floating-IP move, and ClickHouse restore on a new host. The 1–2 h budget above is an estimate.

Where reality differed from the plan, and the fix:

- `cx22` is gone from Hetzner (`server type cx22 not found`). The Terraform module default
  and the README still say `cx22`; the runbook says `cx23`. Module default fix is a follow-up.
- `terraform apply` left an orphan firewall when the server create failed; plan-before-apply and a final `hcloud firewall list` catch it.
- The `common` role restarts sshd and keeps `PermitRootLogin prohibit-password`; key login as root kept working.
- martialops is a Prisma project; the Drizzle check returned empty and is irrelevant there.
