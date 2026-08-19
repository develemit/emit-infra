# Sprint 274 — Fleet nginx: pin sites-enabled include to *.conf

> _Promoted from sprint-262 follow-up, 2026-08-02._
> _This item may benefit from `/review-sprint` before running — it changes live nginx config on all five hosts._

## Goal
All five fleet hosts' `nginx.conf` include `sites-enabled/*.conf` instead of
the bare `sites-enabled/*` glob, so stray files (backups, editor droppings,
retired configs) can never be loaded as live server config again.

## Context
Sprint 262 documented the hazard (`docs/DEPLOYMENT-PITFALLS.md`): a bare glob
loads ANY file in `sites-enabled/`, which is how a `.bak` file nearly became
live config on tastease. The fix is a one-line change per host but it's a
live-box behavior change on all five production servers, so it gets its own
deliberate sprint. Order of operations per host: (1) inventory
`sites-enabled/` and confirm every intended vhost file already ends in
`.conf` (rename any that don't BEFORE changing the include, or the site drops
offline); (2) edit `nginx.conf`; (3) `nginx -t`; (4) reload (not restart);
(5) verify the host's project health endpoint still 200s. Also update the
provisioning source of truth so newly provisioned hosts get the safe glob:
find where `nginx.conf` originates in `ansible/roles/nginx/` (template or
lineinfile) and fix it there too, with `ansible-playbook --syntax-check`.
Do hosts one at a time; develemail (live mail) last, after the pattern is
proven on a quieter host. Roll back immediately on any `nginx -t` failure.

## Tasks
1. Per host: inventory, rename non-`.conf` intended vhosts, flip the include,
   `nginx -t`, reload, health-check. One host per step, tastease first,
   develemail last.
2. Fix the ansible provisioning template so future hosts are born safe;
   syntax-check the playbook.
3. Update `docs/DEPLOYMENT-PITFALLS.md`'s entry from "hazard" to "fixed
   fleet-wide" with the date.

## Acceptance criteria
- [ ] All five hosts on `*.conf` include; `nginx -t` clean; reload (no
      restart); health endpoint 200 per host, checked immediately after
- [ ] No vhost dropped: per-host before/after `nginx -T | grep server_name`
      comparison recorded
- [ ] Ansible template fixed + syntax-check clean (test if role code changes)
- [ ] Pitfalls doc updated

## Completed

**Date:** 2026-08-02 — **retired unexecuted, by user decision (option B).**

Zero changes were made to any host. The pre-flight recon (recorded above the
footer in `/tmp/sprint-run-emit-infra-274.log`) found this sprint unsafe as
written: the extensionless vhost filename is canonical across three ansible
task files and the dashboard drift route (pitfalls #16), so the rename this
sprint required would have broken drift detection and deploy backup/restore
fleet-wide and risked re-triggering the #16 502 incident. With `sites-enabled/`
verified pristine on all five hosts, the user chose to park the hardening
rather than rescope it now. The full rescope, the exact bite conditions, and
the do-it-when triggers are recorded in `backlog.md` under
"(sprint 274 retired, 2026-08-02)".

### Preserved recon (from the blocked child's report — /tmp log is volatile)

**What I found (read-only recon, no live changes made):**

All five hosts confirmed reachable and inventoried (tastease, diner-decider, develemail, emit-social via `~/.ssh/emit-deploy`; emit-vision needed `~/.ssh/emit-vision-deploy` — a different key, noted but not itself a blocker). Every host's `nginx.conf` has the bare `include /etc/nginx/sites-enabled/*;` as expected, and every host's *only* enabled vhost is an **extensionless** file (`sites-enabled/<project>` → symlink to `sites-available/<project>`, no `.conf` suffix anywhere). No strays currently sit in any `sites-enabled/` directory (tastease's retired file and diner-decider's `.bak` files all live in `sites-available/`, which nginx doesn't glob — so there's no live hazard today, just the standing risk).

**The conflict:** Sprint 274's task 1 requires renaming these canonical vhost files to end in `.conf` before flipping the global include (otherwise every site drops offline the moment the glob changes). But `docs/DEPLOYMENT-PITFALLS.md` entry #16 — written after a real production 502 incident — documents that the *extensionless* name is deliberately canonical and is hardcoded into paths the sprint doesn't touch:

- `ansible/roles/nginx/tasks/main.yml` — provision-time copy + `sites-enabled` symlink, both extensionless
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml:113-165` — vhost backup/restore during every zero-downtime deploy, extensionless
- `ansible/roles/app-deploy/tasks/sync-vhost.yml:4-65` — vhost sync/backup during deploy, extensionless
- `apps/api/src/routes/nginx-config.ts:44-45` — drift-detection route, extensionless

If I rename the live vhost files to `.conf` and only touch `nginx.conf` + docs (the sprint's actual scope), I'd immediately break drift detection and deploy-configured status for all 5 projects in the dashboard, break the vhost backup/restore step on every project's next deploy, and — worst case — if the ansible `nginx` role or `app-deploy` role ever re-runs, it recreates the extensionless file+symlink *alongside* the renamed `.conf` file, reproducing entry #16's exact "conflicting server_name, nginx picks first alphabetically" 502-after-swap incident fleet-wide. That's the failure entry #16 exists to prevent, re-triggered by fixing entry #23.

Separately, task 2 ("fix the ansible provisioning template") has no existing target — I confirmed no ansible template or task manages the top-level `nginx.conf` at all; it's stock OS default. A real fix means *adding* a new task, which is fine, but it's not the drop-in fix the sprint phrasing implies.

This is a real architecture conflict the sprint doesn't explain, not an ambiguity I can resolve by judgment call — properly fixing it means touching 3 ansible task files and one API route that are outside the sprint's stated scope. Per the skill's rules, I'm not making any live change or sprint-file edit; I'm reporting blocked.

Sprint 274 ('Fleet nginx: pin sites-enabled include to *.conf') is blocked.
Reason: All five hosts' only enabled vhosts are extensionless (`sites-enabled/<project>`), which is the deliberately canonical layout hardcoded into `ansible/roles/nginx/tasks/main.yml`, `ansible/roles/app-deploy/tasks/{deploy-zero-downtime,sync-vhost}.yml`, and `apps/api/src/routes/nginx-config.ts` (per DEPLOYMENT-PITFALLS.md entry #16). Renaming them to `.conf` as sprint 274 task 1 requires — without also updating those four consumers, which are outside the sprint's stated scope — risks reintroducing entry #16's exact conflicting-server-name 502 incident on the next provision/deploy, and breaks drift detection and deploy-configured status fleet-wide in the meantime.
Suggested resolution: rescope sprint 274 (or add a prerequisite sprint) to update the three ansible task files and `nginx-config.ts` to the new `.conf` suffix in the same change as the per-host rename, so nothing can recreate a duplicate extensionless file; also decide where the "fix the ansible template" task lands since no such template currently exists (it'd be a new task, e.g. `lineinfile` on `nginx.conf`).
