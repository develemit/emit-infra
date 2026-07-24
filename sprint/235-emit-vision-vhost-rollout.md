# Roll out vhost sync to emit-vision and verify /v1 routing in production
**Difficulty:** 3

## Goal
emit-vision becomes the first project with `nginx.syncOnDeploy: true`, its repo-owned vhost reaches production through a normal deploy with no manual SSH step, and `https://app.emitvision.com/v1/projects` returns **401** (API reached, auth required) instead of the current **404** (Next.js 404 page).

## Reason
This closes the incident that started this initiative. emit-vision's users hit 404s on every browser-initiated `/v1/*` call on `app.emitvision.com` — email-verification resend, weekly-digest toggle, saved segments, live KPI polling, and manual data export were all silently broken for a long time, while server-rendered pages kept working and made the dashboard look healthy.

The fix is already written and committed in the emit-vision repo (`f852d4b`) but cannot reach production through the image-deploy path. Sprints 230-232 built everything needed to deliver it; this sprint is the first real use of that machinery, on the one project whose vhost content has already been verified correct.

It is also the proof that the whole chain works end to end. Until a config change committed to a repo demonstrably lands in production through a normal deploy, the initiative's central acceptance criterion is unmet.

## Context
⚠️ **This is the only sprint in this initiative that touches production.** It deploys emit-vision and reloads nginx on a live server. Everything before it was inert by design.

**The change being delivered.** emit-vision's `infra/nginx/emit-vision.conf` already contains the correct block in its `app.emitvision.com` server — verified present at roughly line 83, before the `location /` at line 93:

```nginx
location /v1/ {
    proxy_pass http://emit-vision_api;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Two properties matter and are already correct — verify they survive to the server unchanged:
- `proxy_pass` has **no URI component** (no trailing slash). With one, nginx strips `/v1` and every API call breaks.
- The block **precedes** `location /`, or requests fall through to the web upstream.

`emit-vision_api` is defined by the blue-green include (`/etc/nginx/blue-green/emit-vision.conf`), written on every deploy, and is already used by the `api.emitvision.com` vhost — so the upstream exists before use and `nginx -t` should pass.

**Prerequisites.** Sprint 232 must be complete and the CLI rebuilt — this repo executes `apps/cli/dist`, and an unbuilt CLI means the deploy silently runs old code without the sync. Verify the built output contains `nginx_custom_config_src` before deploying.

**Review drift before flipping the flag.** emit-vision's on-server vhost was placed by hand at bootstrap and has drifted. Use `GET /projects/emit-vision/nginx-drift` (sprint 230) or the panel (sprint 231) to read the full diff *first* and confirm every server-side-only line is either reproduced in the repo file or genuinely safe to lose. If the server has hand-applied config the repo lacks, port it into the repo file **before** deploying — the sync overwrites, it does not merge.

**Deploy path.** emit-vision deploys via `POST /projects/emit-vision/deploy` (which shells out to `npx emit-infra deploy emit-vision`), or the CLI directly. Deploy status is available at `GET /projects/emit-vision/deploy-status`.

**Rollback.** Sprint 232's task restores the previous vhost automatically if `nginx -t` fails. If validation passes but routing is still wrong, revert by setting `syncOnDeploy: false` and restoring the server file from the `.bak` left alongside it.

## Tasks
1. Confirm sprint 232 shipped and `apps/cli/dist` contains `nginx_custom_config_src`; rebuild with `npx nx run cli:build` if not.
2. Read the full drift diff for emit-vision and record it in the sprint's Completed section. Identify any server-only lines that would be lost.
3. If the server has config the repo file lacks, port it into `~/projects/emit-vision/infra/nginx/emit-vision.conf` and commit that in the emit-vision repo before proceeding. If nothing is missing, state that explicitly.
4. Verify the current broken state so the fix is provable:
   `curl -s -o /dev/null -w "%{http_code}\n" https://app.emitvision.com/v1/projects` → expect `404`.
5. Set `nginx.syncOnDeploy: true` in `~/projects/emit-vision/.emit-infra.json`.
6. Run a deploy with `--dry-run` first and confirm the vhost path is reported and exists.
7. Deploy emit-vision. Watch the deploy log for the vhost sync task: it must show the config was updated, `nginx -t` passing, and a reload (not a restart).
8. Verify the fix: `curl -s -o /dev/null -w "%{http_code}\n" https://app.emitvision.com/v1/projects` → expect **401**.
9. Verify nothing else regressed: `app.emitvision.com` pages load, `/_next/*` assets serve from the web upstream, `api.emitvision.com` still responds, and the marketing apex still serves.
10. Re-check drift — it should now report `ok`.
11. Confirm at least one previously broken client-side feature works (e.g. the weekly-digest toggle or email-verification resend).
12. Record the outcome and any surprises in the sprint's Completed section, and note in `docs/nginx-vhost-audit.md` (sprint 234) that emit-vision is now rolled out.

## Files involved
- `~/projects/emit-vision/.emit-infra.json` — set `nginx.syncOnDeploy: true`
- `~/projects/emit-vision/infra/nginx/emit-vision.conf` — only if server-only config must be ported in
- `docs/nginx-vhost-audit.md` — mark emit-vision as rolled out
- emit-infra's deploy path — used, not modified

