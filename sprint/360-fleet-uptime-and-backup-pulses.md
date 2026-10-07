# Fleet uptime and backup pulses from each server, independent of the Mac
**Difficulty:** 4

## Goal
Every prod server runs a small cron script, managed by a new Ansible role
`fleet-pulse`, that every 5 minutes:
- curls the app's public health URL and pings emit-vision pulse
  `<project>-uptime`, success or `/fail`;
- reads `/opt/<project>/.backup-status.json` and pings `<project>-backup`.

emit-vision emails the user when any check goes missing or fails, whether or
not the Mac is awake.

## Reason
Today downtime and backup alerting runs only on the Mac (sprint 358 now
tells us when the Mac is gone, but not what broke while it was gone). Pulses
sent from the servers themselves mean:
- a dead server is noticed as a missing heartbeat;
- a dead app or broken TLS is noticed as `/fail`;
- a stale or failed backup is noticed;
all without the laptop. Together with 358 this closes the "monitoring is a
laptop" single point of failure.

## Context
- **Pulse API and helper:** see sprint 358 (`apps/api/src/lib/pulse.ts`,
  `.emit-vision.json`). The pulse checks live in the **emit-infra**
  emit-vision project, using its ingest key (`EMIT_VISION_INGEST_KEY` in
  `apps/api/.env`).
- **Ingest key on servers:** the key can only write telemetry and pings, so
  putting it on servers is acceptable. Store it in
  `/etc/emit-fleet-pulse.env` (0600, root), **not** the app `.env`, because
  deploys overwrite the app `.env` from the project's local `ci.envFile`.
- **Slugs:** `<project>-uptime` with interval 300 and grace 600, and
  `<project>-backup` with interval 86400 and grace 7200. Create them with
  `emit-vision pulse init` and give each an email channel (see 358 for how).
- **Health URL:** `config.healthCheck.url` in each project's
  `.emit-infra.json` (the Mac monitor already uses it). Projects without one
  get uptime = "nginx answers on https://<domain>/" and are recorded as such.
  Curling the public URL from the server itself exercises nginx, TLS and the
  app. It can't detect an upstream network partition; that's a known limit,
  so note it in `docs/MONITORING.md`.
- **Backup ping logic:**
  - status `ok` and `lastRun` under 26h → success;
  - status `failed`, or `lastRun` stale → `/fail`;
  - **no status file → no ping.** The check then goes missing and alerts,
    which is correct after sprint 359. Projects without a DB get no backup
    check at all.
  - Only ping the backup check once per hour, not every 5 minutes, to keep
    noise down.
- **Running Ansible against prod:** `runAnsible()` in
  `packages/core/src/ansible.ts` only accepts `'provision' | 'deploy'`, and
  `emit-infra configure` runs the whole provision playbook. Servers have
  drifted from Ansible (`docs/nginx-vhost-audit.md`,
  `docs/FLEET-SWEEP-2026-08.md`), so **don't run full provision on prod**.
  Instead:
  - widen the playbook type to include `'fleet-pulse'`;
  - add `ansible/playbooks/fleet-pulse.yml` (role only);
  - add `emit-infra configure --only <playbook>`, validated against an
    allowlist.
  Sprints 365–366 reuse this.
- **Stale CLI dist:** hooks and the CLI run `apps/cli/dist`. Run `pnpm build`
  before using `emit-infra configure --only` from other repos.
- **Script style:** POSIX sh or bash, in the role's `files/` or `templates/`.
  It needs a shell test in `scripts/lib/` (pattern: `ensure-cert-renewal.test.sh`)
  wired into the `test:hooks` script in root `package.json`.

## Tasks
1. Write the `fleet-pulse` role:
   - template `/usr/local/bin/emit-fleet-pulse` (project, health URL, slugs);
   - env file;
   - cron every 5 minutes, logging to `/var/log/emit-fleet-pulse.log` with
     logrotate.
2. Widen `runAnsible`'s playbook type. Add `configure --only`. Add the
   `fleet-pulse.yml` playbook.
3. Create the pulse checks for every fleet server, with email channels.
4. Roll out to each server with `emit-infra configure --only fleet-pulse`,
   run from each project repo.
