# Audit the fleet for framework-proxied API paths and undeployed vhosts
**Difficulty:** 3

## Goal
A written report identifying, for every managed project: whether its browser code calls a relative API path that is proxied by the app framework rather than by nginx, and whether it declares a vhost that nothing currently deploys — with a per-project verdict on whether it is exposed to the same silent-404 failure emit-vision hit.

## Reason
This is the explicit closing ask from the emit-vision incident report: *"audit the other managed projects for the same class of problem."* The emit-vision failure was invisible for a long time because server-rendered pages fetch the API directly server-side and kept working, so the dashboard looked healthy while every client-side feature was broken. Any project with the same shape has the same blind spot right now, and nobody would know.

We already know the vhost half of the answer is bad: five of seven projects declare `nginx.customConfigSrc` and none of those files have been deployed since bootstrap. What's unknown is the framework-proxy half — which projects depend on a Next.js `rewrites()` rule or a Vite proxy to forward API calls in production. Sprints 232 and 233 built the fix; this sprint determines where to point it, and in what order, before sprint 235 starts flipping projects on.

## Context
This sprint is **read-only investigation producing a document**. It changes no project code and deploys nothing.

Managed projects live under `~/projects/`. Each has a `.emit-infra.json`. Current known state of the `nginx` block:

| Project | `customConfigSrc` | blueGreen |
|---|---|---|
| emit-vision | `infra/nginx/emit-vision.conf` | yes |
| develemail | `infra/nginx/prod.conf` | yes |
| emit-social | `docker/nginx/prod.conf` | yes |
| tastease | `docker/nginx/prod.conf` | yes |
| martialops | `docker/nginx/martialops.conf` | no |
| diner-decider | — | yes |
| test-smoke | — | no |

What to look for in each project repo:

- **Framework proxying** — a `rewrites()` block in `next.config.*` (especially one whose `destination` points at an env var like `API_BASE_URL`), a `server.proxy` entry in `vite.config.*`, or equivalent. These work in dev and are unreliable in production containers; that mismatch is the root of the emit-vision incident.
- **Relative API calls from browser code** — client components / hooks calling `fetch('/v1/...')` or similar relative paths. Relative URLs are *correct* (same-origin keeps the session cookie and a `connect-src 'self'` CSP working) — the bug is relying on the **app** rather than **nginx** to forward them.
- **Vhost reality** — does the declared `customConfigSrc` file exist? Does its content route the API prefix at nginx, or does it send everything to the web upstream and assume the app forwards?
- **The tell** — a project is exposed when browser code calls a relative API path AND the vhost has no matching `location` block for that prefix AND a framework rewrite exists to cover it.

Useful verification for any project already live: `curl -s -o /dev/null -w "%{http_code}\n" https://<host>/<api-prefix>/<known-endpoint>` — a `404` carrying `x-powered-by: Next.js` means the request reached the web app instead of the API. A `401`/`200` means nginx routed it correctly.

The drift API from sprint 230 (`GET /projects/:name/nginx-drift`) can answer the "has the vhost drifted" half directly for each project — use it rather than diffing by hand.

Write the report to `docs/` (create the directory if absent) so it survives as a reference; this repo keeps operational notes in markdown rather than only in sprint files.

## Tasks
1. For each project under `~/projects/` with a `.emit-infra.json`, record: declared `customConfigSrc`, whether that file exists, and whether the project is blue-green.
2. Query `GET /projects/:name/nginx-drift` for each project that declares a vhost and record the drift verdict (`ok` / `drift` / `missing-server` / unreachable). Note the size of the drift, not just its presence.
3. Search each project's source for framework-level proxy config (`next.config.*` `rewrites()`, `vite.config.*` `server.proxy`, or equivalent) and record what path prefixes it forwards and to where.
4. Search each project's browser/client code for relative API calls and identify the path prefix(es) in use.
5. For each project, determine whether the declared vhost routes those prefixes at nginx, and assign a verdict: **exposed** (relies on framework proxying in prod), **safe** (nginx routes the prefix), or **n/a** (no split web/API behind one hostname).
6. Where a project is live and reachable, confirm the verdict with the `curl` status-code check described above rather than relying on code reading alone.
7. Write `docs/nginx-vhost-audit.md` containing: the per-project table, each verdict with its evidence, the recommended remediation per project (`syncOnDeploy` opt-in, `apiPathPrefix` adoption, or no action), and a **recommended rollout order** — safest first, riskiest last — for the sprint-232 flag.
8. Append any project-specific follow-up work surfaced by the audit to `backlog.md` using this repo's existing `- (sprint 234, YYYY-MM-DD) …` format.

## Files involved
- (new file) `docs/nginx-vhost-audit.md` — the audit report and rollout recommendation
- `backlog.md` — append follow-ups surfaced by the audit
- `~/projects/*/.emit-infra.json` — read-only inputs
- `~/projects/*/` app source and vhost files — read-only inputs

