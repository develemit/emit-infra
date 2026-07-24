# Fleet audit: framework-proxied API paths and undeployed vhosts

**Date:** 2026-07-24
**Sprint:** 234
**Scope:** every project under `~/projects/` with a `.emit-infra.json` (7 total). Read-only — no project source was modified, nothing was deployed.

## Why this exists

emit-vision's browser-side API calls (`/v1/*` on `app.emitvision.com`) returned 404 for an extended period because the app relied on a Next.js `rewrites()` rule that does not apply inside the deployed standalone container, and the vhost had no matching nginx `location` block to catch the gap. Server-rendered pages kept working (they fetch the API directly, server-side), so the dashboard looked healthy while every client-side feature was silently broken. Sprints 230-233 built the machinery to fix and prevent this (drift detection, opt-in vhost sync-on-deploy, a template `apiPathPrefix`/`apiUpstream` pair). This sprint determines which other projects have the same shape of risk, and in what order they should be brought onto that machinery.

## Method

For each project: read `.emit-infra.json`'s `nginx` block, check the declared vhost file exists locally, query `GET /projects/:name/nginx-drift` for the current server-vs-repo diff, search `next.config.*`/`vite.config.*` for `rewrites()`/proxy rules, search browser/client code for relative `fetch()` calls, cross-reference against the vhost's `location` blocks, and — for every project with a resolvable hostname — confirm the verdict with a live `curl` status-code check.

## Per-project table

| Project | `customConfigSrc` | File exists | Blue-green | Drift status | Verdict |
|---|---|---|---|---|---|
| emit-vision | `infra/nginx/emit-vision.conf` | yes | yes | **drift** (125 local / 110 server lines) | **exposed** |
| develemail | `infra/nginx/prod.conf` | yes | yes | ok (0 diff) | **safe** |
| emit-social | `docker/nginx/prod.conf` | yes | yes | ok (0 diff) | **n/a** |
| tastease | `docker/nginx/prod.conf` | yes | yes | drift (179 local / 125 server lines, cosmetic) | **safe** |
| martialops | `docker/nginx/martialops.conf` | yes | no | missing-server | **n/a** (shelved) |
| diner-decider | *(undeclared)* | n/a | yes | unconfigured | **exposed** |
| test-smoke | *(undeclared)* | n/a | no | unconfigured | **n/a** (test fixture) |

## Verdicts with evidence

### emit-vision — exposed

- **Framework proxy:** `apps/web/next.config.mjs:70-71` — `rewrites()` forwards `/v1/:path*` to `API_BASE_URL`. Per the code's own comment in the vhost file, this rewrite "does not apply `/v1/*` proxying in the deployed [standalone] container."
- **Relative calls:** browser code calls `/v1/billing/portal`, `/v1/admin/org/sso`, `/v1/admin/org/sso/enforced` (real backend API). It also calls `/api/keys/rotate`, `/api/prefs-cache`, `/api/views`, `/api/me/preferences` — but these resolve to Next.js's *own* route handlers under `apps/web/src/app/api/**` and are not a proxying concern.
- **Vhost reality:** the repo file `infra/nginx/emit-vision.conf` already has the fix — a `location /v1/` block preceding `location /` in the `app.emitvision.com` server, added specifically to close this gap. The **server** does not have it yet: `GET /projects/emit-vision/nginx-drift` returns `status: "drift"` with the `app.emitvision.com` server block's `location /v1/` line appearing only on the local side of the diff; the server's block still goes straight from the SSL cert lines to `location /`.
- **Live confirmation:** `curl -sI https://app.emitvision.com/v1/projects` → `HTTP/2 404` with `x-powered-by: Next.js` — the request is reaching the Next.js app's 404 page, not the API.
- **Remediation:** already scoped as sprint 235 — flip `nginx.syncOnDeploy: true` and deploy to push the already-correct repo vhost to the server.

### develemail — safe

- **Framework proxy:** `apps/web/next.config.js:23-24` has a `rewrites()` forwarding `/api/:path*` to `INTERNAL_API_URL` — present but dead code in production, see below.
- **Relative calls:** `/api/unsubscribe/confirm`.
- **Vhost reality:** `infra/nginx/prod.conf:55-62` has an explicit `location /api/ { proxy_pass http://develemail_api/; ... }` block ahead of `location /`. nginx's longest-prefix-match means `/api/` wins regardless of declaration order, so the Next.js rewrite never actually fires in production — nginx intercepts first.
- **Drift:** `GET /projects/develemail/nginx-drift` → `status: "ok"`, 71/71 lines, no diff. Server matches repo exactly.
- **Live confirmation:** `curl -X POST https://develemail.com/api/unsubscribe/confirm` → `400` (reached the API, which returned a validation error — not a Next.js 404).
- **Remediation:** none required. Optional cleanup (out of scope): the `next.config.js` rewrite is unreachable dead code and could be deleted, but leaving it is harmless.

### emit-social — n/a

