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
- [ ] develemail, emit-social, and tastease each have `nginx.syncOnDeploy: true`.
- [ ] Each project's drift was checked *before* the flag was set, and any drift was deliberately resolved rather than overwritten blind.
- [ ] The rollback branch of `sync-vhost.yml` has been exercised against a real nginx at least once, with the outcome recorded.
- [ ] Each project's primary domain and API subdomain return their expected HTTP status after the change.
- [ ] The drift route reports no drift for all three projects at the end.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects (config-only changes should not affect these, but confirm).

## Out of scope
- diner-decider — blocked on sprint 247's `/api/*` migration.
- martialops — shelved, no server.
- Cleaning up tastease's stray server-side nginx files — sprint 251.
- Changing the sync mechanism itself; this sprint only rolls it out.
