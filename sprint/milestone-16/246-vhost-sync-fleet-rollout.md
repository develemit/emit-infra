# Roll out nginx vhost sync to develemail, emit-social, and tastease
**Difficulty:** 4

> _Promoted from sprint-235 follow-up, 2026-08-01._
> _This item may benefit from `/plan-sprint "vhost sync fleet rollout"` to split into one sprint per project — each server needs its own drift review before flipping the flag._

## Goal
`nginx.syncOnDeploy: true` is enabled for develemail, emit-social, and tastease, with each project's live server config verified to match its repo vhost first, so a deploy can no longer silently diverge from the checked-in nginx config.

## Reason
Sprint 232 built opt-in vhost sync (backup → write → `nginx -t` → reload, with rollback on validation failure) and sprint 235 proved it end-to-end on emit-vision, which fixed that project's broken `/v1` routing. The rollout stopped there. Verified 2026-08-01 — `syncOnDeploy` across the fleet:

| project | `syncOnDeploy` | `customConfigSrc` |
|---|---|---|
| emit-vision | **true** | `infra/nginx/emit-vision.conf` |
| develemail | unset | `infra/nginx/prod.conf` |
| emit-social | unset | `docker/nginx/prod.conf` |
| tastease | unset | `docker/nginx/prod.conf` |
| diner-decider | unset | `infra/nginx/prod.conf` |

Every one of these declares a vhost source but never pushes it, so the repo copy is decorative: the server config can drift indefinitely and nothing catches it. That is exactly the failure mode that left emit-vision's `/v1` routing broken.

Sprint 235 set the rollout order deliberately: **develemail first** (zero drift — a no-op push that proves the mechanism on a second clean project), **then emit-social**, **then tastease** (known cosmetic drift, upstream variable renames). Follow that order; it escalates risk gradually.

## Context
- **diner-decider is deliberately excluded.** It now declares `customConfigSrc` (added after the sprint-234 follow-up), so it is newly eligible, but its `/api/*` routing still goes through a hand-rolled Next.js Route Handler that sprint 247 migrates to the nginx template. Enabling sync before that migration would push a vhost that doesn't yet own the routing. Do diner-decider after 247, not here.
- **martialops is shelved** — no server, no action, ignore it entirely.
- **Unverified rollback path (sprint 232 follow-up).** The backup/validate/rollback sequence in `ansible/roles/app-deploy/tasks/sync-vhost.yml` has never been exercised against a real nginx install — it was verified by YAML syntax check and code review against the `blue-green-deploy.sh` pattern only. develemail being a zero-drift no-op makes it the safest place to finally exercise it for real. Consider deliberately validating the rollback branch (e.g. against a scratch copy on a non-production box) before touching tastease.
- **Check drift before every flip.** Use the drift route from sprints 230/236 (`GET /projects/:name/nginx-config`, which since 236 reads `/etc/nginx/sites-enabled/<name>` — the config nginx actually serves). A project reporting drift needs the difference understood and deliberately resolved *before* `syncOnDeploy` is enabled, or the first deploy will overwrite live config with whatever is in the repo.
- **tastease has a known trap.** Its box (`178.104.195.59`) has `nginx.conf` including `sites-enabled/*` with **no extension filter**, so any stray file in that directory is loaded. Sprint 237 reconciled its layout; sprint 251 cleans up the leftover files. Re-check tastease's drift immediately before flipping, since its drift was cosmetic-but-real (upstream variable renames).
- **Deploys are the trigger.** Enabling the flag does nothing until the project next deploys. Decide per project whether to run a real deploy as verification or wait for the next natural one — and say which in the completion notes.
- Read the `## Completed` sections of sprints **232** (the mechanism), **235** (the emit-vision rollout and what it caught), and **236** (the drift route reading the served config) before starting.

## Tasks
1. For develemail: run the drift check, confirm zero drift, set `nginx.syncOnDeploy: true` in its `.emit-infra.json`, and verify a deploy pushes the vhost and reloads nginx cleanly.
2. Exercise the rollback branch for real at least once (intentionally invalid vhost against a scratch/non-production target) and record what happened — this is the sprint-232 gap.
3. For emit-social: drift check, resolve any difference deliberately, then enable and verify.
4. For tastease: drift check (expect cosmetic upstream-variable drift), reconcile so repo and server agree, then enable and verify.
5. After each flip, confirm the site still serves — HTTP status on the project's primary domain and any API subdomain, before and after.
6. Record the before/after drift status for all three projects in the completion summary.

## Files involved
- `~/projects/develemail/.emit-infra.json` — add `nginx.syncOnDeploy`
- `~/projects/emit-social/.emit-infra.json` — add `nginx.syncOnDeploy`
- `~/projects/tastease/.emit-infra.json` — add `nginx.syncOnDeploy`
- `ansible/roles/app-deploy/tasks/sync-vhost.yml` — read-only reference (the sync/rollback mechanism)
- `apps/api/src/routes/nginx-config.ts` — read-only reference (the drift route)

## Acceptance criteria
- [x] develemail, emit-social, and tastease each have `nginx.syncOnDeploy: true`.
- [x] Each project's drift was checked *before* the flag was set, and any drift was deliberately resolved rather than overwritten blind.
- [x] The rollback branch of `sync-vhost.yml` has been exercised against a real nginx at least once, with the outcome recorded.
- [x] Each project's primary domain and API subdomain return their expected HTTP status after the change.
- [x] The drift route reports no drift for all three projects at the end.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects (config-only changes should not affect these, but confirm).

## Completed

**Date:** 2026-08-01

