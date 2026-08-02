# Fleet sweep: orphaned compose projects squatting ports + tastease uptime-ping audit
**Difficulty:** 3

## Goal
Every fleet server is verified free of orphaned Docker Compose projects that
could block a blue/green deploy, with a per-server evidence table; tastease's
silent `uptime-ping` gets the same honest treatment emit-vision's `dms-ping`
got. No deploy should ever again fail on a landmine we could have found by
looking.

## Reason
Sprint 258 found live orphaned `diner-blue` containers on diner-decider's
server — remnants of a historical compose-project rename, invisible to
`docker compose --remove-orphans` (which only sees the *current* project
name), squatting the blue-slot ports. Every future blue-slot deploy there
would have failed, and it was only discovered because a deploy happened to
exercise it. Any server that went through a similar rename may carry the same
landmine, and the whole point of the 252–257 deploy-perf initiative is that
deploys are routine — a routine that randomly hits a squatted port isn't.
Separately, sprint 261's fleet grep found tastease's `uptime-ping` service has
the exact silent-empty-URL shape that made emit-vision's dead man's switch a
three-week no-op.

## Context
- **The failure mode** (from sprint 258's completion notes): an old compose
  project under a previous name (e.g. `diner-blue` vs the current project
  name) keeps containers running with `restart: unless-stopped`. They hold
  host ports that the current project's blue or green slot needs.
  `--remove-orphans` doesn't touch them because they belong to a different
  compose project. Detection: `docker compose ls -a` (lists all compose
  projects) + `docker ps -a --format '{{.Names}} {{.Ports}} {{.Label
  "com.docker.compose.project"}}'`, cross-checked against the project's
  expected port set.
- **Expected ports per project** come from `blueGreen.services[]` in each
  project's `.emit-infra.json` (`bluePort`/`greenPort` per service), plus
  whatever the infra stack (postgres, redis, etc.) legitimately binds.
  Anything bound by a compose project whose name matches neither the current
  project nor its known infra stack is a suspect.
- **Servers to sweep** — every project under `~/projects/` with an
  `.emit-infra.json` that names a server. As of 2026-08-01 that is:
  develemail, emit-vision, diner-decider (sprint 258 cleaned it — re-verify
  as the known-good baseline), tastease, emit-social. martialops and any
  other config-bearing project: include if a reachable server is configured,
  skip with a note if not. SSH: key from `sshKeyName` in each config
  (`~/.ssh/<sshKeyName>`), user `root` (per ansible inventory convention;
  emit-vision confirmed `root` on 2026-08-01 — `deploy@` was rejected).
- **Inspection is safe; removal is not.** The sweep itself is read-only.
  Removing an orphan is destructive and must be per-container deliberate:
  confirm the compose project it belongs to is genuinely defunct (not some
  manually-started tool someone relies on), record image/name/ports/uptime
  in the evidence table, then `docker compose -p <old-name> down` (or
  `docker rm` for strays). Never touch containers belonging to the current
  project's active slot — check which slot is live first
  (`/opt/<project>/` active-slot file or nginx upstream, per the blue-green
  script's convention).
- **tastease `uptime-ping`** (`tastease/docker-compose.prod.yml`, ~line 163):
  pings `$$HEALTHCHECKS_URL` via `env_file: .env` with `|| true` — the same
  silent shape sprint 261 killed in emit-vision. tastease declares
  `HEALTHCHECKS_URL` in its `requiredEnvKeys`. Determine the truth on the
  server (value present? by hash/emptiness only — never print it; do pings
  actually land?). Decision rule, per the user's 2026-08-01 healthchecks.io
  deferral: if it is genuinely configured and pinging a live check, leave it
  alone and record that; if it's empty or dead, retire the service from the
  compose file (mirroring emit-vision's sprint-263 treatment — retire, don't
  crash-loop) and drop the key from `requiredEnvKeys`, filing the note to
  the self-hosted DMS `[discovery]` backlog item.
- The develemail server is also the busiest production box (live mail flow,
  DKIM keys written at runtime under `infra/opendkim/`) — inspect-only there
  unless an orphan is unambiguous.

## Tasks
1. Build the target list by scanning `~/projects/*/.emit-infra.json` for
   server + `sshKeyName`; note any project skipped and why.
2. Per server, capture: `docker compose ls -a`, the full `docker ps -a`
   format above, and the project's expected port set from config. Assemble
   the evidence table (server × compose-project × ports × verdict:
   current / infra / orphan / unknown).
3. For each orphan: record evidence, verify the active slot isn't involved,
   remove it, and re-run the health checks for that server's project
   (`healthCheck.url` where configured, container status otherwise).
4. For each `unknown`: do not remove; describe it in the completion notes for
   the user to rule on.
5. tastease `uptime-ping` audit and resolution per the decision rule above;
   commit any tastease changes in the tastease repo.
6. Write the evidence table into `docs/FLEET-SWEEP-2026-08.md` in emit-infra
   (a dated snapshot doc, like `docs/DEPLOY-FLOOR.md`).
7. Prove no deploy regressed: one retag-only develemail deploy
   (`sprint/*.md`-only commit + `EMIT_FORCE_DEPLOY=1` push) completes clean,
   and any server where an orphan was removed passes its health check.

## Files involved
- `docs/FLEET-SWEEP-2026-08.md` — new; evidence table + verdicts
- `~/projects/tastease/docker-compose.prod.yml` — possible `uptime-ping`
  retirement
- `~/projects/tastease/.emit-infra.json` — possible `requiredEnvKeys` change
- Fleet servers — inspection everywhere; removals only per task 3's rules
- emit-infra `backlog.md` — tastease note appended to the DMS discovery item
  if retirement path taken

## Acceptance criteria
- [x] Evidence table in `docs/FLEET-SWEEP-2026-08.md` covers every reachable
      server, every compose project on it, and a verdict for each
- [x] Zero `orphan` verdicts remain unresolved: each is removed (with
      before/after evidence) or explicitly downgraded to `unknown` for user
      review
- [x] No `unknown` was removed
- [x] tastease `uptime-ping`: truth determined and acted on per the decision
      rule; no secret values printed (hash/emptiness only)
- [x] Post-sweep health: every touched server's project passes its health
      check; retag-only develemail deploy completes clean
- [x] Test coverage: no emit-infra source changes expected — if any happen,
      colocated tests included; `pnpm test:hooks` and nx
      typecheck/lint/test remain green; tastease CI (its pre-push hook)
      green on any tastease commit
- [x] Diner-decider re-verified clean (baseline confirmation)

## Completed

**Date:** 2026-08-02

### Summary
Swept every fleet server with a reachable, config-bearing project
(develemail, diner-decider, emit-social, emit-vision, tastease) for
orphaned Docker Compose projects squatting host ports — the failure mode
sprint 258 found on diner-decider (`diner-blue` surviving a project
rename, invisible to `--remove-orphans`). **Result: zero orphans found
anywhere in the fleet.** Sprint 258's diner-decider cleanup held as the
clean baseline, and it hasn't recurred on any other server — every
project's blue/green compose-project naming stayed consistent with its
current project name.

One stray was found: an unlabeled, non-compose `wonderful_bardeen`
container on develemail (opendkim image, `restart: no`, created
2026-06-15, sharing the `dkim-keys`/`dkim-tables` volumes with the live
`develemail-opendkim` service). It doesn't publish any host port, so it
isn't a deploy-blocking orphan and doesn't meet this sprint's removal bar
— left running and flagged `unknown` in the evidence doc for the user to
rule on, per the rule that develemail (busiest prod box, live mail flow)
is inspect-only unless an orphan is unambiguous.

emit-billing and martialops were skipped: emit-billing's domain has no
DNS record at all and no `deploy.composeSrc` configured (never
provisioned). martialops's apex domain doesn't resolve either; the only
resolving hostname (`www.martialops.app`) pointed at an IP whose SSH host
key didn't match `known_hosts`, a strong signal the IP has been
reassigned to an unrelated box — did not connect rather than risk talking
to the wrong server.

tastease's `uptime-ping` audit: replayed the exact ping request the
container's entrypoint sends (same URL, same `Authorization: Bearer
$EMIT_VISION_API_KEY` header) from inside the running container and got
`200 OK` — the ping genuinely lands. (Without the header, the same
endpoint 401s, confirming the auth is what makes it succeed — this isn't
a coincidental 200.) Unlike emit-vision's `dms-ping`, this one is not
silently broken, so per the decision rule it was left alone with no
compose or `requiredEnvKeys` changes. No secret values were ever printed
— only presence, byte length, and the URL's host component were checked.

Proved the sweep didn't regress the deploy path with a real retag-only
develemail deploy (`sprint/999-*.md`-only marker commit +
`EMIT_FORCE_DEPLOY=1 git push`, mirroring sprint 253's methodology):
completed in 1:57, all four services (web/api/worker/inbound) came up
healthy on the blue slot, nginx switched cleanly. Removed the marker with
a second commit + forced push (build 577) to prove the reverse direction
too — also clean, green slot healthy.

### Files changed
- (new) `docs/FLEET-SWEEP-2026-08.md` — full evidence table, target-list
  reachability notes, and the tastease uptime-ping audit writeup
- `sprint/264-fleet-orphan-compose-sweep.md` — this file

### Verification
- `docker compose ls -a` + `docker ps -a` on all 5 reachable servers:
  captured, cross-checked against each project's `blueGreen.services[]`
  port map — zero orphans, one `unknown` (develemail stray, left in
  place)
- tastease uptime-ping: replayed real ping request from inside the
  container → `200 OK` with auth header, `401` without — confirms live
  and landing
- Retag-only develemail deploy (build 576): 1:57 total, web/api healthy
  on attempt 1-2, active slot green→blue
- Reverse marker-removal deploy (build 577): 1:59 total, active slot
  blue→green, all four services healthy
- `pnpm test:hooks`: 36/36 pass
- `git status --porcelain` in emit-infra: only the sprint file and the new
  doc touched — no source changes, so nx typecheck/lint/test weren't
  triggered (nothing affected)
- tastease: no commits made (uptime-ping left unchanged), so no pre-push
  hook run was needed there
- diner-decider: `docker compose ls -a` shows only `diner-decider`,
  `diner-decider-blue`, `diner-decider-green` — no `diner-blue` recurrence,
  baseline confirmed clean

### Follow-ups
- `[defer]` develemail's `wonderful_bardeen` container (opendkim image,
  unlabeled, no compose project, running ~6 weeks, shares DKIM volumes
  with the live opendkim service) — not removed, needs a human call since
  it doesn't block deploys but its origin is unclear. Evidence in
  `docs/FLEET-SWEEP-2026-08.md`.
- `[defer]` emit-billing has no server provisioned at all (no DNS, no
  `deploy` config) — if it's meant to be live, that's a bigger gap than
  this sprint's scope; if it's intentionally unprovisioned, no action
  needed.
- `[defer]` martialops's apex domain doesn't resolve and its only
  resolving hostname points at a host with a mismatched SSH key —- worth
  checking DNS/server records aren't stale, but not urgent since nothing
  indicates martialops traffic is currently being served incorrectly.

## Out of scope
- Building automated orphan detection into the CLI/dashboard (worth a backlog
  note if the sweep finds more than one — manual once, automate if it's a
  pattern)
- The self-hosted DMS replacement (`[discovery]` backlog item)
- Any non-Docker server hygiene (nginx vhosts etc. — sprint 262 territory)
- martialops work beyond a read-only look if its server is reachable
