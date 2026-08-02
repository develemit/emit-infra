# Migrate diner-decider's /api/* routing from the Next.js handler to the nginx template
**Difficulty:** 4

> _Promoted from sprint-234 / sprint-235 follow-ups, 2026-08-01._

## Goal
diner-decider's `/api/*` traffic is routed by nginx using the sprint-233 `apiPathPrefix` / `apiUpstream` template rather than a hand-rolled Next.js Route Handler, and the project becomes eligible for `nginx.syncOnDeploy`.

## Reason
Sprint 234's fleet audit found diner-decider proxying its API through a Next.js Route Handler inside the app rather than at the edge. Sprint 234 logged this explicitly as "real remediation work, appropriately sized as its own future sprint rather than a quick fix here," and sprint 235 confirmed diner-decider was "still exposed... not eligible for sync until it declares a vhost and ideally adopts `apiPathPrefix`."

Half of that has since happened: diner-decider now declares `nginx.customConfigSrc: "infra/nginx/prod.conf"` (added while fixing its 19-hour outage on 2026-07-24, commits `4b95eab` / `4e0f44e`). The routing migration is the remaining half, and it is what unblocks sprint 246's deferred fourth project.

Routing API traffic through the Next.js server means every API request pays for a Node hop that nginx could serve directly, and it puts application code in the path of a concern the edge already owns. Sprint 233 built `apiPathPrefix`/`apiUpstream` for exactly this shape but deliberately shipped it unused — no project's config was updated. diner-decider is the intended first consumer.

## Context
- **Sprint 233 built the capability, nothing consumes it yet.** Read its `## Completed` section for the exact config keys, the template's generated output, and its stated constraints. emit-vision deliberately stays on `customConfigSrc` because its vhost is too custom for the template — do not treat emit-vision as the pattern to copy here.
- **Find the current handler first.** Locate the Next.js Route Handler doing the proxying in `~/projects/diner-decider` (likely under `app/api/`), and establish exactly which paths it handles, what it forwards to, and whether it does anything beyond proxying (auth, header rewriting, body transformation). **If it does more than proxy, that logic must be preserved or deliberately relocated — nginx will not carry it.** This is the main risk in the sprint; do not assume it is a pure pass-through.
- **This is a live production site.** dinerdecider.com was down for 19 hours on 2026-07-24 from an nginx misconfiguration. Validate with `nginx -t` before any reload, keep a backup of the working vhost, and be prepared to roll back. Verify the site serves before and after.
- **Check DNS/CDN.** Confirm whether diner-decider sits behind Cloudflare proxying, since that affects how origin routing changes surface and how quickly.
- **Sequencing.** This sprint should land before diner-decider gets `nginx.syncOnDeploy: true`. Enabling sync is explicitly sprint 246's out-of-scope item, deferred to after this migration.
- Read the `## Completed` sections of sprints **233** (the template), **234** (the audit finding), and **235** (the rollout precedent and its verification approach).

## Tasks
1. Inventory the existing Next.js Route Handler: which paths, which upstream, and any non-proxy logic it performs.
2. Decide and document whether each piece of that logic moves to nginx, stays in the app, or is dropped — non-proxy behavior must not be silently lost.
3. Add `apiPathPrefix` / `apiUpstream` to diner-decider's `.emit-infra.json` per sprint 233's contract.
4. Generate the vhost and diff it against the live server config before applying anything.
5. Apply with `nginx -t` validation and a backup of the previous config; reload rather than restart.
6. Verify `/api/*` routes serve correctly end-to-end against production, including at least one route that exercised the handler's non-proxy behavior if any existed.
7. Remove the now-dead Next.js Route Handler once nginx is confirmed serving those paths.
8. Confirm the drift route reports no drift for diner-decider afterward.

