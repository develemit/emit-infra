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
- [ ] diner-decider's `.emit-infra.json` declares `apiPathPrefix` / `apiUpstream`.
- [ ] nginx serves `/api/*` directly; the Next.js Route Handler no longer participates in that path.
- [ ] Any non-proxy behavior the handler performed is preserved somewhere explicit, or its removal is deliberately documented.
- [ ] The generated vhost was diffed against live config before being applied.
- [ ] `nginx -t` passed before reload, and a backup of the prior config exists on the server.
- [ ] dinerdecider.com and its `/api/*` routes serve correctly after the change, verified against production.
- [ ] The drift route reports no drift for diner-decider.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- Enabling `nginx.syncOnDeploy` for diner-decider — the natural next step, but a separate change once this is proven.
- Migrating any other project to `apiPathPrefix`.
- Broader diner-decider application refactoring beyond removing the retired handler.
