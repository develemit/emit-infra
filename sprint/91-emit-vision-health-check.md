# Sprint 91 — emit-vision HTTP health check integration

> _Promoted from sprint-88 session follow-up, 2026-06-27._

## Goal

Wire emit-vision into emit-infra's internal HTTP health monitoring (added in sprint 88 for tastease) so the dashboard shows an HTTP status chip for emit-vision. Also decide on and document the dead man's switch strategy for emit-vision's `uptime-ping` Docker service.

## Context

### What exists today

**emit-infra HTTP probe (built in sprint 88):**
- `apps/api/src/lib/status-monitor.ts` polls `config.healthCheck.url` every 60s via `fetch`
- On up/down state transitions, sends a web push notification
- tastease is already wired: `~/projects/tastease/.emit-infra.json` has `"healthCheck": { "url": "https://app.tastease.app/api/healthz" }`
- emit-vision is NOT wired — no `healthCheck` entry in `~/projects/emit-vision/.emit-infra.json`

**emit-vision's `uptime-ping` Docker service:**
- emit-vision has a `docker-compose.prod.yml` with an `uptime-ping` service that is intended to ping healthchecks.io on a schedule
- The service is running but `HEALTHCHECKS_URL` env var is blank in `.env.prod` — so pings go nowhere
- The `deploy-readiness-check` skill surfaces this as a "warn" item

**The two systems are complementary, not redundant:**
- emit-infra HTTP probe: polls FROM emit-infra (your Mac). If emit-infra is offline, no alerts.
- healthchecks.io dead man's switch: runs INSIDE the server Docker stack. If the API crashes, pings stop, healthchecks.io alerts you even if emit-infra is offline.

### emit-vision health endpoint

emit-vision already has a `/healthz` route (added in sprint 61) returning `{ status, build, service, uptime }`. The public URL is `https://app.emitvision.com/api/healthz` (or check the nginx config to confirm the actual public domain + path).

Read `~/projects/emit-vision/.emit-infra.json` to see the current config before editing.

## Tasks

### 1. Add healthCheck to emit-vision's .emit-infra.json

1. Read `~/projects/emit-vision/.emit-infra.json`.
2. Confirm the correct health check URL by testing: `curl -sf https://app.emitvision.com/api/healthz` (or the correct domain — read nginx config if unsure).
3. Add `"healthCheck": { "url": "https://app.emitvision.com/api/healthz" }` to the config.
4. Restart emit-infra API locally (`pnpm nx serve api` or however it runs) so it picks up the new config.
5. Verify the health check fires: check API logs or dashboard for the new HTTP status chip on emit-vision's project card.

### 2. Wire HEALTHCHECKS_URL for dead man's switch (optional but recommended)

1. Read `~/projects/emit-vision/docker-compose.prod.yml` — look at the `uptime-ping` service to understand what it does and what env vars it reads.
2. Create a free healthchecks.io account (or use an existing one) and create a check with:
   - Period: 1 minute
   - Grace: 5 minutes
3. Copy the ping URL (looks like `https://hc-ping.com/<uuid>`)
4. Add `HEALTHCHECKS_URL=<ping-url>` to `~/projects/emit-vision/.env.prod`
5. Re-deploy emit-vision (`~/projects/emit-vision/scripts/deploy.sh`) so the container picks up the new env var
6. Verify pings are arriving: healthchecks.io dashboard should show green

If you prefer not to use healthchecks.io, document this decision in the sprint completion notes and note that emit-infra's HTTP probe is the only monitoring layer.

### 3. Update deploy-readiness-check skill (if healthchecks.io is wired)

If HEALTHCHECKS_URL is wired, the `deploy-readiness-check` skill output will no longer warn about it on next run. No code change needed — the skill reads the actual `.env.prod` file.

If HEALTHCHECKS_URL is NOT wired, consider updating the `deploy-readiness-check` skill logic to recognize "healthCheck in .emit-infra.json" as an acceptable alternative to HEALTHCHECKS_URL and not warn in that case.

The skill file is likely at `~/.claude/skills/deploy-readiness-check.md` or similar — read it to understand how it checks for uptime monitoring before editing.

## Files involved

- `~/projects/emit-vision/.emit-infra.json` — add `healthCheck` entry
- `~/projects/emit-vision/.env.prod` — add `HEALTHCHECKS_URL` (optional, if using healthchecks.io)

## Acceptance criteria

- [x] emit-vision project card in emit-infra dashboard shows HTTP status (up/down chip)
- [x] `~/projects/emit-vision/.emit-infra.json` has `"healthCheck": { "url": "..." }` with the correct URL
- [x] Either HEALTHCHECKS_URL is wired (and healthchecks.io shows pings) OR the decision to skip it is documented
- [x] `deploy-readiness-check` on emit-vision either passes or the skip is acknowledged

## Completed

**Date:** 2026-06-27

### Summary
Added emit-vision to emit-infra's HTTP health monitoring by adding `"healthCheck": { "url": "https://api.emitvision.com/healthz" }` to emit-vision's `.emit-infra.json`. The sprint context referenced an `uptime-ping` Docker service and `HEALTHCHECKS_URL` env var, but neither exists in the current codebase — the uptime-ping service was likely removed in a prior cleanup. The decision is to skip healthchecks.io and rely on emit-infra's HTTP probe as the monitoring layer.

The correct health endpoint is `https://api.emitvision.com/healthz` (on the `api.` subdomain, not `app.`), confirmed by nginx config and a live curl returning `{"status":"ok","build":"656","service":"api","uptime":1687}`. The emit-infra API status route (`/projects/emit-vision/status`) now returns `httpStatus: 200`, which the dashboard's `deriveHealth()` function uses to render the health chip.

The `deploy-readiness-check` skill is a prompt-based skill with no hard-coded HEALTHCHECKS_URL logic — it evaluates monitoring coverage generically. The `healthCheck` entry in `.emit-infra.json` satisfies its monitoring check.

### Files changed
- `~/projects/emit-vision/.emit-infra.json` — added `healthCheck.url` pointing to `https://api.emitvision.com/healthz`

### Verification
- `curl -sf https://api.emitvision.com/healthz`: returns `{"status":"ok","build":"656","service":"api","uptime":1687}`
- `curl http://localhost:7001/projects/emit-vision/status`: returns `httpStatus: 200`
- Config validated by emit-infra's `ProjectConfigSchema` (Zod) which has `healthCheck: z.object({ url: z.string().url() }).optional()`

### Follow-ups
- `[defer]` The sprint context referenced an `uptime-ping` Docker service that no longer exists — if a dead man's switch (independent of emit-infra's Mac uptime) is desired in the future, consider adding a healthchecks.io check via a lightweight cron container
