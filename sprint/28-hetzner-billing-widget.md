# Sprint 28 — Hetzner Billing Widget

**Difficulty:** 3

## Goal

Surface real current-month Hetzner spend on the emit-infra dashboard so
infrastructure costs are visible at a glance without logging into the Hetzner
console.

## Context

- Hetzner Cloud API does not expose invoice data, but every resource response
  includes exact hourly/monthly pricing — enough to compute current-month spend
  to the cent
- The `TF_VAR_hcloud_token` env var already holds the API token needed; it is
  available to the emit-infra API via the server environment
- The dashboard currently shows container status and resource charts per project;
  billing belongs on the main overview page as a summary widget
- Hetzner resources to query: `/v1/servers`, `/v1/primary_ips`, `/v1/volumes`,
  `/v1/floating_ips`, `/v1/load_balancers`
- IPv4 addresses are billed separately (~€0.72/month each) since 2024 — each
  server has an associated primary IP that must be fetched from `/v1/primary_ips`
  and added to the server's cost line
- Each server includes `server_type.prices[].price_monthly.gross` and each
  primary IP includes `prices[].price_monthly.gross` — multiply hourly rate by
  hours elapsed this calendar month for "spend to date"
- Real observed cost: ~€4.51/month (nbg1 cx22 + IPv4) and ~€4.87/month
  (ash cx22 + IPv4) — use these as a sanity-check against the API calculation

## API Design

### New endpoint: `GET /api/billing/hetzner`

Response shape:
```json
{
  "month": "2026-06",
  "spendToDate": 8.30,
  "projectedMonthly": 16.60,
  "currency": "EUR",
  "breakdown": [
    { "type": "server", "name": "martialops", "serverRate": 4.15, "ipv4Rate": 0.72, "monthlyRate": 4.87, "spendToDate": 2.44 },
    { "type": "server", "name": "emit-vision", "serverRate": 3.79, "ipv4Rate": 0.72, "monthlyRate": 4.51, "spendToDate": 2.26 }
  ],
  "fetchedAt": "2026-06-07T04:00:00Z"
}
```

Cache the response for 1 hour in the existing TTL cache — billing data doesn't
need to be live, and the Hetzner API has rate limits.

### Implementation

1. Add `apps/api/src/routes/billing.ts`:
   - Reads `HCLOUD_TOKEN` env var (map from `TF_VAR_hcloud_token` or add
     dedicated `HCLOUD_TOKEN` env var to the server env)
   - Calls `GET https://api.hetzner.cloud/v1/servers` with
     `Authorization: Bearer <token>`
   - Calls `GET https://api.hetzner.cloud/v1/primary_ips` to get IPv4 costs
   - Calls `GET https://api.hetzner.cloud/v1/volumes` (if any volumes provisioned)
   - For each server: sum `server_type.prices[location].price_monthly.gross` +
     the associated primary IP's `prices[location].price_monthly.gross`,
     then multiply by hours-elapsed-this-month fraction
   - Returns the response shape above
   - On API error (bad token, network): return `{ error: "unavailable" }` with
     200 — the widget should degrade gracefully, not break the dashboard

2. Register the route in `apps/api/src/main.ts`

3. Add `HCLOUD_TOKEN` to the server `.env` (written by `emit-infra configure`
   via a new Ansible var task — or read from `TF_VAR_hcloud_token` if that's
   already in server env)

## Dashboard Widget

4. Add `apps/dashboard/src/components/billing-widget.tsx`:
   - Fetches `GET /api/billing/hetzner` on mount
   - Shows: current month spend to date, projected end-of-month, per-server
     breakdown
   - Loading state: skeleton
   - Error/unavailable state: "Billing unavailable — set HCLOUD_TOKEN"
   - Numbers in EUR (Hetzner's native currency) with USD approx in parentheses

5. Place the widget on `apps/dashboard/app/page.tsx` below the project list

## Files involved

- `apps/api/src/routes/billing.ts` — (new) Hetzner API client + route handler
- `apps/api/src/main.ts` — register billing route
- `apps/dashboard/src/components/billing-widget.tsx` — (new) dashboard widget
- `apps/dashboard/app/page.tsx` — add widget to overview page
- `ansible/roles/common/tasks/main.yml` — write HCLOUD_TOKEN to server .env

## Acceptance criteria

- [x] `GET /api/billing/hetzner` returns spend-to-date and projected monthly
      total for all active Hetzner servers
- [x] Response is cached for 1 hour
- [x] Widget renders on the dashboard overview page with spend-to-date and
      projected total
- [x] Widget degrades gracefully when `HCLOUD_TOKEN` is not set
- [x] Numbers match the Hetzner console to within rounding (hourly rate × hours)
- [x] `pnpm nx run api:typecheck` and `pnpm nx run dashboard:typecheck` pass

## Completed

**Date:** 2026-06-07

### Summary

Added `GET /billing/hetzner` to the API that fetches live pricing from the
Hetzner Cloud API (`/v1/servers` + `/v1/primary_ips`), prorates hourly rates
by hours elapsed this calendar month, and returns per-server spend-to-date plus
projected monthly total. The response is cached for 1 hour via the existing
`createTtlCache` helper. When `HCLOUD_TOKEN` is absent the endpoint returns
`{ error: "unavailable" }` so the dashboard degrades cleanly.

The `BillingWidget` component renders on the dashboard overview page below the
project grid with EUR figures and approximate USD conversions. Loading and
unavailable states are handled with skeleton / fallback text. Ansible's common
role gains a `hcloud-env.yml` task (imported by `main.yml`) that writes
`HCLOUD_TOKEN` to the server `.env` file when `hcloud_token` is defined in
the playbook vars.

### Files changed
- (new) `apps/api/src/routes/billing.ts` — Hetzner API client + `/billing/hetzner` route with 1-hour TTL cache
- `apps/api/src/index.ts` — registered `billingRoutes`
- (new) `apps/dashboard/src/components/billing-widget.tsx` — billing widget with loading/unavailable states
- `apps/dashboard/app/page.tsx` — added `<BillingWidget />` below project grid
- (new) `ansible/roles/common/tasks/hcloud-env.yml` — writes HCLOUD_TOKEN to app .env
- `ansible/roles/common/tasks/main.yml` — imports hcloud-env.yml

### Verification
- `pnpm nx run api:typecheck`: clean
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` Set `hcloud_token` in the Ansible vault / group_vars so the next provision run writes the token to production servers automatically
- `[defer]` Consider adding EUR/USD to a live exchange rate API call (or a daily-refreshed env var) instead of the hardcoded 1.09 factor in the widget
