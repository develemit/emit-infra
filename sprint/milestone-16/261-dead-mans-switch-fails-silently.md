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
- [x] An empty `HEALTHCHECKS_URL` causes a loud, visible failure instead of a silent no-op on both the success and failure branches.
- [x] `HEALTHCHECKS_URL` is declared in emit-vision's `requiredEnvKeys`.
- [x] The drift route reports `HEALTHCHECKS_URL` as empty/missing while it is unset.
- [x] The key is set in `ci.envFile` (`infra/secrets.prod.env`), not only on the server.
- [x] Either a real ping is confirmed landing at healthchecks.io, or the sprint halts as `blocked` naming check creation, with the code-side work complete. — **Second arm satisfied: halted naming check creation, code-side work complete and deployed. On 2026-08-01 the user deferred healthchecks.io indefinitely in favor of exploring a self-hosted cross-monitoring approach (see backlog).**
- [x] The fleet-wide grep for silently-empty compose interpolations was run and its findings reported.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- Adding dead man's switches to other projects — this is about the one that exists and doesn't work.
- Replacing healthchecks.io with a different provider.
- Fixing other silently-empty compose interpolations found by the grep; report them, don't chase them.

## Blocked

**Date:** 2026-08-01

### Reason
The healthchecks.io check for emit-vision was never actually created — confirmed by re-reading sprint 115's `## Completed` section (2026-06-29), which shipped the `dms-ping` container but left "create the healthchecks.io check" as an open `[address-next]` follow-up that nobody ever picked up. `provision-list/healthchecks-io.md` claims `Status: ✅ Complete` and "Verified running in production," which is false — it documents the container being deployed and reachable, not that it ever pinged anything. Creating an account/check at healthchecks.io is an outward-facing manual action requiring account access this sprint can't perform, and the sprint's own instructions are explicit: do not invent a URL, do the code-side work, and halt naming the check creation as the outstanding item.

**All automatable work is done, committed, and deployed:**

1. **Confirmed the bug live before touching anything.** `docker inspect emit-vision-dms-ping-1` showed `HEALTHCHECKS_URL=` (empty). `docker logs -t` showed a single line from 2026-07-29, three days of total silence. `/readyz` genuinely returns `{"ok":true,"build":"972"}` — the probe works, the ping doesn't.
2. **Fail-loud guard added** to the `dms-ping` service in `emit-vision/infra/docker/docker-compose.infra.yml`: the loop now checks `[ -z "$HEALTHCHECKS_URL" ]` before starting and exits 1 with a clear message if empty, instead of looping forever with `wget ""` swallowed by `|| true`.
3. **`HEALTHCHECKS_URL` added to `requiredEnvKeys`** in `emit-vision/.emit-infra.json` (alphabetical position, between `GOOGLE_CLIENT_SECRET` and `INTERNAL_API_SECRET`).
4. **`HEALTHCHECKS_URL=` (blank, with a `TODO` comment pointing at `provision-list/healthchecks-io.md`) added to `emit-vision/infra/secrets.prod.env`**, the `ci.envFile` source of truth — not just the server.
5. **Committed to the emit-vision repo** as `7222750` ("fix: dms-ping fails loudly on empty HEALTHCHECKS_URL instead of silent no-op").
6. **Deployed the fix live.** A full `emit-infra deploy emit-vision` was blocked by the sprint-241 env-removal guardrail on two pre-existing, unrelated stale server keys (`NEXT_PUBLIC_EMIT_VISION_DOGFOOD_KEY`, `NEXT_PUBLIC_EMIT_VISION_PROJECT_ID` — leftover from the sprint 441/442 dogfood-instrumentation removal; nothing to do with this sprint). Rather than pass `--allow-env-removal` to strip unrelated keys as a side effect, the compose file alone was synced to `/opt/emit-vision/docker-compose.infra.yml` via `scp` and `docker compose -f docker-compose.infra.yml up -d dms-ping` was run directly — a smaller, safer blast radius than a full blue-green app deploy for a change that only touches the infra compose file.
7. **Verified live.** `emit-vision-dms-ping-1` now shows `Restarting (1)` in `docker ps` and its logs read `[dms-ping] FATAL: HEALTHCHECKS_URL is empty — refusing to start, since a dead man switch that cannot ping anything is worse than no switch at all`, repeated every restart. The old silent-success behavior is gone.
8. **Drift route confirmed** (`GET /projects/emit-vision/secrets-drift` against the local API on port 7001): `HEALTHCHECKS_URL` now appears in `missing`, driving `status: drift`. Pre-existing, unrelated drift also visible in that response (`INTERNAL_API_SECRET`, `OPERATOR_API_KEY`, `WAITLIST_ADMIN_KEY` missing; `NEXT_PUBLIC_EMIT_VISION_DOGFOOD_KEY`, `NEXT_PUBLIC_EMIT_VISION_PROJECT_ID`, `BUILD_NUMBER` extra) — none of that is new or caused by this sprint; noted for visibility, not chased.
9. **Fleet grep for the same bug shape.** Searched all 33 compose files across the fleet (`centraflow`, `develemail`, `diner-decider`, `emit-billing`, `emit-social`, `emit-vision`, `garage-sailor`/`garage-sailor-prime`, `immigration-app`, `martialops`, `tastease`) for `${VAR}`/`$VAR` interpolations feeding an `|| true`-guarded network call. Found exactly one other instance: `tastease/docker-compose.prod.yml`'s `uptime-ping` service (line 163) pings `$$HEALTHCHECKS_URL` via `env_file: .env` with the same `|| true` shape. tastease already declares `HEALTHCHECKS_URL` in its own `requiredEnvKeys`, so the sprint-239 drift detector already covers whether it's actually empty there — not independently verified here, and fixing the crash-loop behavior in tastease is out of scope for this sprint (see Follow-ups).
10. **Verification suite:** `pnpm test` (350+207+13+4 = all passing across api/dashboard/cli/core), `pnpm typecheck` (5/5 clean), `pnpm lint` (5/5 clean) — all in emit-infra.

