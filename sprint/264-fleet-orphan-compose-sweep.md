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
- [ ] Evidence table in `docs/FLEET-SWEEP-2026-08.md` covers every reachable
      server, every compose project on it, and a verdict for each
- [ ] Zero `orphan` verdicts remain unresolved: each is removed (with
      before/after evidence) or explicitly downgraded to `unknown` for user
      review
- [ ] No `unknown` was removed
- [ ] tastease `uptime-ping`: truth determined and acted on per the decision
      rule; no secret values printed (hash/emptiness only)
- [ ] Post-sweep health: every touched server's project passes its health
      check; retag-only develemail deploy completes clean
- [ ] Test coverage: no emit-infra source changes expected — if any happen,
      colocated tests included; `pnpm test:hooks` and nx
      typecheck/lint/test remain green; tastease CI (its pre-push hook)
      green on any tastease commit
- [ ] Diner-decider re-verified clean (baseline confirmation)

## Out of scope
- Building automated orphan detection into the CLI/dashboard (worth a backlog
  note if the sweep finds more than one — manual once, automate if it's a
  pattern)
- The self-hosted DMS replacement (`[discovery]` backlog item)
- Any non-Docker server hygiene (nginx vhosts etc. — sprint 262 territory)
- martialops work beyond a read-only look if its server is reachable
