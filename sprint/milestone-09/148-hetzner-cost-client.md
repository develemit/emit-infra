# Sprint 148 — Hetzner Cloud API client

**Difficulty:** 2

## Goal

Create a thin Hetzner Cloud API client in `apps/api/src/lib/hetzner.ts` that fetches server pricing by server type name, using a `HETZNER_API_TOKEN` environment variable. This client is used by the cost route in sprint 149.

## Reason

The cost panel (sprint 150) needs Hetzner server pricing data. This sprint isolates the API client and the pricing lookup into a single lib file — keeping sprint 149 focused on the route logic rather than HTTP client setup.

## Context

- Hetzner Cloud REST API. Pricing endpoint: `GET https://api.hetzner.cloud/v1/server_types` — returns a list of server types including pricing.
- Auth: `Authorization: Bearer ${HETZNER_API_TOKEN}` header.
- The server types list is stable and rarely changes — cache the full list in-process with a 24h TTL (use `createTtlCache` from `./ttl-cache.js` or just a module-level variable with a timestamp check).
- Response shape (simplified):
  ```json
  { "server_types": [{ "name": "cx22", "prices": [{ "location": "nbg1", "price_monthly": { "net": "4.9000000000" } }] }] }
  ```
  Return the net monthly price in EUR for the project's region. Fall back to the first location's price if the project's region isn't found.
- Export:
  ```ts
  export async function getServerTypeMonthlyPrice(serverType: string, region: string): Promise<number | null>
  ```
  Returns `null` if `HETZNER_API_TOKEN` is not set, or if the server type isn't found.
- Use the native `fetch` (already available in Node 18+ which this project uses). Add a 10s timeout via `AbortSignal.timeout(10_000)`.

## Tasks

1. Create `apps/api/src/lib/hetzner.ts` with the client and `getServerTypeMonthlyPrice` function.
2. The function should:
   - Return `null` immediately if `!process.env['HETZNER_API_TOKEN']`.
   - Fetch from `https://api.hetzner.cloud/v1/server_types` with the auth header.
   - Find the matching server type by name (case-insensitive).
   - Return the price for the project's region, or the first location's price as fallback.
3. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/lib/hetzner.ts` — Hetzner API client

## Acceptance criteria

- [x] `getServerTypeMonthlyPrice('cx22', 'nbg1')` returns a positive number when `HETZNER_API_TOKEN` is set
- [x] Returns `null` when `HETZNER_API_TOKEN` is not set (graceful degradation)
- [x] Returns `null` when the server type isn't in the response (unknown type)
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/lib/hetzner.ts` with `getServerTypeMonthlyPrice(serverType, region)`. Fetches `GET https://api.hetzner.cloud/v1/server_types` with Bearer token auth and 10s timeout. Caches the full server types list for 24h using `createTtlCache`. Matches server type by name (case-insensitive), looks up region-specific price, falls back to first location. Returns `null` if token missing, type not found, or any fetch error.

### Files changed
- (new) `apps/api/src/lib/hetzner.ts` — Hetzner Cloud API client with 24h cached pricing lookup

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Server volume pricing
- Traffic / bandwidth pricing
- Creating or deleting Hetzner resources
