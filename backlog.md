# Backlog

Deferred follow-ups from completed sprints. Run `/plan-sprint` referencing this
file to promote items into proper sprints when the list grows worth addressing.

- (sprint 130, 2026-07-01) `/var/lib/docker` in disk-dirs requires sudo — graceful fallback already in place via `2>/dev/null`, but some server hardening configs may deny the fallback silently
- (sprint 131, 2026-07-01) `reltuples` estimate in pg-table-sizes may be stale if ANALYZE hasn't run recently — acceptable for display but worth noting if counts look wildly off
- (sprint 133, 2026-07-01) `/var/spool/cron/crontabs/root` requires sudo on some servers — gracefully returns empty via `2>/dev/null`
- (sprint 135, 2026-07-01) IPv6 UFW rules appear as separate blocks in `ufw status numbered`; currently captured if they match the regex, acceptable for now
- (sprint 124, 2026-07-01) `getTerraformOutput` is duplicated in `status.ts` and `logs.ts` — extract to a shared helper when a third consumer appears
- (sprint 139, 2026-07-01) The awk in response-times.ts assumes request_time is the second-to-last nginx log field; projects with non-standard log formats may return `{ available: false }` — can be addressed with a configurable field index if needed
- (sprint 141, 2026-07-01) collect-metrics.sh uses `docker ps --filter name=redis` which matches any container with "redis" in the name; projects with non-standard container names may not be detected — can add config field for redis container name if needed
- (sprint 146, 2026-07-01) cert.ts parses `LastTriggerUSec` as microseconds; if systemctl on older Ubuntu versions returns a different format, `renewTimerLastRan` may be wrong — verify on target servers

- (sprint 76, 2026-06-20) Docker layer progress output (hundreds of `\r`-terminated lines) appears in deploy logs — noisy but readable. Could add `--quiet` to docker push/pull in individual deploy scripts if it becomes a problem.
- (sprint 79, 2026-06-20) `ansi-to-html` is instantiated with `escapeXML: false` — if logs contain HTML-like strings (e.g. JSX error output with `<div>`), those render as raw HTML. Acceptable for now; revisit if it produces unexpected rendering.
~~- (sprint 85, 2026-06-20) Disk trend regression uses last 48h window only. Bursty disk usage could skew the slope. A 7-day window would be smoother — adjust the cutoff constant in `apps/api/src/routes/history.ts` if needed.~~
~~- (sprint 60, 2026-06-16) emit-vision `infra/scripts/migrate.sh` fallback path (`docker run`) needs `GHCR_ORG` + `IMAGE_TAG` env vars — verify ops runbook mentions these when using the fallback~~
- (sprint 72, 2026-06-18) emit-vision has two containers both named "backup" (pg-backup and ch-backup share the suffix) — could disambiguate with a longer name extraction if needed
~~- (sprint 91, 2026-06-27) If a dead man's switch independent of emit-infra's Mac uptime is desired for emit-vision, add a healthchecks.io check via a lightweight cron container (the `uptime-ping` Docker service referenced in the original sprint no longer exists)~~
- (sprint 93 demoted, 2026-06-27) martialops server provision + first deploy — no Hetzner server exists; nginx vhost on tastease points to `proxy_pass http://127.0.0.1:4000` with no container. Steps: `terraform apply` in `~/projects/martialops/terraform/` (cx23 nbg1, ~€6/mo — confirm with user first), update `.emit-infra.json` serverIp, run `scripts/deploy.sh`, commit staged `/healthz` route + nginx config (requires postgres locally for pre-commit hook), update Cloudflare DNS for `api.martialops.app`, `www.martialops.app`, and `martialops.app` apex. See sprint-93 file in git history for full task breakdown. `[hold]`

~~- (sprint 113, 2026-06-28) `apps/dashboard/app/health/page.tsx` grew to 308 lines after adding filter counts — extract filter logic or helper into a sibling file to bring it under 300~~

~~- (sprint 112, 2026-06-28) `container-row.tsx` React components (MobileContainerRow, DesktopContainerRow) have no tests — jsdom rendering overhead deferred; address in a visual-test sprint~~
- (sprint 114, 2026-06-28) SSE reconnection on token expiry not handled — tokens are static per deployment so acceptable for now; revisit if token rotation is added
- (sprint 115, 2026-06-29) **[manual ops]** Activate healthchecks.io DMS for emit-vision: create a check (15-min period, 5-min grace) at healthchecks.io, add `HEALTHCHECKS_URL=<ping-url>` to Hetzner `.env`, run `docker compose -f infra/docker/docker-compose.infra.yml up -d dms-ping`

<!-- follow-up-scan: date=2026-07-01 through=154 clean=true -->
> _Sprint scan: incremental scan 2026-07-01 through sprint-154. Sprints 151–154: all follow-ups marked `none` — clean. Prior scan: 2026-07-01 through sprint-150._

