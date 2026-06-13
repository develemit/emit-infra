# Backlog

Deferred follow-ups from completed sprints. Run `/plan-sprint` referencing this
file to promote items into proper sprints when the list grows worth addressing.

<!-- follow-up-scan: date=2026-06-13 through=58 clean=false -->
> _Sprint scan: incremental scan completed 2026-06-13 through sprint-58. 1 discovery promoted to sprint-59. Prior scan: 2026-06-13 through sprint-55 (3 discoveries → sprints 56-58)._

- (sprint 04, 2026-06-03) `pnpm build` fails on `/_error` and `/500` static pre-render — `<Html>` outside pages/_document error in Next.js 15.5.19 (upstream bug; dev server and typecheck/lint are clean) `[hold]`
- (sprint 04, 2026-06-03) Provision wizard uses local Zod schema mirroring `ProjectConfigSchema` — consider extracting shared browser-safe types into `@emit-infra/types`; run `/plan-sprint "shared types package"` to plan `[hold]`
- (sprint 05, 2026-06-03) POST /ops/chat not end-to-end tested with live ANTHROPIC_API_KEY — functional validation requires a real key `[hold]`
- (sprint 05, 2026-06-03) Sessions are in-memory only, cleared on API restart — sufficient for local use but won't survive restarts `[hold]`
- (sprint 08, 2026-06-03) Destroy modal resource list uses static defaults — ideally parsed from project's terraform directory `[hold]`
- (sprint 11, 2026-06-03) Service worker cache name is hardcoded `emit-infra-v1` — bump the key after static asset changes `[hold]`
- (sprint 10, 2026-06-03) ConfirmCard onConfirm callback is a no-op in ChatThread — wire it up if the page needs to track transitions `[hold]`
- (sprint 13, 2026-06-03) `disk` and `memory` in `ProjectStatus` were typed as `string` but the API always returned integers — the fix changed both to `number`; any client code outside this repo that depended on the string type would need updating
- (session 2026-06-03) `diner-decider` and `test-smoke` show SSH unreachable — neither has a provisioned Hetzner server yet (`test-smoke` uses TEST-NET `192.0.2.1`, `diner-decider` DNS doesn't resolve). Both need provisioning via the wizard before status monitoring will work. `diner-decider` also uses `sshKeyName: "emit-deploy"` which doesn't exist locally — update the config to match whatever key is used once provisioned.
- (sprint 34, 2026-06-11) Switch certbot HTTP-01 from `certbot --nginx` (rewrites config in-place) to `certbot certonly --webroot` with manual ssl cert path injection so Ansible stays in control of the nginx config file. Complex architectural change — run `/plan-sprint "certbot certonly webroot migration"` before queuing. `[hold]`
- (sprint 35, 2026-06-11) emit-vision `infra/scripts/deploy.sh` still contains GHCR login + blue-green-deploy.sh invocation. CI no longer calls it (sprint 35 migrated to reusable workflow), but if used as a manual ops tool it does redundant work. Strip to migrations-only. Requires access to emit-vision repo.
- (sprint 40, 2026-06-11) Blue-green slot-aware port selection in `emit-infra status` — active slot may use a different API port than `config.deploy.appPort`. Revisit once blue-green is production-proven on emit-vision. `[hold]`
- (sprint 40, 2026-06-11) Each project (emit-vision, martialops, easy-living, develemail, diner-decider) needs to add a `/healthz` route returning `{ status, build, service, uptime }` for `emit-infra status` to surface live build data. Cross-project work, not an emit-infra CLI sprint.

## ✅ Converted to Sprints

- ~~(sprint 17, 2026-06-03) Dashboard provision page doesn't include `sshKey` in config passed to `provisionProject`~~ → sprint-18 (2026-06-03)
- ~~(sprint 01) status endpoint returns HTTP 200 for unreachable~~ → sprint-12 (2026-06-03)
- ~~(sprint 02) deploy/provision don't validate paths before SSE~~ → sprint-12 (2026-06-03)
- ~~(sprint 02) no timeout on operation streams~~ → sprint-12 (2026-06-03)
- ~~(sprint 07) ProjectCard shows "— running" for container count~~ → sprint-13 (2026-06-03)
- ~~(sprint 07) HealthCard shows "—" for Server type and Public IP~~ → sprint-13 (2026-06-03)
- ~~(sprint 09) SSH key selector hardcoded to "emit-deploy"~~ → sprint-13 (2026-06-03)
- ~~(sprint 03) no error boundary for API failures~~ → sprint-14 (2026-06-03)
- ~~(sprint 03) Projects nav item at / vs /projects~~ → sprint-14 (noted in context, low priority)
- ~~(sprint 10) ops-panel.tsx superseded dead code~~ → sprint-15 (2026-06-03)
- ~~(sprint 10) cancel flow removes all confirm messages~~ → sprint-15 (2026-06-03)
- ~~(sprint 11) png-to-ico unused devDependency~~ → sprint-15 (2026-06-03)
- ~~(sprint 05) multi-tool handling breaks after first destructive tool~~ → sprint-16 (2026-06-03)
- ~~(sprint 04) provision fails for new projects without terraform templates~~ → sprint-17 (2026-06-03)
- ~~(sprint 01, 2026-06-06) Health-check custom endpoint path + configurable backoff~~ → sprint-06 (2026-06-06)
- ~~(sprint 02, 2026-06-06) Manual rollback CLI command~~ → sprint-07 (2026-06-06)
- ~~(sprint 03, 2026-06-06) Zero-downtime standby env var passthrough~~ → sprint-08 (2026-06-06)
- ~~(sprint 07, 2026-06-06) Rollback health-check port hardcoded to 3000~~ → sprint-16 (2026-06-06)
- ~~(sprint 03, 2026-06-06) Custom nginx configs can't use zero-downtime~~ → sprint-17 (2026-06-06)
- ~~(sprint 08, 2026-06-06) `.standby.env` not cleaned up after deploy~~ → sprint-17 (2026-06-06)
- ~~(sprint 20, 2026-06-06) R2 token rotation on re-provision — old tokens accumulate in CF dashboard~~ → sprint-38 (2026-06-09)
- ~~(sprint 02, 2026-06-06) The :rollback tag approach only keeps one rollback point — consider timestamped tags if multi-version history is needed later~~ → sprint-44 (2026-06-11)
- ~~(sprint 34, 2026-06-11) `/var/www/certbot` ACME challenge root needs to exist before certbot runs~~ → sprint-42 (2026-06-11)
- ~~(sprint 38, 2026-06-11) Per-bucket R2 token rotation with credential store~~ → sprint-43 (2026-06-11)
- ~~(sprint 44, 2026-06-12) `rollback --list` only queries the first compose image for rollback tags; a multi-image compose stack would silently omit tags for other images~~ → sprint-46 (2026-06-12)
- ~~(sprint 38, 2026-06-11) `revokeR2Token()` in `packages/core/src/r2.ts` uses `console.warn` for failure logging — accept a logger parameter instead~~ → sprint-45 (2026-06-12)
- ~~(sprint 09, 2026-06-06) Calling repos with `permissions: contents: read` at the workflow level need `contents: write` for git tag push — add to scaffolded workflow~~ → sprint-47 (2026-06-12)
