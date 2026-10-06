# Fleet backup inventory

Sprint 359 — target contract for every production database:

1. dumps at least daily;
2. ships the dump off the server to R2;
3. writes `/opt/<name>/.backup-status.json` as `{"lastRun","status":"ok"|"failed","key","bytes"}`;
4. keeps at least 7 days offsite.

> **Resolved 2026-10-06.** The survey found that **emit-billing** and **emit-social**
> had no backups at all: no sidecar, no cron, no dumps on disk. Work stopped at
> task 2 for approval ("Approve 359"). Both are now on the contract; see
> [After](#after-verified-2026-10-06-2251z2325z).

## Before (surveyed 2026-10-06 ~22:30Z, read-only)

Evidence came from `ssh root@<ip>` (`docker ps`, `cat /opt/<name>/.backup-status.json`,
`crontab -l`, `systemctl list-timers`, `find / -name '*.dump' -o -name '*.sql*'`)
and `aws s3 ls` with each project's own credentials from its local `ci.envFile`.

| Project | Server | Mechanism / schedule | Destination | Offsite? | Format / retention | Status file | Last good backup | Encrypted |
|---|---|---|---|---|---|---|---|---|
| **emit-billing** | 167.233.158.240 | **none** | — | **no** | — | **none** | **never** | — |
| **emit-social** | 167.233.169.206 | **none** | — | **no** | — | **none** | **never** | — |
| develemail | 178.105.171.1 | `pgbackup` sidecar (postgres:16-alpine), daily ~16:05Z | docker volume `develemail_postgres-backups` | **no** | `pg_dump -Fc` `.dump`, ~8 local copies (4.3M total) | yes, `{lastRun,status}` only, no `key`/`bytes` | `develemail-20261006_160530.dump` 576569 B | no |
| tastease | 178.104.195.59 | `db-backup` sidecar (postgres:16-alpine), daily (time drifts with container restarts) | docker volume `tastease_db_backups` | **no** | `.sql.gz`, `find -mtime +7 -delete` (10 local copies, 2.3M) | yes, `{lastRun,status}` ok/failed, no `key`/`bytes` | `tastease_20261006_044326.sql.gz` 240873 B | no |
| diner-decider | 167.233.43.96 | `eeshugerman/postgres-backup-s3:16` + custom loop, daily ~00:38Z | R2 `diner-decider-photos/db-backups/` | yes | `.sql.gz`, keep newest 7 | yes, `{lastRun,status}` only, no `key`/`bytes` | `diner-decider_20261006_003816.sql.gz` 18760811 B | no |
| martialops | 178.105.239.144 | same image, 3 retries + emit-vision `backup.dump_failed` event, daily ~03:33Z; hourly host cron `check-backup-freshness.sh` | R2 `martialops-backups/db-backups/` | yes | `.sql.gz`, keep newest 7 | **none** (upload failure is log-only) | `martialops_20261006_033354.sql.gz` 13134 B | no |
| emit-vision (Postgres) | 178.105.227.175 (floating 46.225.249.8) | `pg-backup` (`infra/docker/pg-backup.sh`), **hourly** (`PG_BACKUP_INTERVAL_SECONDS=3600`) | R2 `emit-vision-backups/pg/` | yes | `.sql.gz`, `PG_BACKUPS_TO_KEEP_REMOTE=7` → **only ~7 hours offsite, not 7 days** | **none** | `pg/pg-20261006-221936.sql.gz` 67097 B | no |
| emit-vision (ClickHouse) | same | `altinity/clickhouse-backup:2.6.5` (`clickhouse-backup.sh`), daily | R2 `emit-vision-backups/full-*` | yes | native parts, `BACKUPS_TO_KEEP_REMOTE=7`, local 1 | **none** | `full-20261006-055236/` (metadata + 5 part tars, ~0.85 MB) | no |

Evidence lines (`aws s3 ls`, timestamps shown in local PDT):

```
diner-decider  2026-10-05 17:38:19   18760811 diner-decider_20261006_003816.sql.gz
martialops     2026-10-05 20:33:56      13134 martialops_20261006_033354.sql.gz
emit-vision    2026-10-06 15:19:38      67097 pg/pg-20261006-221936.sql.gz
emit-vision    2026-10-05 22:53:08       1010 full-20261006-055236/metadata.json
```

Status files on the servers:

```
develemail    /opt/develemail/.backup-status.json     {"lastRun":"2026-10-06T16:05:30Z","status":"ok"}
tastease      /opt/tastease/.backup-status.json       {"lastRun":"2026-10-06T04:43:26Z","status":"ok"}
diner-decider /opt/diner-decider/.backup-status.json  {"lastRun":"2026-10-06T00:38:22Z","status":"ok"}
martialops    (none)
emit-vision   (none)
emit-billing  (none)
emit-social   (none)
```

### Out of the Hetzner fleet

| Project | Why it isn't in the contract |
|---|---|
| immigration-app | Hosted on Render, with Postgres on **Neon** (managed, provider-side PITR). There's no server for a sidecar. |
| math-problemizer | Has a diner-decider-style R2 sidecar in `docker-compose.prod.yml` (no status file), but `docs/deploy.md` says it **has not been provisioned**. There's no server in `hcloud server list`. Bring it to the contract when it's provisioned. |

### Other findings

- `.emit-infra.json` `serverIp` for emit-vision is the floating IP `46.225.249.8`.
  `hcloud` lists the primary as `178.105.227.175`. Both reach the same host.
- emit-social's `.emit-infra.json` has no `serverIp`. Its server was found with
  `hcloud server list` (`emit-social`, 167.233.169.206).
- diner-decider stores DB dumps in its **photos** bucket (`diner-decider-photos`),
  so the app's runtime credentials can delete its backups. Sprint 364 (token scoping)
  should split this out.
- Root SSH needs `~/.ssh/emit-deploy`. The default key is refused on every host except emit-vision.

## After (verified 2026-10-06 ~22:51Z–23:25Z)

Each change was committed in its own repo, deployed with
`scripts/deploy-detached.sh --dir <repo>`, and then checked. A dump fires when
the sidecar starts, so each deploy produced a fresh object. Before each deploy,
`docker compose config --hash` was compared against the running containers' labels.
Postgres was unchanged everywhere except tastease (see notes).

Every sidecar now writes `{"lastRun","status","key","bytes"}`. A failed dump
writes `"status":"failed","key":"","bytes":0`. A failed upload writes `failed`
with the attempted key and size. The new buckets each have a bucket-scoped R2 token
(Item Read+Write), stored at `~/.emit-infra/<name>/r2-backup-token.env` (martialops pattern).
The token is in the repo's local `ci.envFile` as `BACKUP_S3_*`.

| Project | Commit | Mechanism / schedule | Destination | Offsite? | Format / retention | Status file | Fresh backup | Encrypted |
|---|---|---|---|---|---|---|---|---|
| **emit-billing** | `b7f6bb0` | new `backup` sidecar (`eeshugerman/postgres-backup-s3:16`), daily from container start | R2 `emit-billing-backups/db-backups/` | **yes** | `.sql.gz`, newest 7 | yes, full contract | `emit-billing_20261006_225103.sql.gz` 20388 B | no (364) |
| **emit-social** | `37158f8` | new `backup` sidecar, same | R2 `emit-social-backups/db-backups/` | **yes** | `.sql.gz`, newest 7 | yes, full contract | `emit-social_20261006_225834.sql.gz` 22781 B | no (364) |
| develemail | `15a3300` | `pgbackup` now on `postgres-backup-s3:16`, daily from container start | R2 `develemail-backups/db-backups/` + local volume cache | **yes** | `-Fc` `.dump`, newest 7 offsite / 7 days local | yes, full contract | `develemail-20261006_230758.dump` 595903 B | no (364) |
| tastease | `f6a2c41` | `db-backup` now on `postgres-backup-s3:16`, daily | R2 `tastease-backups/db-backups/` + local volume cache | **yes** | `.sql.gz`, newest 7 offsite / 7 days local | yes, full contract (existing `failed` branch kept) | `tastease_20261006_230151.sql.gz` 244937 B | no (364) |
| diner-decider | `77e5128` | unchanged loop, status now has `key`/`bytes` | R2 `diner-decider-photos/db-backups/` | yes | `.sql.gz`, newest 7 | yes, full contract | `diner-decider_20261006_230513.sql.gz` 18909213 B | no (364) |
| martialops | `ba1b054` | unchanged loop + retries, now writes the status file (`/opt/martialops:/host-opt`) | R2 `martialops-backups/db-backups/` | yes | `.sql.gz`, newest 7 | yes, full contract | `martialops_20261006_232436.sql.gz` 13134 B | no (364) |
| emit-vision (Postgres) | `b517244` | `pg-backup.sh`, hourly; status file and `pipefail` added | R2 `emit-vision-backups/pg/` | yes | `.sql.gz`, **168 kept = 7 days** | yes, full contract | `pg/pg-20261006-231118.sql.gz` 67080 B | no (364) |
| emit-vision (ClickHouse) | — | unchanged | R2 `emit-vision-backups/full-*` | yes | native, 7 remote | shares the Postgres status file (one per project) | `full-20261006-055236/` | no (364) |

Evidence (`aws s3 ls`, timestamps in local PDT):

```
emit-billing   2026-10-06 15:51:05      20388 emit-billing_20261006_225103.sql.gz
emit-social    2026-10-06 15:58:36      22781 emit-social_20261006_225834.sql.gz
develemail     2026-10-06 16:08:02     595903 develemail-20261006_230758.dump
tastease       2026-10-06 16:01:52     244937 tastease_20261006_230151.sql.gz
diner-decider  2026-10-06 16:05:16   18909213 diner-decider_20261006_230513.sql.gz
martialops     2026-10-06 16:24:38      13134 martialops_20261006_232436.sql.gz
emit-vision    2026-10-06 16:11:20      67080 pg-20261006-231118.sql.gz
```

Status files:

```
emit-billing   {"lastRun":"2026-10-06T22:51:06Z","status":"ok","key":"db-backups/emit-billing_20261006_225103.sql.gz","bytes":20388}
emit-social    {"lastRun":"2026-10-06T22:58:37Z","status":"ok","key":"db-backups/emit-social_20261006_225834.sql.gz","bytes":22781}
develemail     {"lastRun":"2026-10-06T23:08:04Z","status":"ok","key":"db-backups/develemail-20261006_230758.dump","bytes":595903}
tastease       {"lastRun":"2026-10-06T23:01:53Z","status":"ok","key":"db-backups/tastease_20261006_230151.sql.gz","bytes":244937}
diner-decider  {"lastRun":"2026-10-06T23:05:19Z","status":"ok","key":"db-backups/diner-decider_20261006_230513.sql.gz","bytes":18909213}
martialops     {"lastRun":"2026-10-06T23:24:43Z","status":"ok","key":"db-backups/martialops_20261006_232436.sql.gz","bytes":13134}
emit-vision    {"lastRun":"2026-10-06T23:11:20Z","status":"ok","key":"pg/pg-20261006-231118.sql.gz","bytes":67080}
```

### Check suites run per repo

Each repo's pre-push hook ran its own suite during the deploy. A failing suite
blocks the push, so every successful deploy above is a pass:

| Repo | Command (pre-push `ci.prePush`) |
|---|---|
| emit-billing | `lint`, `typecheck`, `test`, `build` |
| emit-social | `format`, `lint`, `typecheck`, `test`, `build` |
| develemail | `format`, `lint`, `typecheck`, `test`, `build` |
| tastease | `typecheck`, `build`, `test` |
| diner-decider | `lint`, `typecheck`, `build`, `test` |
| martialops | `format`, `lint`, `typecheck`, `test`, `build`, `e2e`. The first push failed in `e2e` because the local dev Postgres (`docker/docker-compose.yml`) wasn't running. It was started and the push re-run. |
| emit-vision | `lint`, `typecheck`, `check-tokens`, `i18n-audit`, `test`, `e2e`, `build` |
| emit-infra (role deletion) | `ansible-playbook --syntax-check` on `provision.yml` and `deploy.yml`, plus `pnpm test` |

### Notes

- **emit-social pre-deploy safety dump.** The deploy also shipped 16 unpushed
  sprint commits, including three additive migrations (0017–0019). A one-off
  dump went to `emit-social-backups/pre-deploy/emit-social_pre-s359_20261006_225340.sql.gz`
  (22781 B) before the deploy. It's outside `db-backups/`, so pruning won't
  touch it. emit-billing's 9 unpushed commits had no migrations.
- **tastease restarts Postgres on every deploy.** Its `postgres` service uses
  `env_file: .env`, and each deploy rewrites `BUILD_NUMBER` in `.env`. This was
  already true before this sprint, and this deploy restarted it too.
- **develemail's 02:00 scheduler never worked.** `date -d "tomorrow 02:00"`
  fails under busybox, so it had been running every 24h from container start.
  That is now explicit.
- **emit-vision's `pg-backup.sh` was hand-copied.** It was never in deploy
  `extraFiles`, so script changes didn't ship. `pg-backup.sh` and
  `Dockerfile.pg-backup` are now in `.emit-infra.json` `deploy.extraFiles`.
- `pg_dump` runs as each app's own DB user, read-only, over the compose network.
  The tokens can only touch their own bucket.

## Ansible `postgres-backup` role: deleted

No `.emit-infra.json` sets `postgres.backupBucket`. Every working backup in the
fleet is a compose sidecar that ships with the app, and the role's host cron
wrote no status file. Removed:

- `ansible/roles/postgres-backup/`;
- its entries in `ansible/playbooks/provision.yml` and `ansible/playbooks/deploy.yml`;
- its rows in `ansible/README.md`;
- the commented vars in `ansible/inventory/emit-vision.example.yml`;
- the role path in the dashboard cron panel's caption.

`ansible-playbook --syntax-check` passes on both playbooks. The CLI and dashboard
still carry the `postgres.backupBucket` config field. `setup` mints a bucket and
token for it, and `deploy` checks env and passes a var that nothing consumes now.
It is filed as a follow-up.
