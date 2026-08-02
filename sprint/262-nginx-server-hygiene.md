# Clean up stray nginx files on tastease and document the sites-enabled glob hazard
**Difficulty:** 2

> _Promoted from sprint-237 follow-ups, 2026-08-01._

## Goal
tastease's server has no leftover nginx files that a bare `sites-enabled/*` include could pick up, and the hazard that makes those files dangerous is written down where the next person will find it.

## Reason
Two follow-ups from sprint 237, which reconciled tastease's nonstandard nginx layout.

**1. Leftover files.** `178.104.195.59` still carries `/etc/nginx/sites-available/tastease.conf` (5098 bytes, dated 2026-06-22) — an orphan from the pre-reconciliation layout — plus two `.bak-20260724` files from that sprint's own backups. All are currently inert.

**2. The reason they matter.** That box's `nginx.conf` includes `sites-enabled/*` with **no extension filter**, unlike hosts using `sites-enabled/*.conf`. Any file staged in `sites-enabled/` is loaded, whatever its name — including editor swap files, `.bak` copies, and half-written configs. During sprint 237 this produced a genuine false alarm: an orphaned file looked like a live config time bomb until `nginx -t` and a careful read showed it was merely sitting in `sites-available/` and not symlinked. The next person will lose the same time unless the hazard is recorded.

The files are in `sites-available/`, not `sites-enabled/`, so nothing is loading them today. This is hygiene and documentation, not an incident.

## Context
- **Verify before deleting.** The whole point of the glob hazard is that a file's location determines whether it is live. For each candidate: confirm it is not symlinked from `sites-enabled/`, confirm nothing else `include`s it, and only then remove. `grep -rn "tastease.conf" /etc/nginx/` is the cheap check.
- **`nginx -t` before and after**, and reload rather than restart. tastease is a live production site.
- **Keep a copy of anything deleted** (e.g. move to `/root/nginx-archive-<date>/` rather than `rm`) until the site is confirmed serving. The `.bak-20260724` files were themselves safety copies; removing safety copies deserves its own safety copy.
- **Where the documentation belongs.** `docs/DEPLOYMENT-PITFALLS.md` is the established home for exactly this kind of trap and is already referenced across sprints. Note that the file has a **pre-existing numbering artifact — two entries both titled "20"** (around lines 462 and 525), flagged in sprint 242's follow-ups. Don't let that block adding an entry, and don't renumber the file as a side effect; if the new entry needs a number, pick the next unambiguous one and mention the artifact in the completion notes.
- **The hazard is host-specific.** Say which host(s) it applies to. Do not write it as a universal rule — other fleet hosts use `sites-enabled/*.conf` and are not affected. A quick check of the other four servers' `nginx.conf` include patterns would make the doc entry accurate and is cheap; do it and record which hosts use which pattern.
- Read sprint **237**'s `## Completed` section for what was already reconciled and why the false alarm happened, and sprint **236**'s for how the drift route determines the served config.

## Tasks
1. On `178.104.195.59`, inventory `/etc/nginx/sites-available/` and `/etc/nginx/sites-enabled/`, recording which files are symlinked, which are orphans, and which are backups.
2. For each removal candidate, prove it is not referenced: not symlinked from `sites-enabled/`, not `include`d anywhere.
3. Archive rather than delete outright, then run `nginx -t`.
4. Reload nginx and confirm tastease still serves.
5. Check the other four fleet servers' `nginx.conf` include patterns and record which use `sites-enabled/*` vs `sites-enabled/*.conf`.
6. Add an entry to `docs/DEPLOYMENT-PITFALLS.md` describing the bare-glob hazard, naming the affected host(s), and stating the rule: never stage scratch or backup files inside `sites-enabled/` on those hosts.
7. Confirm the drift route still reports tastease correctly afterward.

## Files involved
- `docs/DEPLOYMENT-PITFALLS.md` — new entry for the bare-glob hazard
- `178.104.195.59:/etc/nginx/sites-available/` — the orphan and `.bak-20260724` files (server-side, not in this repo)
- `apps/api/src/routes/nginx-config.ts` — read-only reference for the drift check

## Acceptance criteria
- [x] Every file removed was first proven unreferenced (not symlinked, not included).
- [x] Removed files are archived somewhere recoverable, not destroyed.
- [x] `nginx -t` passed before and after; nginx was reloaded, not restarted.
- [x] tastease serves correctly after the cleanup.
- [x] The include pattern for all five fleet servers is recorded.
- [x] `docs/DEPLOYMENT-PITFALLS.md` documents the hazard and names the affected host(s), without renumbering the file.
- [x] The drift route reports tastease correctly afterward.

## Out of scope
- Changing tastease's `nginx.conf` include pattern to `sites-enabled/*.conf` — arguably the real fix, but a behavior change on a live box that deserves its own sprint.
- Enabling `nginx.syncOnDeploy` for tastease — sprint 246.
- Renumbering `docs/DEPLOYMENT-PITFALLS.md` to fix the duplicate "20" entries.