- (sprint 04, 2026-06-03) `pnpm build` fails on `/_error` and `/500` static pre-render — `<Html>` outside pages/_document error in Next.js 15.5.19 (upstream bug; dev server and typecheck/lint are clean) `[hold]`
~~- (sprint 04, 2026-06-03) Provision wizard uses local Zod schema mirroring `ProjectConfigSchema` — consider extracting shared browser-safe types into `@emit-infra/types`; run `/plan-sprint "shared types package"` to plan~~
- (sprint 05, 2026-06-03) POST /ops/chat not end-to-end tested with live ANTHROPIC_API_KEY — functional validation requires a real key `[hold]`
- (sprint 05, 2026-06-03) Sessions are in-memory only, cleared on API restart — sufficient for local use but won't survive restarts `[hold]`
- (sprint 08, 2026-06-03) Destroy modal resource list uses static defaults — ideally parsed from project's terraform directory `[hold]`
~~- (sprint 11, 2026-06-03) Service worker cache name is hardcoded `emit-infra-v1` — bump the key after static asset changes~~ _(resolved: already at v4)_
- (sprint 10, 2026-06-03) ConfirmCard onConfirm callback is a no-op in ChatThread — wire it up if the page needs to track transitions `[wont-do: card manages its own SSE state; parent has nothing to act on]`
~~- (sprint 34, 2026-06-11) Switch certbot HTTP-01 from `certbot --nginx` (rewrites config in-place) to `certbot certonly --webroot` with manual ssl cert path injection so Ansible stays in control of the nginx config file. Complex architectural change — run `/plan-sprint "certbot certonly webroot migration"` before queuing.~~
- (sprint 40, 2026-06-11) Blue-green slot-aware port selection in `emit-infra status` — active slot may use a different API port than `config.deploy.appPort`. Revisit once blue-green is production-proven on emit-vision. `[hold]`

## ✅ Converted to Sprints

- ~~(sprint 125, 2026-07-01) Route-level tests for backup routes (key validation, 404 on missing bucket, parse edge cases)~~ → sprint-151 (2026-07-01)
- ~~(sprint 126, 2026-07-01) BackupPanel delete failure silently re-fetches — add inline error state~~ → sprint-152 (2026-07-01)
- ~~(sprint 128, 2026-07-01) Dashboard UI for editing `backupRetainDays` per project~~ → sprint-153 (2026-07-01)
- ~~(sprint 129, 2026-07-01) Dashboard UI to surface `backup` SSE events in deploy terminal~~ → sprint-154 (2026-07-01)
- ~~(sprint 121, 2026-06-29) Remove `python3-certbot-nginx` from apt install list~~ → sprint-123 (2026-06-29)
- ~~(sprint 112, 2026-06-28) container-row.tsx React components untested~~ → sprint-122 (2026-06-29)
- ~~(sprint 04, 2026-06-03) Shared browser-safe types @emit-infra/types~~ → sprint-119 + sprint-120 (2026-06-29)
- ~~(sprint 34, 2026-06-11) certbot --nginx rewrites Ansible-managed nginx config~~ → sprint-121 (2026-06-29)
- ~~(sprint 113, 2026-06-28) health/page.tsx at 308 lines — extract helper functions to sibling file~~ → sprint-117 (2026-06-29)
- ~~(sprint 60, 2026-06-16) emit-vision migrate.sh fallback needs GHCR_ORG + IMAGE_TAG documented in ops runbook~~ → sprint-118 (2026-06-29)
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
- (sprint 172, 2026-07-02) call sites still import from `~/lib/api` barrel — could update to import from specific domain modules for better tree-shaking and faster IDE go-to-definition
- (sprint 175, 2026-07-02) sprint 175 planned `secrets-sync.test.ts` but drift logic is in `secrets.ts` — if/when `secrets-sync.ts` (the SSE push route) needs unit tests, add them post sprint-176 implementation
- (sprint 176, 2026-07-02) `secrets-apply` route uses `base64 -d` (GNU coreutils) — verify works on target Ubuntu servers; may fail on non-GNU base64
- (sprint 176, 2026-07-02) "Sync to server" button only appears for missing keys; extra server-side keys (in `extra[]`) are not cleaned up by the apply route — would need a separate "prune extra" SSH step
- (sprint 177, 2026-07-02) other polling hooks (`use-server-metrics`, `use-ci-history`, etc.) still use plain `setInterval` — could apply jitter pattern there if lockstep polling at scale is a concern
- (sprint 177, 2026-07-02) `httpCircuit` resets on API server restart; a failed first probe post-boot could leave a circuit open that delays recovery visibility — acceptable for now
- (sprint 178, 2026-07-02) backup completion polling has no elapsed-time indicator — "Running…" is the only feedback during a potentially long backup
- (sprint 178, 2026-07-02) 10-minute polling timeout silently stops with no user message — could show "Backup status unknown — check logs" on timeout