## Files involved
- `~/projects/diner-decider/.emit-infra.json` — add `apiPathPrefix` / `apiUpstream`
- `~/projects/diner-decider/infra/nginx/prod.conf` — the declared vhost source
- `~/projects/diner-decider/app/api/**` — the Route Handler being retired (confirm the actual path)
- `ansible/roles/nginx/templates/` — read-only reference for the sprint-233 template
- `apps/api/src/routes/nginx-config.ts` — read-only reference for the drift check

## Acceptance criteria
- [ ] diner-decider's `.emit-infra.json` declares `apiPathPrefix` / `apiUpstream`. — **deliberately not done; see Completed summary.**
- [x] nginx serves `/api/*` directly; the Next.js Route Handler no longer participates in that path.
- [x] Any non-proxy behavior the handler performed is preserved somewhere explicit, or its removal is deliberately documented.
- [x] The generated vhost was diffed against live config before being applied.
- [x] `nginx -t` passed before reload, and a backup of the prior config exists on the server.
- [x] dinerdecider.com and its `/api/*` routes serve correctly after the change, verified against production.
- [x] The drift route reports no drift for diner-decider.
- [x] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- Enabling `nginx.syncOnDeploy` for diner-decider — the natural next step, but a separate change once this is proven.
- Migrating any other project to `apiPathPrefix`.
- Broader diner-decider application refactoring beyond removing the retired handler.

## Completed

**Date:** 2026-08-01

### Summary
This sprint's premise was already false when it was authored. `backlog.md` (filed by sprint 246's auto-loop, 2026-08-01) already flagged it: diner-decider's `/api/*` migration off the hand-rolled Next.js catch-all route landed in commit `4e0f44e` (2026-07-23/24, during the dinerdecider.com outage fix), before this sprint ever ran. Per the run's standing instructions, I verified that note against diner-decider's actual code first rather than re-doing landed work.

**Verification of the obsolescence claim.** `apps/web/src/app/api/[...path]/route.ts` (the catch-all proxy) and its test are gone from the repo; only `hello` and the two OAuth-callback routes remain under `apps/web/src/app/api`, and those are genuine Next.js handlers (they interpret the OAuth response, set the session cookie, and redirect — not proxies). `infra/nginx/prod.conf` now has an explicit `location /api/ { proxy_pass http://diner-decider_api/; }` block with exact-match carve-outs for the two OAuth callbacks and `/api/hello` ahead of it, each commented with why it stays on the web upstream. I read the deleted route handler's pre-migration source (`git show 4e0f44e^:apps/web/src/app/api/[...path]/route.ts`) and confirmed it was a pure pass-through (method/header/body forwarding, hop-by-hop header stripping) with no auth or transformation logic beyond that — so there was nothing left to relocate. `apiPathPrefix`/`apiUpstream` (sprint 233's template) was never adopted and correctly wasn't: diner-decider's vhost needs the OAuth-callback exact-match carve-outs ahead of the API prefix, which the generic single-prefix template can't express — the same reasoning sprint 233 documented for emit-vision staying on `customConfigSrc`. That acceptance criterion is left unchecked as genuinely inapplicable, not skipped.