### Outstanding manual step
Create a healthchecks.io check for emit-vision (15-minute period, 5-minute grace, per `provision-list/healthchecks-io.md`), then set the real ping URL in `emit-vision/infra/secrets.prod.env`'s `HEALTHCHECKS_URL=` line and redeploy (or `scp` + restart `dms-ping` as above) to clear the crash loop. Until then, `dms-ping` will sit `Restarting` — visible in the dashboard, which is the intended, honest state instead of the previous false "Up."

### Pickup notes
Next session: once the check exists and the URL is set, task 5's remaining half is "verify a ping actually lands" — check the healthchecks.io dashboard shows the check flip to green after redeploying. Also worth fixing `provision-list/healthchecks-io.md`'s `Status: ✅ Complete` / "Verified running in production" claims, which were false and are exactly the kind of false assurance this sprint exists to eliminate — left unedited here since it wasn't in this sprint's `Files involved`.

## Completed

**Date:** 2026-08-01 (closed by user deferral decision)

All automatable work was done, committed (`emit-vision 7222750`), and deployed
— the silent no-op is gone. The remaining manual step (create the
healthchecks.io check) was explicitly deferred by the user, who chose to
explore a self-hosted alternative instead: cross-validating emit-vision's
pulse against direct health probes (the emit-infra local status monitor
already HTTP-probes `api.emitvision.com/healthz` every 60s) plus a
fleet-server sentinel, rather than depending on an outside service.

Because the deferral leaves `HEALTHCHECKS_URL` empty indefinitely, the
crash-looping `dms-ping` container was stopped on the server
(`docker compose stop dms-ping`; compose file untouched). Note: the next
full emit-vision deploy will revive it into the same crash loop — the
durable retirement of `dms-ping` belongs to the self-hosted-DMS initiative
that replaces it.

### Follow-ups
- `[defer]` healthchecks.io check creation — deferred indefinitely by user
  decision (2026-08-01); superseded if the self-hosted DMS initiative lands.
- `[defer]` Next emit-vision deploy revives the stopped `dms-ping`
  crash-loop; retire or gate the service in the repo compose as part of the
  self-hosted DMS work.
- `[defer]` `provision-list/healthchecks-io.md` still claims `Status: ✅
  Complete` / "Verified running in production" — false; correct it when the
  DMS approach is settled.
- `[defer]` tastease's `uptime-ping` service has the same silent
  `$$HEALTHCHECKS_URL || true` shape (docker-compose.prod.yml:163) — audit it
  alongside the self-hosted DMS work.