## Completed

**Date:** 2026-08-02

### Summary
Cleaned up tastease's `sites-available/` orphans and documented the bare-glob hazard — but the documentation ended up materially different from what the sprint assumed, because the assumption was wrong.

On `178.104.195.59`, `sites-available/` held `tastease.conf` (5098 bytes, Jun 22 — the pre-reconciliation orphan) and `tastease.bak-20260724` (4151 bytes — a sprint 237 safety copy). Neither was symlinked from `sites-enabled/` nor referenced by any `include` (confirmed via `grep -rn` across `/etc/nginx/` and `find -xtype l`), so both were moved to a fresh `/root/nginx-archive-20260802/` — outside every nginx include path, recoverable, not deleted. (The third sprint-237 backup, `/root/nginx-backups/tastease.sites-enabled.bak-20260724`, was already outside `sites-available`/`sites-enabled` entirely and needed no further action.) `nginx -t` passed before and after the move, `nginx -s reload` applied cleanly (`systemctl is-active nginx` stayed `active` throughout), and all three tastease hostnames plus `/api/healthz` returned the same codes/payload as sprint 237's baseline (200/301/302, `build:"980"`). The drift route (`GET /projects/tastease/nginx-drift`) still reports `{"status":"ok","diff":[]}`.

The sprint's Context section asserted "other fleet hosts use `sites-enabled/*.conf` and are not affected" — that turned out to be false. I checked `nginx.conf`'s include line on all five fleet servers directly (SSH, `grep -n sites-enabled`) and every one of them uses the same bare `include /etc/nginx/sites-enabled/*;` with no extension filter: tastease, emit-vision, diner-decider, develemail, and emit-social. This isn't a tastease quirk, it's a fleet-wide provisioning fact — all five hosts share the same nginx.conf template. The `docs/DEPLOYMENT-PITFALLS.md` entry (added as #23, the next unambiguous number — the file's pre-existing duplicate "20" at lines 419/526 was left untouched per the sprint's explicit instruction) documents this accurately: a table of all five hosts and their include pattern, rather than a single-host caveat. emit-social's server IP wasn't in its `.emit-infra.json` (no `serverIp` field); it's declared as `SERVER_IP=167.233.169.206` inside the project's own `.env.prod`, which is where I found it to complete the SSH check.

### Files changed
- `docs/DEPLOYMENT-PITFALLS.md` — new entry #23 documenting the bare-`sites-enabled/*` hazard across all five fleet hosts (not just tastease), with the per-host include-pattern table
- `178.104.195.59:/etc/nginx/sites-available/tastease.conf` — moved to `/root/nginx-archive-20260802/` (server-side, not in this repo)
- `178.104.195.59:/etc/nginx/sites-available/tastease.bak-20260724` — moved to `/root/nginx-archive-20260802/` (server-side, not in this repo)

### Verification
- Pre-move: `grep -rn 'tastease.conf' /etc/nginx/` and `grep -rn 'tastease.bak-20260724' /etc/nginx/` both empty; `find /etc/nginx -xtype l -lname '*tastease.conf*' -o -lname '*tastease.bak-20260724*'` empty — neither file was referenced or symlinked.
- `nginx -t`: passed before the move and after.
- `nginx -s reload` (not restart): applied; `systemctl is-active nginx` → `active` before, during, and after.
- Live check: `tastease.app` 200, `www.tastease.app` 301, `app.tastease.app` 302, `app.tastease.app/api/healthz` → `{"status":"ok","build":"980","service":"api"}` — matches sprint 237's recorded baseline.
- Include pattern checked on all five hosts via direct SSH: tastease, emit-vision, diner-decider, develemail, emit-social all use bare `sites-enabled/*` (no `.conf` filter).
- `GET /projects/tastease/nginx-drift` (local API, `:7001`) → `{"status":"ok","diff":[]}`.
- `docs/DEPLOYMENT-PITFALLS.md` numbering: confirmed the pre-existing duplicate "20" (lines 419, 526) is unchanged; new entry is `## 23.`, appended at end of file.

### Follow-ups
- `[defer]` `martialops.conf` sits unsymlinked in tastease's `sites-available/` (not referenced, confirmed inert during this sprint's inventory) — out of this sprint's scope (only `tastease.conf`/`tastease.bak-20260724` were named), but it's the same category of stale file and could be archived or confirmed-intentional in a future pass.
- `[defer]` The real fix for the bare-glob hazard — switching all five hosts' `nginx.conf` to `include /etc/nginx/sites-enabled/*.conf;` — is a behavior change on live boxes, explicitly out of scope here per the sprint, and now known to apply fleet-wide rather than to one host. Worth its own sprint if the hazard bites again.
- `none` otherwise.
