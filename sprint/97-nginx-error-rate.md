# Sprint 97 — Nginx error rate capture

**Difficulty:** 3

## Goal

Extend the metrics collector to count nginx 4xx and 5xx responses from the access log on each poll. Store the counts in `.metrics.jsonl`, expose them via the metrics API, and display error rate on the project detail page.

## Reason

We can see that nginx is "active" but have zero visibility into whether it's serving errors. A spike in 4xx/5xx is often the first signal of a broken deploy, misconfigured route, or upstream crash — currently invisible until a user reports it.

## Context

- `scripts/collect-metrics.sh` — the `REMOTE_SCRIPT` heredoc (lines 12–62) runs on each server via SSH. Add nginx log parsing at the end of `REMOTE_SCRIPT`, before the `printf` output line. Tail the last 1000 lines of nginx access log and count responses by class:
  ```bash
  nginx_4xx=0; nginx_5xx=0
  if [ -f /var/log/nginx/access.log ]; then
    eval "$(tail -n 1000 /var/log/nginx/access.log \
      | awk '{c=substr($9,1,1); if(c=="4") f++; if(c=="5") s++} END {printf "nginx_4xx=%d nginx_5xx=%d", f+0, s+0}')"
  fi
  ```
  Add `NGINX4XX:%d NGINX5XX:%d` to the `printf` output string and `"$nginx_4xx" "$nginx_5xx"` to the args.
- In the `collect_one` bash function (lines 90–105), parse the two new fields from `ssh_out` with `sed` (same pattern as existing fields).
- Update the `printf` JSON line (line 102) to include `"nginx4xx":%s,"nginx5xx":%s`.
- `apps/api/src/routes/history.ts` — `MetricPoint` interface (line 8–19): add `nginx4xx?: number` and `nginx5xx?: number`. The metrics endpoint returns these automatically.
- Dashboard — in the project detail page (`apps/dashboard/app/projects/[name]/page.tsx`) and/or a detail sub-component, display error counts from the most recent metric point. Show as "4xx: N  5xx: N" near the nginx status in the health card or as a small stat beneath it. If both are 0 or unavailable, show nothing.
- `apps/dashboard/src/lib/api.ts` — `MetricPoint` type: add `nginx4xx?: number` and `nginx5xx?: number`.

## Tasks

1. Read `collect-metrics.sh` in full and `health-card.tsx` to understand where to slot the display.
2. Extend `REMOTE_SCRIPT` in `collect-metrics.sh` with nginx log parsing (tail 1000 lines, count 4xx/5xx status codes).
3. Add the two counts to the `printf` output format and parse them in `collect_one`.
4. Update the JSON line written to `.metrics.jsonl` to include `nginx4xx` and `nginx5xx`.
5. Add `nginx4xx?: number` and `nginx5xx?: number` to `MetricPoint` in `history.ts`.
6. Add the same fields to the `MetricPoint` type in `apps/dashboard/src/lib/api.ts`.
7. In the project detail page, read the most recent metric point and display nginx error counts if non-zero. A simple `4xx: N · 5xx: N` line beneath the nginx status in the health card is sufficient.
8. Run `pnpm nx typecheck dashboard` and `pnpm nx typecheck api`.

## Files involved

- `scripts/collect-metrics.sh` — add nginx log parsing to REMOTE_SCRIPT + JSON output
- `apps/api/src/routes/history.ts` — add `nginx4xx?` / `nginx5xx?` to MetricPoint interface
- `apps/dashboard/src/lib/api.ts` — add fields to client-side MetricPoint type
- `apps/dashboard/app/projects/[name]/page.tsx` or `apps/dashboard/src/components/detail/health-card.tsx` — display error counts

## Acceptance criteria

- [x] `collect-metrics.sh` remote script tails nginx access.log and counts 4xx/5xx per poll
- [x] `.metrics.jsonl` lines include `nginx4xx` and `nginx5xx` fields
- [x] `GET /projects/:name/metrics` response includes `nginx4xx` and `nginx5xx` in each point
- [x] Project detail page shows nginx error counts when non-zero
- [x] `pnpm nx typecheck dashboard` and `pnpm nx typecheck api` clean

## Completed

**Date:** 2026-06-28

### Summary
Extended `collect-metrics.sh` REMOTE_SCRIPT to tail the last 1000 lines of `/var/log/nginx/access.log` and count 4xx/5xx response codes using awk. Added `NGINX4XX` and `NGINX5XX` fields to the remote printf format, extracted them in `collect_one` via sed, and written to `.metrics.jsonl` as `nginx4xx`/`nginx5xx`. Added the optional fields to `MetricPoint` in both `history.ts` and `api.ts`. In `health-card.tsx`, added a `latestMetric?: MetricPoint | null` prop and a conditional "Nginx Errors" StatTile (shown only when either count is non-zero) in both the desktop and mobile grids. Wired `latestMetric={latestMetric}` into the `<HealthCard>` call in the project detail page.

### Files changed
- `scripts/collect-metrics.sh` — nginx access.log counting in REMOTE_SCRIPT, extract + emit in collect_one
- `apps/api/src/routes/history.ts` — `nginx4xx?`/`nginx5xx?` on MetricPoint interface
- `apps/dashboard/src/lib/api.ts` — `nginx4xx?`/`nginx5xx?` on client MetricPoint type
- `apps/dashboard/src/components/detail/health-card.tsx` — `latestMetric` prop + conditional nginx errors StatTile
- `apps/dashboard/app/projects/[name]/page.tsx` — pass `latestMetric` to HealthCard

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Per-path breakdown of errors
- Alerting on error rate spikes
- Historical error rate chart (data will accumulate; chart can be a later sprint)
- Parsing non-standard nginx log formats
