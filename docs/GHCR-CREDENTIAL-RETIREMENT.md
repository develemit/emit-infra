# Retiring persistent GHCR credentials from fleet servers

Sprint 320. Dated snapshot of the fleet's readiness — re-run the prerequisite
check per server before acting on this; it will go stale the moment any
project completes its first post-317.3 deploy.

## Background

Before sprint 317, `deploy-blue-green.yml` had no `docker login` task, so
every project needing private-image pulls was unblocked with a one-time
manual `docker login` on the server. That wrote base64 of
`develemit:gho_<token>` into `/root/.docker/config.json` — the operator's `gh`
OAuth session, scoped `repo` (full read/write to every private repo on the
account) — into a file that sits indefinitely on an internet-facing host.

Sprint 317 added a login task to the blue-green path. Sprint 317.3 made that
login write to an ephemeral `/root/.docker-ghcr-<project>` directory instead
of the default config path, and removed it in an `always:` block regardless
of deploy outcome
(`ansible/roles/app-deploy/tasks/deploy-blue-green.yml:28-63`). Between them,
a deploy no longer needs a persistent credential and no longer writes one
back. This sprint is the migration: log each server out and prove the
per-deploy path actually works before the persistent file is gone for good.

## Status as of 2026-08-27T07:47Z (sprint 320's first run)

**No server was touched.** Every project in the fleet failed the second
prerequisite below, so every one was skipped per the sprint's own gating
rule. This is expected, not a failure: 317.3 landed at
`2026-08-27T07:39:42-07:00` (commit `a1c8a18`), 8 minutes before this sprint
ran, and no project had deployed since.

| Project | serverIp source | Last deploy (`.deploy-status.json`) | Post-317.3? | Verdict |
|---|---|---|---|---|
| develemail | `.emit-infra.json` (178.105.171.1) | 2026-08-26T05:33:29Z, deployed | no | skip |
| diner-decider | `.emit-infra.json` (167.233.43.96) | 2026-08-27T07:38:06Z, **failed** | no (and failed anyway) | skip |
| emit-billing | `.emit-infra.json` (167.233.158.240) | 2026-08-13T19:10:53Z, deployed | no | skip |
| emit-vision | `.emit-infra.json` (46.225.249.8) | 2026-08-26T04:48:53Z, deployed | no | skip |
| martialops | `.emit-infra.json` (178.105.239.144) | 2026-08-26T07:24:46Z, deployed | no | skip |
| tastease | `.emit-infra.json` (178.104.195.59) | 2026-08-27T05:24:58Z, deployed | no | skip |
| emit-social | `.env.prod` `SERVER_IP` (167.233.169.206) — no `serverIp` key in `.emit-infra.json`, confirmed live via `emit-infra status` | 2026-08-27T04:46:38Z, deployed | no | skip |

All seven projects use `blueGreen` deploys (confirmed via
`.emit-infra.json`), so all seven are in scope once they clear the
prerequisite — none are on `deploy-standard.yml`, which already did
login-per-deploy before this work existed.

No `docker logout`, no credential removal, and no deploys were run against
any server during this pass. Re-run the per-server procedure below once a
project shows a **successful** deploy timestamped after 317.3 landed.

## Prerequisites (verify per server, do not assume)

1. `ansible/roles/app-deploy/tasks/deploy-blue-green.yml` contains the GHCR
   login task (`grep -c "Login to GHCR"` → 1). True fleet-wide since this is
   emit-infra's own shared role, not per-project config.
2. That project's `.deploy-status.json` shows `"status": "deployed"` with a
   `finishedAt` **after** 317.3 landed (`2026-08-27T00:39:42-07:00` /
   `2026-08-27T07:39:42Z`). This is the bar that actually matters — it proves
   the ephemeral login path pulled real images successfully, not just that
   the task exists.

If either is unmet, skip that project and record the reason — don't guess
based on 317 alone; 317 without 317.3 still writes the credential back
permanently on the next deploy (see "Verifying" below).

## Per-server procedure

Do **not** batch this across the fleet — one server at a time, confirm each
before moving to the next.

1. `ssh <host> "cp /root/.docker/config.json /root/.docker/config.json.bak-$(date +%Y%m%d%H%M%S)"`
   — timestamped backup before touching anything. Record the path.
2. `ssh <host> "docker logout ghcr.io"` — rewrites `config.json`, does not
   delete it.
3. Run a real deploy for that project (`emit-infra deploy` from the project
   directory, or however that project normally deploys).
4. Confirm the deploy's pulls succeeded — check the deploy log for the image
   pull step, not just the final "deployed" status.
5. Check `config.json` for a `ghcr.io` key under `.auths` — compare by key
   presence, never print or log the auth blob:
   ```bash
   ssh <host> "docker --config /root/.docker inspect-config 2>/dev/null; \
     node -e \"const c=require('/root/.docker/config.json'); \
     console.log('ghcr.io' in (c.auths||{}))\""
   ```
   or simpler: `jq '.auths | has("ghcr.io")' /root/.docker/config.json` if
   `jq` is on the host. Expect `false` — with 317.3 landed, nothing writes
   back to the default path anymore (see "Verifying" below).
6. Only once confirmed, remove the backup — or leave it and note the path in
   the sprint's completion record.

**If step 3 fails:** restore the backup immediately
(`cp /root/.docker/config.json.bak-<ts> /root/.docker/config.json`) and stop
the whole sprint run — don't continue to the next server.

## Verifying the file is gone and stays gone

`docker logout ghcr.io` rewrites `config.json`, it doesn't delete it — check
the `ghcr.io` auth entry specifically, not file presence/absence.

With 317.3 landed, the login task writes to
`/root/.docker-ghcr-<project>/config.json` and that directory is removed in
an `always:` block after every deploy, success or failure. So the correct
post-deploy state on `/root/.docker/config.json` (the default path) is: **no
`ghcr.io` entry at all.**

If a `ghcr.io` entry reappears in the default config after a deploy, that is
a **regression in 317.3**, not expected behavior — do not wave it through.
Halt and investigate the login task's `--config` flag and the `always:`
cleanup block in `deploy-blue-green.yml`.

## Rollback

Restoring the timestamped backup (`cp <backup> /root/.docker/config.json`)
re-establishes the persistent credential exactly as it was — this is a
config-file swap, not a credential re-mint, so it's safe to do without
touching GitHub. This is the same pattern used for the 2026-07-24 develemail
`INBOUND_SECRET` and diner-decider R2 remediations.

## Out of scope

- Rotating or revoking the underlying `gh` OAuth token. It remains
  broad-scope (`repo`) regardless of where it's stored; narrowing that is
  the deferred GitHub App work (backlog). This sprint only changes the
  token's lifetime and location, not its scope.
- Any emit-infra code change — 317 and 317.3 own those; this sprint is
  fleet operations only.
