# Backlog

Deferred follow-ups from completed sprints. Run `/plan-sprint` referencing this
file to promote items into proper sprints when the list grows worth addressing.

- (sprint 76, 2026-06-20) Docker layer progress output (hundreds of `\r`-terminated lines) appears in deploy logs — noisy but readable. Could add `--quiet` to docker push/pull in individual deploy scripts if it becomes a problem.
- (sprint 79, 2026-06-20) `ansi-to-html` is instantiated with `escapeXML: false` — if logs contain HTML-like strings (e.g. JSX error output with `<div>`), those render as raw HTML. Acceptable for now; revisit if it produces unexpected rendering.
~~- (sprint 85, 2026-06-20) Disk trend regression uses last 48h window only. Bursty disk usage could skew the slope. A 7-day window would be smoother — adjust the cutoff constant in `apps/api/src/routes/history.ts` if needed.~~
- (sprint 60, 2026-06-16) emit-vision `infra/scripts/migrate.sh` fallback path (`docker run`) needs `GHCR_ORG` + `IMAGE_TAG` env vars — verify ops runbook mentions these when using the fallback
- (sprint 72, 2026-06-18) emit-vision has two containers both named "backup" (pg-backup and ch-backup share the suffix) — could disambiguate with a longer name extraction if needed
~~- (sprint 91, 2026-06-27) If a dead man's switch independent of emit-infra's Mac uptime is desired for emit-vision, add a healthchecks.io check via a lightweight cron container (the `uptime-ping` Docker service referenced in the original sprint no longer exists)~~
- (sprint 93 demoted, 2026-06-27) martialops server provision + first deploy — no Hetzner server exists; nginx vhost on tastease points to `proxy_pass http://127.0.0.1:4000` with no container. Steps: `terraform apply` in `~/projects/martialops/terraform/` (cx23 nbg1, ~€6/mo — confirm with user first), update `.emit-infra.json` serverIp, run `scripts/deploy.sh`, commit staged `/healthz` route + nginx config (requires postgres locally for pre-commit hook), update Cloudflare DNS for `api.martialops.app`, `www.martialops.app`, and `martialops.app` apex. See sprint-93 file in git history for full task breakdown. `[hold]`

- (sprint 113, 2026-06-28) `apps/dashboard/app/health/page.tsx` grew to 308 lines after adding filter counts — extract filter logic or helper into a sibling file to bring it under 300

<!-- follow-up-scan: date=2026-06-28 through=111 clean=false -->
> _Sprint scan: incremental scan 2026-06-28 through sprint-111. Discoveries: sprint-112 (test coverage expansion), sprint-113 (fleet/CI filter counts), sprint-114 (SSE auth token-in-query), sprint-115 (healthchecks.io DMS), sprint-116 (disk/memory trend 7d window). Prior scan: 2026-06-27 through sprint-91._

- (sprint 04, 2026-06-03) `pnpm build` fails on `/_error` and `/500` static pre-render — `<Html>` outside pages/_document error in Next.js 15.5.19 (upstream bug; dev server and typecheck/lint are clean) `[hold]`
- (sprint 04, 2026-06-03) Provision wizard uses local Zod schema mirroring `ProjectConfigSchema` — consider extracting shared browser-safe types into `@emit-infra/types`; run `/plan-sprint "shared types package"` to plan `[hold]`
- (sprint 05, 2026-06-03) POST /ops/chat not end-to-end tested with live ANTHROPIC_API_KEY — functional validation requires a real key `[hold]`
- (sprint 05, 2026-06-03) Sessions are in-memory only, cleared on API restart — sufficient for local use but won't survive restarts `[hold]`
- (sprint 08, 2026-06-03) Destroy modal resource list uses static defaults — ideally parsed from project's terraform directory `[hold]`
- (sprint 11, 2026-06-03) Service worker cache name is hardcoded `emit-infra-v1` — bump the key after static asset changes `[hold]`
- (sprint 10, 2026-06-03) ConfirmCard onConfirm callback is a no-op in ChatThread — wire it up if the page needs to track transitions `[hold]`
- (sprint 34, 2026-06-11) Switch certbot HTTP-01 from `certbot --nginx` (rewrites config in-place) to `certbot certonly --webroot` with manual ssl cert path injection so Ansible stays in control of the nginx config file. Complex architectural change — run `/plan-sprint "certbot certonly webroot migration"` before queuing. `[hold]`
- (sprint 40, 2026-06-11) Blue-green slot-aware port selection in `emit-infra status` — active slot may use a different API port than `config.deploy.appPort`. Revisit once blue-green is production-proven on emit-vision. `[hold]`

