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
- Hetzner resources to query: `/v1/servers`, `/v1/volumes`, `/v1/floating_ips`,
  `/v1/load_balancers`
- Each resource includes `server_type.prices[].price_monthly.gross` (or
  equivalent) and `created` timestamp — multiply hourly rate by hours elapsed
  this calendar month for "spend to date"

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
    { "type": "server", "name": "martialops", "monthlyRate": 4.15, "spendToDate": 2.07 },
    { "type": "server", "name": "emit-vision", "monthlyRate": 4.15, "spendToDate": 2.07 }
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
   - Calls `GET https://api.hetzner.cloud/v1/volumes` (if any volumes provisioned)
   - For each server: find the `price_monthly.gross` for the server's location
     in `server_type.prices[]`, compute hours-elapsed-this-month fraction
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

- [ ] `GET /api/billing/hetzner` returns spend-to-date and projected monthly
      total for all active Hetzner servers
- [ ] Response is cached for 1 hour
- [ ] Widget renders on the dashboard overview page with spend-to-date and
      projected total
- [ ] Widget degrades gracefully when `HCLOUD_TOKEN` is not set
- [ ] Numbers match the Hetzner console to within rounding (hourly rate × hours)
- [ ] `pnpm nx run api:typecheck` and `pnpm nx run dashboard:typecheck` pass
