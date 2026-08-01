# emit-vision's dead man's switch has never pinged anything — make it fail loudly
**Difficulty:** 3

> _Promoted from the sprint-115 backlog item plus a live discovery during the 2026-08-01 follow-up scan._

## Goal
emit-vision's `dms-ping` container either pings a real healthchecks.io check or fails loudly, and `HEALTHCHECKS_URL` is declared in `requiredEnvKeys` so the existing empty-value drift detection catches this class of bug on every project.

## Reason
The dead man's switch is running, looks healthy, and has never sent a single ping. Verified live on `178.105.227.175` on 2026-08-01.

The container's loop is:

```sh
while true; do
  if wget -qO- --timeout=10 "http://api:4301/readyz" > /dev/null 2>&1; then
    wget -qO- "" > /dev/null 2>&1 || true          # HEALTHCHECKS_URL is empty
  else
    echo "[dms-ping] API health check failed — skipping ping"
    wget -qO- "/fail" > /dev/null 2>&1 || true     # also empty
  fi
  sleep 300
done
```

`docker inspect` reports **`HEALTHCHECKS_URL=`** — empty. Compose substituted an unset variable with an empty string, so `wget -qO- ""` is a silent no-op on *both* branches, and `|| true` swallows the failure. The container reports `Up`, the health probe genuinely works (`api:4301/readyz` is reachable; the entire log history is a single line from 15 seconds after boot, before the API finished starting, and zero failures in the last 24 hours), and nothing anywhere indicates the switch is inert.

This is worse than having no dead man's switch: it is a monitoring component that provides false assurance. If emit-vision went down, nothing would fire.

The root cause is the backlog item from sprint 115, still open: the container was deployed but the healthchecks.io check was never created and the URL never set. The `[manual ops]` half was never done, and nothing surfaced that.

**Why the existing tooling missed it.** Sprint 239 added empty-value detection to the secrets-drift route precisely for this failure mode, and sprint 243 declared `requiredEnvKeys` across the fleet. But emit-vision's `requiredEnvKeys` (36 entries) does not include `HEALTHCHECKS_URL` — so the key is invisible to the very detector built to catch it. Declaring it turns this from a one-off fix into something the fleet tooling enforces.

## Context
- **`ci.envFile` is the deploy source of truth.** emit-vision's is `infra/secrets.prod.env`. Setting `HEALTHCHECKS_URL` only in the server's `/opt/emit-vision/.env` will be overwritten on the next deploy — the value must go in the repo's env file. This exact regression has bitten this fleet before.
- **Creating the healthchecks.io check is a manual, outward-facing action** requiring account access: a check with a 15-minute period and 5-minute grace, per the sprint-115 backlog item. A sprint runner cannot do this unattended. **If the check does not already exist, do the code-side work — the guard, the `requiredEnvKeys` declaration, the tests — and halt as `blocked` naming the check creation as the outstanding item.** Do not invent a URL, and do not skip the code work just because the manual half is pending.
- **The fail-loudly change is the durable part** and is fully automatable regardless of whether the check exists. Options, in rough preference order: refuse to start when `HEALTHCHECKS_URL` is empty (loudest, and correct for a component whose only job is pinging); or log a clear warning every cycle rather than `|| true`-ing into silence. Prefer failing at startup — a crash-looping container is visible in the dashboard, whereas a warning in logs nobody reads reproduces the current problem.
- **Compose lives in emit-vision, not here.** The service is defined in `~/projects/emit-vision/infra/docker/docker-compose.infra.yml` (referenced from `.emit-infra.json` as `deploy.composeSrc`). Changes there ship via the normal emit-vision deploy.
- **Check the rest of the fleet for the same shape.** Any `${VAR}` in a compose file that silently degrades to empty is the same bug. `dms-ping` is the known instance; a quick grep across the fleet's compose files for interpolations without `:?` or `:-` defaults is worth doing, and anything found should be reported even if fixing it is out of scope here.
- Read the `## Completed` sections of sprints **239** (empty-value drift detection) and **243** (the `requiredEnvKeys` fleet rollout) — this sprint closes the gap between them.

## Tasks
1. Confirm the current state before changing anything: `HEALTHCHECKS_URL` empty in the container, ping URL therefore a no-op, and the health probe itself working. Record the evidence.
2. Change the `dms-ping` service so an empty `HEALTHCHECKS_URL` fails loudly at startup rather than no-oping.
3. Add `HEALTHCHECKS_URL` to emit-vision's `requiredEnvKeys` in `.emit-infra.json` so the sprint-239 empty-value detector covers it.
4. Add the key to `infra/secrets.prod.env` (the `ci.envFile`), not just the server `.env`.
5. If a healthchecks.io check already exists, wire in its real URL and verify a ping actually lands. If not, halt as `blocked` naming check creation as the outstanding manual step — with tasks 2-4 completed and committed.
6. Grep the fleet's compose files for other `${VAR}` interpolations that would silently degrade to empty; report findings.
7. Verify the drift route now flags `HEALTHCHECKS_URL` as empty for emit-vision while it remains unset.
8. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across all 5 projects.

## Files involved
- `~/projects/emit-vision/infra/docker/docker-compose.infra.yml` — the `dms-ping` service definition
- `~/projects/emit-vision/.emit-infra.json` — add `HEALTHCHECKS_URL` to `requiredEnvKeys`
- `~/projects/emit-vision/infra/secrets.prod.env` — the deploy-source env file
- `apps/api/src/routes/secrets.ts` — read-only reference for the empty-value detector
- `backlog.md` — archive the sprint-115 item once resolved

## Acceptance criteria
- [ ] An empty `HEALTHCHECKS_URL` causes a loud, visible failure instead of a silent no-op on both the success and failure branches.
- [ ] `HEALTHCHECKS_URL` is declared in emit-vision's `requiredEnvKeys`.
- [ ] The drift route reports `HEALTHCHECKS_URL` as empty/missing while it is unset.
- [ ] The key is set in `ci.envFile` (`infra/secrets.prod.env`), not only on the server.
- [ ] Either a real ping is confirmed landing at healthchecks.io, or the sprint halts as `blocked` naming check creation, with the code-side work complete.
- [ ] The fleet-wide grep for silently-empty compose interpolations was run and its findings reported.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- Adding dead man's switches to other projects — this is about the one that exists and doesn't work.
- Replacing healthchecks.io with a different provider.
- Fixing other silently-empty compose interpolations found by the grep; report them, don't chase them.
