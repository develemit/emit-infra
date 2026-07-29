# Reconcile tastease's nonstandard nginx layout on the server
**Difficulty:** 3

## Goal
Bring tastease's production nginx layout onto the fleet-standard convention: one authoritative vhost at `/etc/nginx/sites-available/tastease` (matching the served config and the repo), with `/etc/nginx/sites-enabled/tastease` a symlink to it. Remove the stale orphaned `sites-available` copy. Zero change to what nginx actually serves — the site stays up throughout.

## Reason
tastease's server (`178.104.195.59`) has a nonstandard nginx layout discovered 2026-07-24: `sites-enabled/tastease` is a **standalone regular file** (not the usual symlink into `sites-available/`). That regular file is correct — it uses the `tastease_api`/`tastease_web`/`tastease_marketing` upstreams, matches the include, matches the repo `docker/nginx/prod.conf` byte-identically, and `nginx -t` passes. But `sites-available/tastease` is a **stale orphaned copy** (125 lines, old `api_upstream`/`web_upstream`/`marketing_upstream` names) that nginx never loads. This isn't an outage risk today, but it blocks two things: (1) it's the reason drift tooling was misled (sprint 236 fixes the detector; this fixes the underlying mess), and (2) **tastease can never safely enable `syncOnDeploy`** while it stands — sprint 232's sync writes the repo vhost to `sites-available/<name>`, which nginx currently ignores for tastease, so a sync would silently no-op (or conflict if a symlink appeared). Normalizing now gets tastease onto solid, sync-ready ground like the rest of the fleet. Logged in `backlog.md` (2026-07-24, tagged `[address]`).

## Context
⚠️ **This sprint modifies a live production server.** Run it attended. Every step is gated by `nginx -t` and a backup, and nginx is **reloaded, never restarted** — but treat it with the same care as the emit-vision (sprint 235) and diner-decider vhost fixes from this initiative.

