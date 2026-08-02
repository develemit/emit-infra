# Fleet sweep: orphaned compose projects + tastease uptime-ping audit

Sprint 264. Dated snapshot — re-run the same commands if you need current
state; this file records what was true on 2026-08-02.

## Method

Per server: `docker compose ls -a` (all compose projects, including
stopped) + `docker ps -a --format '{{.Names}} {{.Ports}} {{.Label
"com.docker.compose.project"}}'`, cross-checked against each project's
`blueGreen.services[]` port map in `.emit-infra.json`. A container is
`orphan` if it belongs to a compose project whose name matches neither the
current project nor a known infra stack, and squats a host port the
project's blue/green scheme needs. `unknown` means a stray container was
found but it doesn't block a deploy (no squatted host port) — left in place
for the user to rule on, not removed.

## Target list

Scanned every `~/projects/*/.emit-infra.json`. Reachability was checked by
DNS resolution of `serverIp` (or `domain` when `serverIp` is absent — this
is the same fallback `deploy.ts` uses for SSH host) followed by an SSH
connectivity probe.

| Project | serverIp / domain | Reachable? |
|---|---|---|
| develemail | 178.105.171.1 | yes |
| diner-decider | 167.233.43.96 | yes |
| emit-social | social.develemit.com → 167.233.169.206 | yes |
| emit-vision | 178.105.227.175 | yes |
| tastease | 178.104.195.59 | yes |
| emit-billing | billing.develemit.com | **no** — apex has no DNS record, no `deploy.composeSrc` configured either; project appears unprovisioned, never had a server stood up |
| martialops | martialops.app | **no** — apex has no A record. `www.martialops.app` resolves to `178.156.218.94`, but that host presented an SSH host key that doesn't match `known_hosts` for that IP (changed-key warning) — a strong signal the IP has been reassigned to an unrelated box, not that it's martialops's server. Did not connect. Skipped per sprint's "skip with a note if not [reachable]" rule. |

5 of 7 config-bearing projects swept. emit-billing and martialops have no
verifiably-reachable server to inspect.

## Evidence table

| Server | Compose project | Containers | Published host ports | Verdict |
|---|---|---|---|---|
| develemail | `develemail` | postfix, postgres, pgbouncer, pgbackup, opendkim, migrate (exited) | 25, 587 (postfix) | current |
| develemail | `develemail-blue` | web, api, worker, inbound (all exited — inactive slot) | none (unpublished when inactive) | current |
| develemail | `develemail-green` | web, api, worker, inbound (running — active slot) | 3010→web, 3011→api | current |
| develemail | *(no compose project — unlabeled)* | `wonderful_bardeen` (`instrumentisto/opendkim:latest`, created 2026-06-15, `restart: no`, mounts the same `dkim-keys`/`dkim-tables` volumes as `develemail-opendkim`) | none published | **unknown** — not a deploy-blocking orphan (no host port squatted), but it's an unlabeled, non-compose container quietly running for ~6 weeks on the busiest prod box, sharing DKIM volumes with the live opendkim service. Left in place per "inspect-only on develemail unless unambiguous." Flagged for user review — likely a forgotten one-off from before the opendkim compose service existed. |
| diner-decider | `diner-decider` | redis, postgres, backup | none published | current |
| diner-decider | `diner-decider-blue` | web, api (running — active slot) | 3001→web, 5012→api | current |
| diner-decider | `diner-decider-green` | web, api (exited — inactive slot) | none | current |
| diner-decider | — | no stray projects found | — | **baseline confirmed clean** — sprint 258's `diner-blue` cleanup held; no recurrence |
| emit-social | `emit-social` | postgres | none published | current |
| emit-social | `emit-social-blue` | web, api (running — active slot) | 3000→web, 4000→api | current |
| emit-social | `emit-social-green` | web, api (exited — inactive slot) | none | current |
| emit-vision | `emit-vision` | postgres, redis, clickhouse, pg-backup, clickhouse-backup | none published | current |
| emit-vision | `emit-vision-blue` | web, api, worker, marketing (running — active slot) | 4300–4303 | current |
| emit-vision | `emit-vision-green` | web, api, worker, marketing (exited — inactive slot) | none | current |
| tastease | `tastease` (single project, `composeStructure: profiles`) | postgres, db-backup, web/marketing/api ×2 (blue exited, green running — active slot), uptime-ping, db-migrate (exited) | 3010→web, 3011→marketing, 3221→api | current |

**Zero `orphan` verdicts found anywhere in the fleet.** Nothing was removed.
The `diner-blue` landmine sprint 258 found does not recur on any other
server — every other project's compose-project naming has stayed
consistent with its current name across the blue/green history captured
here.

## tastease `uptime-ping` audit

`docker-compose.prod.yml`'s `uptime-ping` service (`alpine:3`, `restart:
unless-stopped`, `network_mode: host`) pings `$HEALTHCHECKS_URL` with
`Authorization: Bearer $EMIT_VISION_API_KEY`, swallowing all output via
`|| true` — the same silent shape sprint 261 found and killed in
emit-vision's `dms-ping`.

Checked without ever printing the secret value:

- `HEALTHCHECKS_URL`: present, 48 characters, resolves to
  `https://api.emitvision.com/<redacted-path>` (this is emit-vision's own
  ping-receiver endpoint, not a healthchecks.io URL despite the variable
  name).
- `EMIT_VISION_API_KEY`: present, 36 characters.
- `MARKETING_PULSE_URL` (the service's secondary check): present.
- Replayed the exact request the container's entrypoint sends (`wget`
  with the same `Authorization` header, same URL, from inside the running
  container) → **`HTTP/1.1 200 OK`**. Without the auth header the same
  endpoint returns `401 Unauthorized`, confirming the header is what makes
  it succeed — the ping is genuinely landing, not silently failing like
  emit-vision's was.

**Verdict: genuinely configured and pinging a live check.** Per the
decision rule, left alone — no compose changes, no `requiredEnvKeys`
changes, no backlog note. `HEALTHCHECKS_URL` and `EMIT_VISION_API_KEY` were
already in tastease's `requiredEnvKeys`.

## Post-sweep health

No orphans were removed, so no server needed a post-removal health
recheck. All five active-slot health checks were confirmed healthy
(`(healthy)` in `docker ps -a`) at inspection time above. A retag-only
develemail deploy was run separately to prove the sweep didn't regress the
deploy path — see the sprint's completion notes for the run details.

## Out of scope / follow-ups

- The develemail `wonderful_bardeen` container: not removed, not this
  sprint's call — flagged above for the user.
- emit-billing and martialops have no reachable server; no sweep was
  possible. Not a finding about orphans, just an access gap.
- Automated orphan detection (CLI/dashboard tooling): not built — this was
  a one-time manual sweep and it found zero orphans outside the one
  sprint 258 already fixed, so automating doesn't look justified yet.
