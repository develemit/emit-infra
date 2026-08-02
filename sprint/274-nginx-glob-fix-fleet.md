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
