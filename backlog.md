# Backlog

Deferred follow-ups from completed sprints. Run `/plan-sprint` referencing this
file to promote items into proper sprints when the list grows worth addressing.

<!-- follow-up-scan: date=2026-06-03 through=17 clean=false -->
> _Sprint scan: incremental scan completed 2026-06-03 through sprint-17. Sprints 12–16 clean; sprint-17 defer promoted to sprint-18._

- (sprint 04, 2026-06-03) `pnpm build` fails on `/_error` and `/500` static pre-render — `<Html>` outside pages/_document error in Next.js 15.5.19 (upstream bug; dev server and typecheck/lint are clean) `[hold]`
- (sprint 04, 2026-06-03) Provision wizard uses local Zod schema mirroring `ProjectConfigSchema` — consider extracting shared browser-safe types into `@emit-infra/types`; run `/plan-sprint "shared types package"` to plan `[hold]`
- (sprint 05, 2026-06-03) POST /ops/chat not end-to-end tested with live ANTHROPIC_API_KEY — functional validation requires a real key `[hold]`
- (sprint 05, 2026-06-03) Sessions are in-memory only, cleared on API restart — sufficient for local use but won't survive restarts `[hold]`
- (sprint 08, 2026-06-03) Destroy modal resource list uses static defaults — ideally parsed from project's terraform directory `[hold]`
- (sprint 11, 2026-06-03) Service worker cache name is hardcoded `emit-infra-v1` — bump the key after static asset changes `[hold]`
- (sprint 10, 2026-06-03) ConfirmCard onConfirm callback is a no-op in ChatThread — wire it up if the page needs to track transitions `[hold]`
- (sprint 13, 2026-06-03) `disk` and `memory` in `ProjectStatus` were typed as `string` but the API always returned integers — the fix changed both to `number`; any client code outside this repo that depended on the string type would need updating
- (session 2026-06-03) `diner-decider` and `test-smoke` show SSH unreachable — neither has a provisioned Hetzner server yet (`test-smoke` uses TEST-NET `192.0.2.1`, `diner-decider` DNS doesn't resolve). Both need provisioning via the wizard before status monitoring will work. `diner-decider` also uses `sshKeyName: "emit-deploy"` which doesn't exist locally — update the config to match whatever key is used once provisioned.

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
