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
- [ ] Every file removed was first proven unreferenced (not symlinked, not included).
- [ ] Removed files are archived somewhere recoverable, not destroyed.
- [ ] `nginx -t` passed before and after; nginx was reloaded, not restarted.
- [ ] tastease serves correctly after the cleanup.
- [ ] The include pattern for all five fleet servers is recorded.
- [ ] `docs/DEPLOYMENT-PITFALLS.md` documents the hazard and names the affected host(s), without renumbering the file.
- [ ] The drift route reports tastease correctly afterward.

## Out of scope
- Changing tastease's `nginx.conf` include pattern to `sites-enabled/*.conf` — arguably the real fix, but a behavior change on a live box that deserves its own sprint.
- Enabling `nginx.syncOnDeploy` for tastease — sprint 246.
- Renumbering `docs/DEPLOYMENT-PITFALLS.md` to fix the duplicate "20" entries.