- **Framework proxy:** none found (no `rewrites()` in `apps/web/next.config.js`).
- **Relative calls:** none found. `apps/web/src/lib/api.ts:1-2` builds `API_URL` from `NEXT_PUBLIC_API_URL`, an absolute URL.
- **Architecture:** web (`social.develemit.com`) and API (`api.social.develemit.com`) are two separate subdomains, each with their own nginx `server{}` block and their own SSL cert coverage. There is no single hostname where a path prefix needs splitting between app and API — the browser talks to `api.social.develemit.com` directly, cross-origin.
- **Drift:** `status: "ok"`, 52/52 lines, no diff.
- **Live confirmation:** web `/` → `307` (redirect, expected), API `/` → `401` (reached, auth required). Both origins independently reachable.
- **Remediation:** none. Not the same architecture shape as the incident.

### tastease — safe

- **Framework proxy:** `apps/web/next.config.ts:37-44` has a `rewrites()` forwarding `/api/:path*` to `INTERNAL_API_BASE_URL` — present but dead code in production, same reasoning as develemail.
- **Relative calls:** `/api/push/preferences`, `/api/push/subscriptions`, `/api/push/public-key`, `/api/auth/session`, `/api/glossary`, `/api/invites/send-email` (with one hand-carved exception route for a Next-hosted email-sending handler).
- **Vhost reality:** `docker/nginx/prod.conf:129-164` has three ordered blocks on `app.tastease.app`: `location /api/auth/` → web (NextAuth), `location = /api/invites/send-email` (exact match, Next-hosted route), `location /api/` → API container, all ahead of `location /`.
- **Drift:** `GET /projects/tastease/nginx-drift` → `status: "drift"` (179 local / 125 server lines) — but the diff is **cosmetic, not topological**: the server's older config uses different upstream variable names (`api_upstream`, `web_upstream`, `marketing_upstream` vs. the repo's current `tastease_api`, `tastease_web`, `tastease_marketing`) and lacks the newer Cloudflare real-IP header block and comments. Critically, the server-side diff still shows a `location /api/ { proxy_pass http://api_upstream; ... }` block ahead of `location /` — the routing split survives the drift, only the naming has diverged.
- **Live confirmation:** `curl https://app.tastease.app/api/push/public-key` → `401` (reached the API, auth required — not a Next.js 404).
- **Remediation:** low priority. The drift should still be synced (via `syncOnDeploy`) to eliminate the naming divergence and keep the server config auditable, but there is no active safety issue — verify the server's blue-green include actually defines `api_upstream`/`web_upstream`/`marketing_upstream` before assuming the current server config is self-consistent (it must, since the live curl check succeeded).

### martialops — n/a (shelved)

- **Framework proxy:** none found in `apps/web` or `apps/marketing-web`.
- **Relative calls:** none found. `libs/web/attendance/src/browser-api.ts:9-11` (and sibling `browser-api.ts` files in the other `libs/web/*` packages) build `MartialOpsApiClient` from `NEXT_PUBLIC_API_URL`, an absolute URL pointed at the separate `api.martialops.app` subdomain — same cross-origin shape as emit-social.
- **Drift:** `GET /projects/martialops/nginx-drift` → `status: "missing-server"` — no vhost file exists on the server at all.
- **Live confirmation:** `martialops.app` does not resolve via DNS (`curl: (6) Could not resolve host`). `api.martialops.app` resolves but returns Cloudflare `526` (invalid origin SSL certificate) — the origin isn't correctly serving TLS for that host.
- **Context:** this is not a new finding. `backlog.md` already documents (sprint 230 follow-up, resolved-as-not-a-gap) that martialops is shelved and has no live server; the `missing-server` drift status is the *expected* report for a project with a declared vhost but no running instance behind it.
- **Remediation:** none from this audit. If/when martialops is un-shelved and (re)provisioned, re-run this audit's live-confirmation step before assuming the separate-subdomain architecture is still safe in practice.

### diner-decider — exposed