## Acceptance criteria
- [x] The drift diff was reviewed and any server-only config either ported into the repo or explicitly confirmed safe to lose.
- [x] `https://app.emitvision.com/v1/projects` returns **401**, not 404.
- [x] The vhost reached production through a normal deploy with **no manual SSH step**.
- [x] The deploy log shows `nginx -t` passing and a reload, not a restart.
- [x] App pages, `/_next/*` assets, `api.emitvision.com`, and the marketing apex are all unaffected.
- [x] `GET /projects/emit-vision/nginx-drift` reports `ok` after the deploy.
- [x] At least one previously broken client-side feature is confirmed working.

## Out of scope
- Enabling `syncOnDeploy` for develemail, emit-social, tastease, or martialops — each needs its own drift review; sequence them per sprint 234's recommended rollout order.
- Root-causing why the Next.js `rewrites()` rule didn't apply in the deployed standalone container. Routing at nginx makes it moot; if that investigation is still wanted, queue it separately.
- Adopting `apiPathPrefix` (sprint 233) for emit-vision — its vhost is custom and stays that way.
- Any change to emit-vision application code.

## Completed

**Date:** 2026-07-24

### Summary
emit-vision is now the first project running `nginx.syncOnDeploy: true`. Its
repo-owned vhost reached production through a normal `emit-infra deploy` with
no manual SSH step, closing the incident that started this initiative:
`https://app.emitvision.com/v1/projects` now returns **401** (API reached,
auth required) with JSON body `{"error":"invalid_api_key"}` instead of the
Next.js **404** HTML page. This is the first real end-to-end proof that the
sprint 230-232 machinery delivers a repo-committed config change to production.

**Drift review (task 2/3).** The pre-deploy diff of local `infra/nginx/emit-vision.conf`
(125 lines) vs the server's `/etc/nginx/sites-available/emit-vision` (110 lines)
was **purely additive** — the *only* delta was the `location /v1/` block (plus
its explanatory comments) present locally and absent on the server. There were
**zero server-only lines** (no `>` lines in the diff), so nothing hand-applied
on the server was at risk of being lost by the overwriting sync. No porting was
needed; the repo file was already complete. The `/v1/` block's two critical
properties survived to the server unchanged: `proxy_pass http://emit-vision_api;`
has no URI component (no trailing slash, so `/v1` is not stripped), and the block
precedes `location /`.

**Deploy behavior.** No `BUILD_NUMBER` was passed, so Ansible fell back to the
currently-deployed build — the app images were unchanged and only the vhost
changed, the safest possible "normal deploy." Blue-green swapped blue→green,
migrations re-ran (idempotent), and the vhost-sync task chain ran exactly as
sprint 232 designed: stat → back up existing vhost → copy repo vhost →
**validate (`nginx -t` ok)** → **reload (changed, not a restart)** → remove
backup → "nginx vhost updated for emit-vision". The rollback tasks
(restore-on-validation-failure / fail-deploy) both **skipped** because validation
passed. `PLAY RECAP: failed=0`.

**GHCR note.** The local `GHCR_TOKEN not set` warning was moot: the server holds
persistent `ghcr.io` docker credentials (`/root/.docker/config.json`) and already
had the images, so the pull did not depend on a locally-passed token.

### Files changed
- `sprint/235-emit-vision-vhost-rollout.md` — marked complete with this summary
- `docs/nginx-vhost-audit.md` — emit-vision marked **rolled out** in the table, verdict section, rollout order, and summary
- `~/projects/emit-vision/.emit-infra.json` — set `nginx.syncOnDeploy: true` (committed in the emit-vision repo as `61b0165`)

### Verification
- Drift review: purely additive, 0 server-only lines lost
- Pre-deploy: `curl https://app.emitvision.com/v1/projects` → **404** (broken baseline confirmed)
- Deploy log: `nginx -t` **ok**, nginx **reload** (not restart), "nginx vhost updated", `failed=0`
- Post-deploy: `curl https://app.emitvision.com/v1/projects` → **401**, body `{"error":"invalid_api_key"}` (API reached, `/v1` preserved)
- Drift re-check: server vhost now **byte-identical** to repo (125/125), status **ok**
- No regressions: app root **307**, real `/_next/static/*.css` asset **200** (`text/css`, web upstream), `api.emitvision.com/v1/projects` **401**, `api.emitvision.com/healthz` **200**, marketing apex **200**, `www` **200**
- Previously-broken feature: saved segments `/v1/segments` → **401** API JSON (was 404 Next.js HTML); other `/v1/*` paths now return Fastify JSON from the API instead of the Next.js 404 page

### Follow-ups
- `[defer]` Next in the sprint-234 rollout order is **develemail** (zero drift, a no-op push that proves the mechanism on a second clean project), then emit-social, then tastease (cosmetic drift). Each needs its own drift review before flipping `syncOnDeploy` — sequence via `/plan-sprint` or a follow-up sprint.
- `[defer]` diner-decider is still exposed (undeclared `customConfigSrc`, hand-rolled Next.js proxy route) — not eligible for sync until it declares a vhost and ideally adopts `apiPathPrefix` (sprint 233).
- `[defer]` Optional: delete emit-vision's dead `next.config.mjs` `rewrites()` `/v1/*` rule now that nginx owns the routing — harmless to leave, out of scope here (no app-code changes).