## Acceptance criteria
- [x] Every project with a `.emit-infra.json` appears in the report with an explicit verdict — no project silently omitted.
- [x] Each **exposed** verdict cites concrete evidence (the rewrite rule, the relative call site, the missing `location` block).
- [x] Live projects' verdicts are confirmed by HTTP status code, not code reading alone.
- [x] The report ends with a recommended rollout order for enabling `nginx.syncOnDeploy`, with reasoning.
- [x] No project source outside emit-infra is modified, and nothing is deployed.

## Out of scope
- Fixing any project found to be exposed — this sprint only identifies and sequences. Remediation is sprint 235 (emit-vision) and follow-on work for the rest.
- Enabling `syncOnDeploy` for any project.
- Modifying any app repo's `next.config.*` or vhost file.
- Deploying anything.

## Completed

**Date:** 2026-07-24

### Summary
Audited all 7 projects with a `.emit-infra.json` for the emit-vision incident's failure class — a browser-side relative API call whose routing correctness depends on the app framework rather than nginx. Wrote the findings to `docs/nginx-vhost-audit.md`.

Two projects are exposed: **emit-vision** (fix already committed to the repo vhost, confirmed absent on the server via `GET /projects/emit-vision/nginx-drift` and a live `curl` returning `404`/`x-powered-by: Next.js` — remediation is sprint 235, already scoped) and **diner-decider**, a new finding not previously tracked anywhere — its `.emit-infra.json` never declared `nginx.customConfigSrc` despite a real vhost existing in the repo (`infra/nginx/prod.conf`), and its `/api/*` browser calls are forwarded by a hand-rolled Next.js App Router catch-all Route Handler rather than by nginx. It's currently functioning (confirmed via live `curl` — `401`, reached the real API) but is the same architectural risk class, invisible to every piece of drift/sync tooling sprints 230-233 built because the vhost was never declared.

Two projects (develemail, tastease) already use the correct nginx-level `/api/` routing and are safe; tastease carries cosmetic-only drift (upstream variable renames, not a routing change — confirmed by reading the full diff, not just the drift status flag) worth syncing but not urgent. Two projects (emit-social, martialops) use a separate-subdomain architecture where the framework-proxy question doesn't apply; martialops is additionally shelved with no live server (confirmed via DNS failure on the apex domain and a pre-existing backlog note). `test-smoke` is a test fixture with no real service.

The report closes with a rollout order for `nginx.syncOnDeploy`: emit-vision (sprint 235) → develemail → emit-social → tastease → diner-decider (blocked on declaring `customConfigSrc` first) → martialops (blocked on the project being un-shelved). This directly informs the order sprint 235 and any follow-on sprints should proceed in.

### Files changed
- (new) `docs/nginx-vhost-audit.md` — the full audit report: per-project table, verdicts with evidence, and the rollout order
- `backlog.md` — appended 5 follow-up items surfaced by the audit (diner-decider config gap, diner-decider proxy risk, tastease cosmetic drift, martialops origin-cert error)

### Verification
- Read every declared `customConfigSrc` vhost file for all 5 projects that have one; confirmed file existence for all 5.
- Started the emit-infra API locally (`npx nx run api:dev`) and queried `GET /projects/:name/nginx-drift` for all 7 projects — results: emit-vision `drift`, develemail `ok`, emit-social `ok`, tastease `drift`, martialops `missing-server`, diner-decider `unconfigured`, test-smoke `unconfigured`.
- Grepped every project's `next.config.*`/`vite.config.*` for `rewrites()`/proxy rules and every project's browser/client source for relative `fetch()` calls to `/api`, `/v1`.
- Live `curl` checks against every reachable hostname (emit-vision, develemail, emit-social ×2, tastease, martialops apex + api, diner-decider): confirmed emit-vision's exposure (`404`, Next.js), diner-decider's currently-working-but-exposed proxy (`401`, reached API), develemail/tastease/emit-social safety (`400`/`401`/`307`+`401`), and martialops's apex DNS failure + api-subdomain Cloudflare `526`.
- No project source outside `emit-infra` was modified; no deploy command was run against any project.

### Follow-ups
- `[address-next]` diner-decider's `.emit-infra.json` should get `nginx.customConfigSrc: "infra/nginx/prod.conf"` added — a small, low-risk config-only change that unblocks drift visibility for that project. Logged in `backlog.md`.
- `[defer]` diner-decider's `/api/*` routing should migrate from the hand-rolled Next.js Route Handler to the sprint-233 `apiPathPrefix`/`apiUpstream` nginx template — real remediation work, appropriately sized as its own future sprint rather than a quick fix here.
- `[defer]` tastease's cosmetic nginx drift (upstream variable renames) is safe to leave as-is but should be synced eventually to keep the server config auditable.
- `[defer]` martialops's `api.martialops.app` subdomain returns a Cloudflare 526 (invalid origin SSL cert) — unrelated to this audit's scope, noted for whenever the project is un-shelved.