- **Server:** `178.104.195.59`. SSH as `root` with key `~/.ssh/emit-deploy` (tastease's `sshKeyName` is `emit-deploy`; confirm via `~/projects/tastease/.emit-infra.json`). Standard flags used elsewhere this initiative: `-o StrictHostKeyChecking=no -o ConnectTimeout=20`.
- **Current live state (verified 2026-07-24):**
  - `/etc/nginx/sites-enabled/tastease` — regular file, 6099 bytes, uses `tastease_*` upstreams. **This is what nginx serves and it is correct.**
  - `/etc/nginx/sites-available/tastease` — orphaned regular file, ~125 lines, old `*_upstream` names, **not loaded**.
  - `diff /etc/nginx/sites-enabled/tastease ~/projects/tastease/docker/nginx/prod.conf` → **identical** (served == repo).
  - Upstreams defined in `/opt/tastease/nginx-upstream.conf` (`tastease_api`/`tastease_web`/`tastease_marketing`), rewritten each deploy by `blue-green-deploy.sh`. tastease uses this custom include path, not the `/etc/nginx/blue-green/` convention — leave it as-is.
- **Why nginx surgery is safe with care:** nginx does not re-read vhost files until reload; `nginx -t` validates the on-disk graph before you reload. The target end-state serves byte-identical content to what's live now, so a correct reload is a behavioral no-op.
- **The reconciliation is a filename/symlink operation, content unchanged.** The authoritative content must be the current served file (`sites-enabled/tastease`), which equals the repo. Do NOT introduce the repo file as a fresh copy without first confirming it still matches the served file at run time (a deploy could have changed the served file since planning).
- **Fleet-standard layout** (for reference — how other projects look): `sites-available/<name>` holds the vhost; `sites-enabled/<name>` is a symlink to it. See emit-vision after sprint 235, or develemail.
- **Verification pattern from this initiative:** back up, apply, `nginx -t`, reload, then curl the live domains and confirm 200s + correct routing. tastease serves `tastease.app`, `www.tastease.app`, and `app.tastease.app` (API + web + marketing split — see the vhost's `server_name` blocks).

## Tasks
1. Confirm run-time state before touching anything: SSH in and verify `diff /etc/nginx/sites-enabled/tastease ~/projects/tastease/docker/nginx/prod.conf` is still identical, and capture `md5sum` of the served file. If they differ from the planned state, STOP and report — do not proceed on stale assumptions.
2. Back up both files with dated suffixes: `cp /etc/nginx/sites-enabled/tastease /etc/nginx/sites-enabled/tastease.bak-<YYYYMMDD>` and same for the orphaned `sites-available/tastease`.
3. Write the authoritative content to `sites-available/tastease` by copying the **currently served** file: `cp /etc/nginx/sites-enabled/tastease /etc/nginx/sites-available/tastease` (this replaces the stale orphan with the correct content).
4. Replace the standalone `sites-enabled/tastease` regular file with a symlink to the canonical path: `rm /etc/nginx/sites-enabled/tastease && ln -sfn /etc/nginx/sites-available/tastease /etc/nginx/sites-enabled/tastease`.
5. Validate: `nginx -t`. It must pass. If it fails, restore both `.bak` files immediately and abort with the error.
6. Reload (not restart): `nginx -s reload`. Confirm `systemctl is-active nginx` → `active`.
7. Verify the served content is unchanged: `md5sum /etc/nginx/sites-enabled/tastease` must equal the value captured in task 1, and `readlink /etc/nginx/sites-enabled/tastease` must now point at `/etc/nginx/sites-available/tastease`.
8. Live-verify routing on all three tastease hostnames: e.g. `https://tastease.app/` (marketing) → 200; `https://app.tastease.app/` → 200; an `/api/` path on `app.tastease.app` reaches the API (JSON, not a Next.js 404). Compare against a baseline captured before step 2.
9. Confirm through tooling: with the local API on `:7001`, `GET /projects/tastease/nginx-drift` → `ok` (this relies on sprint 236 already reading `sites-enabled`; if 236 isn't deployed in the running API, note that the drift route may still read the now-corrected `sites-available` and should also report `ok`).
10. Remove the `.bak` files only after all verifications pass, or leave them and note their paths in the completion summary for the user to clean up.

## Files involved
- No repo files change. tastease's repo vhost (`~/projects/tastease/docker/nginx/prod.conf`) is already correct and is the reference for "what the served config should be."
- Server files on `178.104.195.59` (not in this repo): `/etc/nginx/sites-available/tastease`, `/etc/nginx/sites-enabled/tastease`.
- `~/projects/tastease/.emit-infra.json` — read-only, to confirm `sshKeyName` and `serverIp`.

## Acceptance criteria
- [x] `/etc/nginx/sites-enabled/tastease` is a **symlink** to `/etc/nginx/sites-available/tastease` (verified via `readlink`).
- [x] `/etc/nginx/sites-available/tastease` content is byte-identical to what was served before the change (md5 match) and to the repo vhost.
- [x] `nginx -t` passes and nginx was reloaded (not restarted); service is `active`.
- [x] All three tastease hostnames serve correctly post-change (200s; `/api/` reaches the backend) — matching the pre-change baseline.
- [x] `GET /projects/tastease/nginx-drift` reports `ok`.
- [x] Backup file paths are recorded in the completion summary (or removed after verification).

## Out of scope
- Enabling `syncOnDeploy` for tastease — this sprint only makes it *possible* later; flipping it on is a separate, deliberate decision (mirroring how sprint 235 opted in emit-vision alone).
- Changing tastease's upstream include mechanism (`/opt/tastease/nginx-upstream.conf`) or migrating it to the `/etc/nginx/blue-green/` convention — it works; leave it.
- Any change to the tastease application repo or its deploy pipeline.
- The drift-route code fix — that's sprint 236, and this sprint assumes it may or may not be running yet (see task 9).

## Completed

**Date:** 2026-07-24

### Summary
Reconciled tastease's nonstandard nginx layout to the fleet-standard symlink convention. Pre-flight confirmed the served `sites-enabled/tastease` (regular file, md5 `1fff205b64380a3c7a36f0c90771e0aa`) was still byte-identical to the repo's `docker/nginx/prod.conf`, matching the sprint's planning-time snapshot exactly — safe to proceed without re-planning.

First reconciliation attempt failed `nginx -t` because the dated backup (`sites-enabled/tastease.bak-20260724`) was placed *inside* `sites-enabled/`, and the server's `nginx.conf` uses a bare `include /etc/nginx/sites-enabled/*;` (no `.conf` filter) — so the backup itself got parsed as a second vhost and collided on a duplicate `real_ip_header` directive. The fail-path in my own command correctly detected the `nginx -t` failure and auto-restored both files from backup before any reload occurred, so nginx was never reloaded with bad config and the live site was undisturbed throughout (`systemctl is-active nginx` stayed `active` the whole time). This is a real gotcha for this specific server worth remembering: **never place backup/scratch files inside `sites-enabled/` on this box** — `sites-available/` and `conf.d/*.conf` are safe (glob-filtered or not wildcard-included), but `sites-enabled/*` swallows everything.

Moved the `sites-enabled` backup to `/root/nginx-backups/` (outside any nginx include path) and retried. Second attempt succeeded cleanly: `sites-available/tastease` now holds the correct content (previously-orphaned copy was overwritten), `sites-enabled/tastease` is now a symlink to it, `nginx -t` passed, and `nginx -s reload` applied with zero content change (md5 unchanged pre/post). All three hostnames (`tastease.app`, `www.tastease.app`, `app.tastease.app`) and the `/api/healthz` endpoint returned identical status codes/payloads before and after. The local drift-detection route (`GET /projects/tastease/nginx-drift`, sprint 236) reports `ok` with an empty diff.

Also noticed an unrelated stray file, `/etc/nginx/sites-available/tastease.conf` (5098 bytes, dated Jun 22), sitting alongside the reconciled `tastease` file. It is inert (`sites-available/` isn't glob-included by `nginx.conf`) and out of this sprint's scope, but it's dead weight worth a follow-up cleanup.

### Files changed
- No repo files changed (as expected — this was a server-only operation).
- Server `178.104.195.59`: `/etc/nginx/sites-available/tastease` — overwritten with the correct served content (was a 125-line stale orphan with old `*_upstream` names; now matches repo/served content byte-for-byte).
- Server `178.104.195.59`: `/etc/nginx/sites-enabled/tastease` — converted from a standalone regular file to a symlink → `/etc/nginx/sites-available/tastease`.

### Verification
- Pre-change baseline vs post-change: `tastease.app` 200, `www.tastease.app` 301, `app.tastease.app` 302, `app.tastease.app/api/healthz` 200 with identical JSON body (`build:"863"`) — all identical before and after.
- `nginx -t`: passed on final attempt; `nginx -s reload` applied; `systemctl is-active nginx` → `active` throughout (never went down).
- `readlink /etc/nginx/sites-enabled/tastease` → `/etc/nginx/sites-available/tastease`.
- `md5sum` of served file unchanged across the whole operation: `1fff205b64380a3c7a36f0c90771e0aa` (matches repo `prod.conf` too).
- `GET /projects/tastease/nginx-drift` (local API, `:7001`) → `{"status":"ok", "diff":[]}`.
- Backups left in place per task 10's "or note their paths" option:
  - `/root/nginx-backups/tastease.sites-enabled.bak-20260724` (outside sites-enabled, safe)
  - `/etc/nginx/sites-available/tastease.bak-20260724` (safe location, not glob-included)

### Follow-ups
- `[defer]` Stray unused file `/etc/nginx/sites-available/tastease.conf` (5098 bytes, dated 2026-06-22) on `178.104.195.59` — inert but should be cleaned up in a future pass along with the two `.bak-20260724` files once no longer needed.
- `[defer]` Worth a one-line note somewhere (server runbook or this project's fleet notes) that `178.104.195.59`'s `nginx.conf` includes `sites-enabled/*` with no extension filter — any future server-side scratch/backup work on this box must stage files outside `sites-enabled/`, unlike hosts using `sites-enabled/*.conf`.
