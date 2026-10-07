# Monitoring

When an alert is real, follow [`DISASTER-RECOVERY.md`](DISASTER-RECOVERY.md).

## What watches what

| Watcher | Watches | Runs on |
|---|---|---|
| Status monitor (`apps/api/src/lib/status-monitor.ts`) | SSH, HTTP health, disk, memory, certs, backups of every fleet project, every 60 s | the Mac, inside the local API (launchd) |
| emit-vision pulse `emit-infra-monitor` | the status monitor itself | emit-vision (46.225.249.8) |

The monitor pings `https://api.emitvision.com/v1/pulse/emit-infra-monitor`
after every poll (`pingPulse` in `apps/api/src/lib/pulse.ts`): success if at
least one project probe completed, `/fail` if the project list is empty.
The check expects a ping every 60 s with 300 s grace. If the Mac sleeps
(lid closed), loses network, or the API dies, no ping arrives and emit-vision
emails emitdutcher@gmail.com.

Pings are best-effort (5 s timeout, never throw). Without
`EMIT_VISION_INGEST_KEY` in `apps/api/.env` the ping is a no-op and one
warning is logged at startup.

## Channels

- **Push** (Web Push via the dashboard): outage / recovery / alert-rule notifications.
- **Email** (develemail): same notifications, styled; see `apps/api/.env.example`.
- **emit-vision pulse email**: dead-man's switch only; fires when the monitor
  itself goes quiet. The email channel was set through the pulse-admin API
  (`PATCH /v1/projects/<id>/pulse-checks/<checkId>` with the CLI's PAT),
  because `emit-vision pulse init` has no channel flag.

## Cross-monitoring gap

emit-vision's own server (46.225.249.8) is in the fleet the Mac watches, and
emit-vision watches the Mac. If both are down at once (Mac asleep and
emit-vision down), nobody alerts. Accepted for now.

## Silencing during planned downtime

Pause or disable the check so the dead-man's switch doesn't fire:

```bash
emit-vision pulse list --json          # find the check id
PAT=$(node -e 'console.log(require(process.env.HOME+"/.emit-vision/config.json").pat)')
curl -X PATCH "https://api.emitvision.com/v1/projects/<projectId>/pulse-checks/<checkId>" \
  -H "Authorization: Bearer $PAT" -H 'content-type: application/json' -d '{"enabled":false}'
```

Re-enable with `{"enabled":true}` afterwards. The project id is in
`.emit-vision.json`. `pnpm launch:stop` alone does not silence it.

## Per-server pulses (sprint 360)

Each prod server runs `/usr/local/bin/emit-fleet-pulse` from root cron every
5 minutes (role `ansible/roles/fleet-pulse`), so alerting works while the Mac
is asleep or gone.

| Check slug | Interval / grace | Sent when |
|---|---|---|
| `<project>-uptime` | 300s / 600s | every run: success on a 2xx/3xx from the health URL, `/fail` otherwise |
| `<project>-backup` | 86400s / 7200s | at most hourly, from `/opt/<project>/.backup-status.json`: success if `status` is `ok` and `lastRun` is under 26h old, `/fail` otherwise |

- No status file means no backup ping, so the check goes missing and alerts. Projects without a DB get no backup check.
- Health URL is `config.healthCheck.url`, falling back to `https://<domain>/` (nginx answering).
- The ingest key lives in `/etc/emit-fleet-pulse.env` (0600), not the app `.env`, because deploys overwrite the app `.env`. It is read from `EMIT_VISION_INGEST_KEY` in the local environment when the playbook runs.
- Logs: `/var/log/emit-fleet-pulse.log` (logrotate weekly, 4 kept).
- Known limit: the server curls its own public URL, so this exercises nginx, TLS and the app but cannot detect an upstream network partition.
- Roll out or update with `pnpm build && emit-infra configure --only fleet-pulse` from the project repo. Don't run full provision on prod.