**Residual work: enabling `nginx.syncOnDeploy`.** This was the one piece sprint 246 explicitly deferred pending the /api/* migration. Checked drift first (`GET /projects/diner-decider/nginx-drift` → `status: ok`, 114/114 lines, 0 diff) — the live server vhost already matched the repo exactly. Set `nginx.syncOnDeploy: true` in diner-decider's `.emit-infra.json` and ran a real `emit-infra deploy diner-decider` to prove the sync path, per sprint 246's verification pattern.

**Unrelated blocker found and fixed during verification.** The first deploy attempt failed before reaching the nginx-sync step: `blue-green-deploy.sh` couldn't bind ports 3001/5012 because a *different*, incorrectly-named Docker Compose project (`diner-blue`, missing "-decider") had been squatting them since 2026-06-20 — six weeks of orphaned containers running a stale image, left behind by whatever earlier fix renamed the compose project to the current `diner-decider-blue`/`diner-decider-green` convention (probably alongside `4b95eab`'s upstream-name fix) without cleaning up the old one. Because `docker compose up --remove-orphans` only prunes orphans within its own project name, this was never going to self-heal — every future blue-slot deploy for diner-decider was silently broken until this sprint's deploy attempt happened to hit it. Confirmed the orphaned containers weren't serving traffic (`.active-slot` = green, nginx upstream pointed at green's ports) before stopping and removing them and their leftover network. Site was unaffected throughout (verified `/` and `/api/health` both 200 immediately before and after the cleanup). Re-ran the deploy: blue slot started cleanly, health-checked, nginx switched, old green slot stopped and pruned, vhost-sync task ran and reported "nginx vhost already current for diner-decider" (backup taken, `nginx -t` passed, no reload needed since content was already in sync).

**Two dangling diffs found in diner-decider's working tree, unrelated to this sprint, committed separately first** (matching the sprint-246 precedent of not bundling pre-existing dangling writes into an unrelated sprint's commit): a JSON-reformatting + sprint-240 `requiredEnvKeys` scaffold write to `.emit-infra.json`, and ten uncommitted `backlog.md` follow-up entries from diner-decider's own sprints 25–32.

### Files changed
- `~/projects/diner-decider/.emit-infra.json` — added `nginx.syncOnDeploy: true` (committed in the diner-decider repo as `96747fc`; two unrelated pre-existing dangling diffs committed first as `330a739` and `7fb3224`)
- `sprint/258-diner-decider-api-path-migration.md` — this file

### Verification
- Drift check (`GET /projects/diner-decider/nginx-drift`), before flip: `ok`, 114/114 lines, 0 diff.
- `emit-infra deploy diner-decider`: first attempt failed pre-nginx-switch on a port conflict (unrelated stale containers, see above; old slot kept serving, zero downtime). After removing the orphaned `diner-blue` project, re-ran: `failed=0`, blue slot healthy, nginx switched, vhost-sync task reported "nginx vhost already current", `nginx -t: ok`, vhost backup taken.
- HTTP status, before → after the full sequence (identical throughout, including across the failed-attempt/cleanup/retry cycle): `dinerdecider.com/` 200→200, `/api/hello` 200→200, `/api/health` 200→200, `/api/me` 401→401.
- Drift check, after: `ok`, 114/114 lines, 0 diff.
- emit-infra (this repo): `pnpm typecheck` clean (5/5 projects, cached), `pnpm lint` clean (5/5 projects, cached), `pnpm test` 709/709 pass across 4 testable projects (31 core + 125 api + 350 cli + 203 dashboard; `types` has no tests).

### Follow-ups
- `[blocker]` None — the production-facing issue found (orphaned `diner-blue` containers blocking all future blue-slot deploys) was fixed live as part of this sprint's verification, not left open.
- `[defer]` The same stale-orphan-project failure mode (an old, differently-named compose project squatting blue/green ports after a rename, invisible to `--remove-orphans`) could exist on other fleet servers that have gone through a similar historical rename. Worth a one-off fleet sweep (`docker compose ls -a` + `docker ps` cross-check against each project's current `.deploy-config` port list) rather than waiting to discover each one the same way — by a deploy failing.
- `[defer]` `emit-infra status <name>` is broken for diner-decider (and likely any project) when `terraform output` prints a "No outputs found" warning to stdout — the CLI concatenates that warning into the SSH hostname argument, producing `hostname contains invalid characters`. Worth having the status command parse terraform output as JSON (`-json`) rather than raw text, or filter warning lines.

## Retired

**diner-decider's `/api/*` routing migration** (the sprint's original, full-scope goal) is retired as already-complete prior art from commit `4e0f44e`, not re-implemented here. This sprint file is kept (rather than deleted) as the record of that verification and of the one piece of residual work it actually did.
