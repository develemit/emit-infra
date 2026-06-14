# Sprint 29 — Blue-Green: Dual-Stack Compose Layout
**Difficulty:** 3

## Goal
Split each project's single compose stack into blue and green variants with offset ports, and extract shared infra services (postgres, redis, clickhouse) into a separate persistent stack that never restarts during deploys.

## Reason
Zero-downtime deploys require two full app stacks to coexist briefly on the same server. Without the dual-stack layout, there's nowhere to bring up the new version while the old one is still serving traffic. This sprint is purely structural — no CI or nginx changes yet — but nothing in sprints 30–33 can land without it.

## Context
- emit-vision's production compose lives at `emit-vision/infra/docker/docker-compose.prod.yml`
- It currently has 8 services in one file: api, worker, web, marketing (app), plus postgres, redis, clickhouse, pg-backup, clickhouse-backup (infra)
- Blue-green only needs to swap the **app** services; infra services must stay running throughout
- Port convention: blue uses existing base ports (4300 web, 4301 api, 4302 worker, 4303 marketing), green uses base+100 (4400, 4401, 4402, 4403)
- The `deploy-zero-downtime.yml` Ansible task already exists at `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` but currently starts a single standby container rather than a full stack — this sprint lays the groundwork for the full dual-stack approach in sprint 31
- martialops uses built-from-source images (no registry); its Dockerfiles build at deploy time. Scope this sprint to emit-vision only. martialops can be adapted in a follow-up.

## Tasks
1. Create `emit-vision/infra/docker/docker-compose.infra.yml` containing only the stateful/shared services: postgres, redis, clickhouse, clickhouse-backup, pg-backup. These keep their existing volume mounts and environment variables. No ports published (internal Docker network only, except postgres if needed for debugging).
2. Create `emit-vision/infra/docker/docker-compose.app.yml` as the base app compose: api, worker, web, marketing — identical to the current `docker-compose.prod.yml` app services, but with no hardcoded ports. Ports come from the slot override files.
3. Create `emit-vision/infra/docker/docker-compose.blue.yml` — a minimal override that publishes blue ports:
   ```yaml
   services:
     api:     { ports: ["127.0.0.1:4301:4301"] }
     worker:  { ports: ["127.0.0.1:4302:4302"] }
     web:     { ports: ["127.0.0.1:4300:4300"] }
     marketing: { ports: ["127.0.0.1:4303:4303"] }
   ```
4. Create `emit-vision/infra/docker/docker-compose.green.yml` — same override with green ports (base+100):
   ```yaml
   services:
     api:     { ports: ["127.0.0.1:4401:4301"] }
     worker:  { ports: ["127.0.0.1:4402:4302"] }
     web:     { ports: ["127.0.0.1:4400:4300"] }
     marketing: { ports: ["127.0.0.1:4403:4303"] }
   ```
5. Verify compose files are valid by running locally (dry-run, no actual server changes):
   ```bash
   docker compose -f infra/docker/docker-compose.app.yml -f infra/docker/docker-compose.blue.yml config
   docker compose -f infra/docker/docker-compose.app.yml -f infra/docker/docker-compose.green.yml config
   docker compose -f infra/docker/docker-compose.infra.yml config
   ```
6. Update the emit-vision CI/deploy workflow to reference the new file paths (keep `docker-compose.prod.yml` as-is for now — the CI change is sprint 32; just make sure the new files are present and valid).
7. Document the slot port table in a comment at the top of `docker-compose.blue.yml` and `docker-compose.green.yml`.

## Files involved
- `emit-vision/infra/docker/docker-compose.infra.yml` — new file: postgres, redis, clickhouse, backup containers
- `emit-vision/infra/docker/docker-compose.app.yml` — new file: api, worker, web, marketing (no port bindings)
- `emit-vision/infra/docker/docker-compose.blue.yml` — new file: port override for blue slot
- `emit-vision/infra/docker/docker-compose.green.yml` — new file: port override for green slot
- `emit-vision/infra/docker/docker-compose.prod.yml` — keep unchanged for now (CI still uses it until sprint 32)

## Acceptance criteria
- [x] `docker compose ... config` validates cleanly for all three compose combinations (infra, app+blue, app+green)
- [x] Blue and green slot configs expose different host ports for all 4 app services
- [x] Infra services (postgres, redis, clickhouse) are only in `docker-compose.infra.yml`
- [x] No service appears in both the infra and app files
- [x] The existing `docker-compose.prod.yml` is unchanged (CI still works)

## Completed

**Date:** 2026-06-09

### Summary
Split emit-vision's monolithic compose file into four files: `docker-compose.infra.yml` (redis, clickhouse, backup containers), `docker-compose.app.yml` (api, worker, web, marketing — no port bindings), `docker-compose.blue.yml` (blue slot port overrides), and `docker-compose.green.yml` (green slot port overrides at base+100).

The app stack joins the `emit-vision-infra` Docker network as `external: true`, so both blue and green stacks can reach redis and clickhouse by hostname without depending on them via `depends_on`. The `docker-compose.prod.yml` is untouched — CI keeps working until sprint 32.

### Files changed
- (new) `emit-vision/infra/docker/docker-compose.infra.yml` — stateful services: redis, clickhouse, clickhouse-backup, pg-backup + creates emit-vision-infra network
- (new) `emit-vision/infra/docker/docker-compose.app.yml` — app services with no port bindings, joins emit-vision-infra as external network
- (new) `emit-vision/infra/docker/docker-compose.blue.yml` — blue slot port overrides (4300/4301/4302/4303)
- (new) `emit-vision/infra/docker/docker-compose.green.yml` — green slot port overrides (4400/4401/4402/4403)

### Verification
- `docker compose -f docker-compose.app.yml -f docker-compose.blue.yml config`: exit 0
- `docker compose -f docker-compose.app.yml -f docker-compose.green.yml config`: exit 0
- `docker compose -f docker-compose.infra.yml config`: exit 0
- `docker-compose.prod.yml`: unchanged (diff clean)

### Follow-ups
- `[defer]` martialops uses build-from-source images — adapt to dual-stack layout after emit-vision blue-green is proven in production

## Out of scope
- Actually deploying to the server (sprint 32)
- Nginx changes (sprint 30)
- The deploy script (sprint 31)
- martialops (built-from-source; adapt after emit-vision is proven)