## ✅ Converted to Sprints

- ~~(sprint 85, 2026-06-20) Disk trend 48h window too short~~ → sprint-116 (2026-06-28)
- ~~(sprint 91, 2026-06-27) healthchecks.io DMS for emit-vision Mac uptime independence~~ → sprint-115 (2026-06-28)
- ~~(sprint 102, 2026-06-28) SSE endpoints bypass auth (EventSource can't send custom headers)~~ → sprint-114 (2026-06-28)
- ~~(sprint 103, 2026-06-28) SSE streaming has no retry / auth gap~~ → sprint-114 (2026-06-28)
- ~~(sprint 106, 2026-06-28) Fleet/CI filter buttons show no counts~~ → sprint-113 (2026-06-28)
- ~~(sprint 107–111, 2026-06-28) Test coverage gaps: hooks (use-project-detail, use-ops-chat), helpers (full-chart-helpers, container-row), trend API routes~~ → sprint-112 (2026-06-28)
- ~~(sprint 108/111, 2026-06-28) Coverage thresholds at 50% — raise after more tests~~ → sprint-112 (2026-06-28)

- ~~(sprint 87, 2026-06-21) CI flakiness page doesn't auto-refresh~~ → sprint-92 (2026-06-27)
- ~~(sprint 87, 2026-06-21) CI flakiness page project rows not linked to project detail~~ → sprint-92 (2026-06-27)
- ~~(sprint 61, 2026-06-16) martialops /healthz staged but not committed~~ → sprint-93 (2026-06-27)
- ~~(sprint 88, 2026-06-27) martialops www/apex DNS still points to old server 178.156.218.94~~ → sprint-93 (2026-06-27)
- ~~(sprint 88, 2026-06-27) martialops terraform state empty + API never deployed + wrong serverIp~~ → sprint-93 (2026-06-27)
- ~~(sprint 61, 2026-06-16) Validate production /healthz on each domain~~ → resolved by sprint-91: emit-vision healthCheck added; tastease already wired (2026-06-27)
- ~~(sprint 78, 2026-06-20) SHA clipboard-copy on deploy rows removed when rows became links~~ → sprint-80 restored as copy icon with stopPropagation (2026-06-27)
- ~~(sprint 78, 2026-06-20) Log viewer starts at top; CI/deploy tail is most useful — auto-scroll to bottom on load~~ → sprint-79 implemented scrollBottom prop on Terminal (2026-06-27)
- ~~(sprint 72, 2026-06-18) martialops and tastease unreachable via domain — may need serverIp in .emit-infra.json~~ → resolved in sprint-88 session; serverIp added to all four project configs (2026-06-27)
- ~~(sprint 86, 2026-06-21) diner-decider S3 backup retention prune — go-cron BACKUP_KEEP_DAYS no longer runs after shell-loop replacement~~ → sprint-90 (2026-06-27)
- ~~(sprint 88, 2026-06-27) emit-vision health check not wired to emit-infra HTTP probe~~ → sprint-91 (2026-06-27)
- ~~(sprint 13, 2026-06-03) `disk` and `memory` in `ProjectStatus` typed as `string`; fix changed both to `number` — external consumers would need updating~~ → no sprint needed; change already shipped, note for awareness (2026-06-15)
- ~~(session 2026-06-03) `diner-decider` SSH unreachable, no Hetzner server provisioned~~ → resolved; diner-decider is now live at 167.233.43.96 (2026-06-15)
- ~~(sprint 35, 2026-06-11) emit-vision `infra/scripts/deploy.sh` contains redundant GHCR login + blue-green invocation — strip to migrations-only~~ → sprint-60 (2026-06-15)
- ~~(sprint 40, 2026-06-11) Each project needs `/healthz` route returning `{ status, build, service, uptime }` for `emit-infra status` live build data~~ → sprint-61 (2026-06-15)
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