5. Verify `emit-vision pulse status` shows every check healthy.
6. Kill test on one low-stakes server (e.g. tastease): `ssh` in and
   `chmod -x /usr/local/bin/emit-fleet-pulse` for longer than 15 minutes,
   confirm the email arrives, then restore it.
7. Update `docs/MONITORING.md` with the per-server pulses.

## Files involved
- new: `ansible/roles/fleet-pulse/{tasks/main.yml,templates/emit-fleet-pulse.sh.j2,templates/logrotate.j2}`
- new: `ansible/playbooks/fleet-pulse.yml`
- `packages/core/src/ansible.ts` (+ `ansible.test.ts`): playbook union
- `apps/cli/src/commands/configure.ts` (+ `configure.test.ts`): `--only`
- new: `scripts/lib/fleet-pulse.test.sh`; root `package.json` `test:hooks`
- `docs/MONITORING.md`

## Acceptance criteria
- [x] `fleet-pulse.test.sh` covers:
  - health 200 → success URL;
  - health 5xx → `/fail`;
  - backup ok and fresh → success;
  - backup failed or stale → `/fail`;
  - no status file → no backup ping;
  - backup pinged at most hourly.
- [x] `configure.test.ts` covers that `--only fleet-pulse` passes the right
      playbook and that an unknown playbook is rejected. `ansible.test.ts`
      covers the new playbook path.
- [x] Every fleet server shows healthy uptime and backup checks in emit-vision.
- [x] The kill-test email was received (the user confirmed).
- [x] Root `package.json` changed, so the **full suite** passes: `pnpm test`,
      `pnpm typecheck`, `pnpm lint` and `pnpm test:hooks`.

## Out of scope
- Replacing the Mac monitor. It stays, for rich metrics, the dashboard and
  cert/disk rules.
- Multi-region external probing.

## Completed

**Date:** 2026-10-06

### Summary
Added the `fleet-pulse` Ansible role (templated `/usr/local/bin/emit-fleet-pulse`, 0600 env file at `/etc/emit-fleet-pulse.env`, 5-minute cron, logrotate), a `fleet-pulse.yml` playbook, a widened `AnsiblePlaybook` type, and `emit-infra configure --only <playbook>` with an allowlist (currently `fleet-pulse`) so prod servers never get a full provision run. Uptime pulses go every 5 minutes; backup pulses at most hourly, and no status file means no ping.

Rolled out to all 7 fleet servers; 14 pulse checks were created with an email channel and `emit-vision pulse status` showed all 15 checks `up`. The role installs curl only when missing because emit-vision's apt sources are broken (docker.asc Signed-By conflict). Kill test on tastease (`chmod -x` at 00:20:45Z) took the check `late`, then `down` at ~00:36Z, and the user confirmed the alert email arrived.

### Files changed
- (new) `ansible/roles/fleet-pulse/` — tasks, defaults, script and logrotate templates
- (new) `ansible/playbooks/fleet-pulse.yml` — role-only playbook
- (new) `scripts/lib/fleet-pulse.test.sh` — 9 checks
- `packages/core/src/ansible.ts`, `ansible.test.ts`, `index.ts` — playbook union, test, export
- `apps/cli/src/commands/configure.ts`, `configure.test.ts` — `--only` flag and tests
- `package.json` — `test:hooks` runs the new shell test
- `docs/MONITORING.md` — per-server pulses section and the partition limit
- `sprint/360-fleet-uptime-and-backup-pulses.md` — this record

### Verification
- `pnpm test`: pass (nx cache hit; inputs unchanged since the last full run)
- `pnpm typecheck`: clean; `pnpm lint`: clean
- `pnpm test:hooks`: all pass, fleet-pulse 9/9
- Full-suite scope because root `package.json` changed.
- Rollout and kill test verified live in emit-vision; email receipt confirmed by the user.

### Follow-ups
- `[defer]` The kill-test alert email body is missing details ("Project:" blank, "Condition: undefined < 0 in 0m"). It is an emit-vision template bug, already backlogged and being fixed in that repo.
- `[defer]` emit-vision's apt sources are broken (docker.asc Signed-By conflict); fix on the server.