- **`.emit-infra.json` gap:** `nginx.customConfigSrc` is **not declared** at all — `GET /projects/diner-decider/nginx-drift` returns `status: "unconfigured"`. This is despite a real, apparently-live nginx vhost existing in the repo at `infra/nginx/prod.conf`, which is not referenced anywhere in the project config. emit-infra has zero visibility into this project's nginx state: no drift detection, no `syncOnDeploy` eligibility, no template adoption path — sprints 230-233's entire toolchain is inert for this project until the config gap is closed.
- **Vhost reality:** `infra/nginx/prod.conf:34-70` (the apparent live config, confirmed reachable — see below) has exactly one `server{}` for `dinerdecider.com`/`www.dinerdecider.com`, with only two locations: `/_next/static/` and `location / { proxy_pass http://diner_web; ... }`. **There is no `/api/` location block.** Every request, including `/api/*`, falls through to the Next.js web app.
- **Framework proxy (the equivalent):** this is not a `next.config.js` `rewrites()` rule (grepped, none found) but a hand-rolled Next.js App Router catch-all Route Handler at `apps/web/src/app/api/[...path]/route.ts`. It forwards every method (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`/`OPTIONS`) under `/api/*` to `API_INTERNAL_URL` (defaults to `http://localhost:5002`), stripping hop-by-hop headers and manually forwarding cookies. Functionally this *is* framework-level proxying — the sprint's definition explicitly includes "equivalent" mechanisms, not just the declarative `rewrites()` config shape.
- **Relative calls:** `/api/me`, `/api/households/mine`, and others across `apps/web/src`.
- **Live confirmation:** `curl https://dinerdecider.com/api/me` → `401` — this **is currently working**: the catch-all route handler is successfully forwarding to the real API and returning its real response, not a Next.js 404. Unlike emit-vision's `next.config.js` rewrite (which is documented to silently no-op in the standalone container), an App Router Route Handler is real application code that runs the same way in every environment, so there is no equivalent "doesn't apply in production" failure mode here today.
- **Why this still counts as exposed:** the routing correctness for every `/api/*` call depends entirely on `apps/web/src/app/api/[...path]/route.ts` continuing to exist, continuing to be wired to the right internal URL, and Next.js continuing to route it ahead of any conflicting page/route — with no independent nginx-level backstop and no emit-infra visibility into any of it. If that route handler is ever refactored, misconfigured, or shadowed by another route, the failure mode is identical to emit-vision's: a same-origin relative call silently starts hitting Next's own 404 handling instead of the API, and server-rendered pages will keep working, masking the break the same way. It is a **lower-severity** case than emit-vision (currently functioning, and Route Handlers don't share the specific standalone-rewrite failure mode) but the **same architectural class** of risk, compounded by the fact that emit-infra can't currently detect drift or route around it because the vhost isn't declared.
- **Remediation (two independent steps, do both):**
  1. Add `"nginx": { "customConfigSrc": "infra/nginx/prod.conf" }` to `diner-decider/.emit-infra.json` immediately — zero risk, makes the existing vhost visible to drift detection and the deploy-time sync flag. This alone doesn't fix the routing gap but stops it from being invisible.
  2. Adopt the sprint-233 `apiPathPrefix`/`apiUpstream` template fields (`apiPathPrefix: "/api"`, `apiUpstream: "diner_api"` — the blue-green include already defines an API upstream per `docker-compose.prod.yml`'s api service) to render a proper nginx `location /api/` block ahead of `location /`. This moves routing correctness back to nginx and lets `apps/web/src/app/api/[...path]/route.ts` be deleted, eliminating the app-level dependency entirely. Confirm the upstream name matches whatever the blue-green deploy script actually writes into `/etc/nginx/blue-green/diner-decider.conf` before wiring this up (`diner_web` is used elsewhere in the vhost, suggesting the API upstream is likely named similarly, e.g. `diner_api`).

### test-smoke — n/a

- `.emit-infra.json` domain is `192.0.2.1` (RFC 5737 TEST-NET-1, a documentation/reserved address) and the project has no other files beyond the config — this is a test fixture, not a real deployed service. No nginx config, no app code, nothing to audit.

## Recommended rollout order for `nginx.syncOnDeploy`

Safest (already verified zero-diff) first, riskiest (broken or unmanaged) last:

1. **emit-vision** — already scoped as sprint 235; the fix is written and verified correct, this is the first real use of the sprint-232 machinery end to end.
2. **develemail** — zero drift (`ok`, 71/71 lines identical). Flipping the flag is a no-op push that proves the mechanism on a second, already-clean project before it's trusted anywhere with real drift to resolve.
3. **emit-social** — zero drift (`ok`, 52/52 lines identical), same reasoning as develemail. Also unaffected by the framework-proxy question entirely (separate subdomains).
4. **tastease** — drift is real but cosmetic (upstream variable renames only); the routing-critical `location /api/` block survives on both sides and is live-confirmed working. Before flipping, verify the blue-green include on the server actually defines `api_upstream`/`web_upstream`/`marketing_upstream` (it must, since the live curl check succeeded) so the sync doesn't accidentally reference upstreams the deploy script no longer writes under the old names.
5. **diner-decider** — not eligible yet. First add `nginx.customConfigSrc` to `.emit-infra.json` (step 1 above) and let a drift check run once to establish a baseline; ideally also complete the `apiPathPrefix` migration (step 2 above) so the first-ever sync also closes the routing gap, rather than shipping a vhost that still lacks an `/api/` block.
6. **martialops** — do not enable. There is no live server (`missing-server`, apex DNS doesn't resolve, API subdomain has an invalid origin cert). Sync-on-deploy has nothing to reconcile against; this needs an infra/DNS investigation first, independent of this initiative, if/when the project is un-shelved.

`test-smoke` is excluded — it isn't a real service.

## Summary

Of seven managed projects, **two are currently exposed to the emit-vision failure class**: emit-vision itself (fix written, not yet deployed — sprint 235 closes this) and diner-decider (currently working via a hand-rolled Next.js proxy route, but invisible to emit-infra and one refactor away from the same silent break). Two projects (develemail, tastease) use the correct nginx-level pattern already and are safe, with tastease carrying cosmetic drift worth syncing. Two projects (emit-social, martialops) use a separate-subdomain architecture where the question doesn't apply; martialops is additionally shelved with no live server. One project (test-smoke) is a test fixture.