### Summary
`nginx.syncOnDeploy: true` is now live for develemail, emit-social, and tastease, closing out the sprint-234/235 rollout order. All three projects reported **zero drift** at the pre-flip check — the tastease cosmetic upstream-variable drift the sprint-234 audit flagged had already been reconciled by sprint 237 and confirmed gone by sprint 236's served-config drift fix (re-verified independently here immediately before flipping). No drift resolution work was needed for any of the three; every deploy's vhost-sync task reported "nginx vhost already current," meaning the sync was a verified no-op push, not a corrective overwrite.

**Rollback exercise (sprint-232 gap, task 2).** Rather than testing against a production box, I built a disposable scratch target: a `debian:12` Docker container with a real `nginx` install, `sites-available`/`sites-enabled` laid out to match production, and a valid baseline vhost. I ran `sync-vhost.yml` itself (via Ansible's `community.docker.docker` connection plugin, not a hand-rolled simulation) with an intentionally-broken vhost (`this_is_not_a_valid_directive`). Observed: backup → copy → `nginx -t` fails → previous vhost restored from `.bak` byte-for-byte → play fails with the designed error message → reload skipped. Post-run, the vhost content matched the original exactly and `nginx -t` passed. One notable-but-correct detail: the `.bak` file is deliberately *not* removed on a failed validation (removal is gated on `vhost_validate is succeeded`), so a failed sync leaves a forensic backup on disk — expected behavior, not a bug. Container and temp files were torn down afterward; nothing production-facing was touched by this step.

**Deploy order and results.** Followed sprint 235's order (develemail → emit-social → tastease). Before each deploy I confirmed the global `emit-infra` CLI's `dist/index.js` bundle actually contained sprint 244's env-parser fix (nx cache had preserved the original build mtime, which briefly looked stale but wasn't — verified by grepping the bundled regex). Each deploy was a real `emit-infra deploy <name>` (no `BUILD_NUMBER` override, so only the vhost changed, not the app images), and each completed with `failed=0`, `nginx -t: ok`, and a `reload`-not-`restart` semantics preserved by the unchanged `sync-vhost.yml` logic.

**One dangling-diff finding, unrelated to this sprint's scope.** Before editing emit-social's `.emit-infra.json`, `git status` showed a pre-existing uncommitted diff there — sprint 243's `requiredEnvKeys` scaffold (2026-07-24) had been written to disk but never committed in the emit-social repo itself (develemail's equivalent write *was* committed; tastease's and diner-decider's state wasn't checked beyond confirming tastease was clean). Committed it separately, attributed to sprint 243, before adding this sprint's own change on top — see Follow-ups.

### Files changed
- `~/projects/develemail/.emit-infra.json` — added `nginx.syncOnDeploy: true` (committed in the develemail repo as `362e118`)
- `~/projects/emit-social/.emit-infra.json` — committed sprint 243's dangling `requiredEnvKeys` write (`73f58c3`), then added `nginx.syncOnDeploy: true` (committed as `f0f748d`)
- `~/projects/tastease/.emit-infra.json` — added `nginx.syncOnDeploy: true` (committed in the tastease repo as `0f47ab6`)
- `sprint/246-vhost-sync-fleet-rollout.md` — marked complete with this summary

### Verification
**Drift, before → after (all via `GET /projects/:name/nginx-drift` against the local dev API on port 7001):**
| project | before | after |
|---|---|---|
| develemail | ok (71/71, 0 diff) | ok (71/71, 0 diff) |
| emit-social | ok (52/52, 0 diff) | ok (52/52, 0 diff) |
| tastease | ok (179/179, 0 diff) | ok (179/179, 0 diff) |

**HTTP status, before → after (all identical):**
| project | endpoint | before | after |
|---|---|---|---|
| develemail | `develemail.com/` | 307 | 307 |
| develemail | `develemail.com/api/unsubscribe/confirm` (POST) | 400 | 400 |
| emit-social | `social.develemit.com/` | 307 | 307 |
| emit-social | `api.social.develemit.com/` | 401 | 401 |
| tastease | `tastease.app/` | 200 | 200 |
| tastease | `app.tastease.app/` | 302 | 302 |
| tastease | `app.tastease.app/api/push/public-key` | 401 | 401 |
| tastease | `app.tastease.app/api/healthz` | 200 | 200 |

- Rollback branch: exercised against a real Debian nginx install in Docker; vhost restored byte-for-byte, `nginx -t` passed post-restore, `.bak` correctly preserved on failure (see Summary).
- `emit-infra` deploys: develemail, emit-social, tastease each `failed=0`, vhost-sync task chain ran with `nginx -t: ok` and "vhost already current" on every run (no drift to correct).
- emit-infra (this repo): `pnpm test` 192/192 pass, `pnpm typecheck` clean (5/5 projects), `pnpm lint` clean (5/5 projects).
- develemail: `pnpm typecheck`/`pnpm test`/`pnpm lint` all clean.
- emit-social: `pnpm typecheck`/`pnpm test`/`pnpm lint` all clean.
- tastease: `pnpm typecheck`/`pnpm test`/`pnpm lint` all clean.

### Follow-ups
- `[address-next]` emit-social's sprint-243 `requiredEnvKeys` write sat uncommitted in that repo for 8 days before this sprint caught and committed it. Worth a quick check of diner-decider's `.emit-infra.json` (excluded from this sprint's scope, but it had its own uncommitted diffs observed in passing) to see if the same sprint left something uncommitted there too.
- `[defer]` diner-decider is next in the rollout order per the sprint-234 audit, but stays blocked on sprint 247's `/api/*` migration as this sprint's Context section specifies.
- `none` otherwise — no new issues surfaced by this rollout.

## Out of scope
- diner-decider — blocked on sprint 247's `/api/*` migration.
- martialops — shelved, no server.
- Cleaning up tastease's stray server-side nginx files — sprint 251.
- Changing the sync mechanism itself; this sprint only rolls it out.
