# Make the Hetzner billing numbers trustworthy: cap, month label, non-server resources, dead token
**Difficulty:** 3

## Goal
The Hetzner billing widget and the per-project `/cost` route should report figures that match what Hetzner actually charges. Today the widget overstates spend, labels the wrong month, and omits a real €3.50/mo line item, while `/cost` has never once reported a server price. All four are independent defects in the same cost-reporting surface.

## Reason
Investigating why `emit-vision-prod` cost 3.5× every other server (2026-07-28) surfaced four separate reporting bugs. The underlying cost finding was real and is already fixed — the server was on `cpx22` (€22.99/mo, 2 vCPU / 4 GB / 80 GB) and was rescaled to `cx33` (€8.99/mo, 4 vCPU / 8 GB / 80 GB), saving €14.00/mo while doubling CPU and RAM. But the tooling that was supposed to make that visible was wrong in four ways, and the drift went unnoticed for as long as it did *because* of these bugs.

**Every item below was verified against the live Hetzner API, not inferred.**

1. **`spendToDate` ignores Hetzner's monthly cap and overstates spend.** `apps/api/src/routes/billing.ts:93` computes `(serverHourly + ipHourly) * hours` with no ceiling. Hetzner bills hourly *up to a monthly cap*, so hourly × a full month exceeds what you are actually charged. Verified: `cx23` is €0.0104/h × 744h = **€7.74** against a **€6.49** cap (€1.25 over); the former `cpx22` was €0.0368/h × 744h = **€27.38** against a **€22.99** cap (€4.39 over). This is why the dashboard showed **spent €55.89 exceeding projected €51.95** — an impossible pair that is itself the tell. Fix: `min(hourly * hours, monthly)` per resource.

2. **The month label is off by one.** `apps/dashboard/src/components/billing-widget.tsx:77` does `new Date(data.month + '-01')`, which parses `'2026-07-01'` as **UTC midnight**, then renders it with `toLocaleString` in **local** time. In `America/Phoenix` (UTC−7) that lands on June 30, so July data is labelled **"June 2026"**. Reproduced directly. Any timezone behind UTC is affected.

3. **A real €3.50/mo resource is invisible.** `billing.ts:80` maps over `servers` only, so the breakdown counts servers and their primary IPv4 and nothing else. There is a floating IP (`46.225.249.8`, "emit-vision production static IP") at **€3.50/mo gross** that never appears. It is **load-bearing — `api.emitvision.com` resolves to it — so it must not be removed**, only counted. Volumes, load balancers, and snapshots are likewise uncounted; all are currently zero, so counting them is future-proofing rather than a correction.

4. **`/cost` reads a token name that is never set, so it always returns null.** `apps/api/src/lib/hetzner.ts:25` and `:58` read `process.env['HETZNER_API_TOKEN']`, but the only variable defined in `apps/api/.env` is `HCLOUD_TOKEN` — which is what `billing.ts:122` correctly reads. `getServerTypeMonthlyPrice` therefore returns `null` at its very first guard on every call, and `cost.ts:37` swallows that with `.catch(() => null)`. Confirmed live: `/projects/emit-vision/cost` returns `"eurPerMonth": null`. This path has never worked, and its silence is precisely why the `cpx22` overspend was never surfaced by the per-project view.

There is also a **units inconsistency** between the two paths: `hetzner.ts:73` returns `price_monthly.net` (ex-VAT) while `billing.ts:83` uses `price_monthly.gross`. Once item 4 is fixed, `/cost` and the widget would disagree on every price by the VAT rate. Pick one — **gross**, matching the widget and what Hetzner actually invoices — and use it in both.

## Context
- **Config drift is already corrected, but nothing detects it.** `emit-vision/.emit-infra.json` claimed `serverType: "cx22"` while the box was really `cpx22`; it now correctly says `cx33` (committed as `fb8df37` in the emit-vision repo). `cost.ts:34` reads `serverType` straight from project config and never compares it to the live server, so a stale value silently yields a wrong price — `cx22` is €5.49 against `cpx22`'s €22.99, a 4× understatement that would have actively hidden the problem had item 4 not already reduced it to `null`. Adding drift detection is in scope; see task 7.
- **`billing.ts` line-item shape is already extensible.** `BillingLineItem` has a `type: 'server'` discriminant (`billing.ts:7`), so adding `type: 'floating_ip'` fits the existing design rather than fighting it. The dashboard renders `item.name` and `item.spendToDate` generically (`billing-widget.tsx:122`), but note the row also renders `serverRate` / `ipv4Rate` — a non-server line item needs those fields to be optional or the render to branch on `type`.
- **Two separate caches.** `billing.ts` uses a 1-hour TTL (`BILLING_TTL`, line 4) and `hetzner.ts` a 24-hour TTL (`CACHE_TTL_MS`, line 18). After deploying, the widget can show stale figures for up to an hour; don't mistake that for the fix not working.
- **Hetzner pricing reference (nbg1, gross, verified 2026-07-28):** `cx22` €5.49 · `cx23` €6.49 · `cx33` €8.99 · `cpx21` €10.99 · `cx43` €18.49 · `cpx22` €22.99. Note `cpx22` costs more than `cx43`, which has 4× the vCPU and RAM — the `cpx2x` tier is simply bad value, worth a comment near any sizing guidance.
- **Correct fleet total after the rescale:** €8.99 + €0.60 (emit-vision) + 4 × (€6.49 + €0.60) + €3.50 floating IP = **€41.45/mo**. Before the rescale the true figure was €55.45/mo — not the €51.95 the widget displayed, because of item 3. Use €41.45 as the expected projection when verifying.
- **`primary_ips` vs `floating_ips` are different endpoints and different prices.** `billing.ts:76` already pulls `pricing.primary_ips` for the €0.60 primary IPv4. Floating IPs are €3.50/mo gross and come from `pricing.floating_ips` plus `GET /v1/floating_ips`. Don't conflate them.
- **Existing tests:** `apps/api/src/routes/billing.test.ts` and `apps/api/src/routes/cost.test.ts` both exist — extend them rather than starting new files.
- **Testing the month label needs a fixed timezone.** The bug is invisible in UTC. Force a behind-UTC timezone (e.g. `TZ=America/Phoenix`, or `process.env.TZ` in the test) or the regression test will pass on a UTC CI box while the bug is still live.
- **Don't test `spendToDate` against a wall-clock date.** `hoursElapsedThisMonth()` (`billing.ts:51`) reads `new Date()`, so a naive assertion drifts day to day. Extract the arithmetic into a pure helper taking `(hourly, monthly, hours)` and unit-test the cap directly — including the boundary where `hourly * hours` crosses `monthly`.
- **Full typecheck required.** Sprint 232 broke `api:typecheck` by touching shared types while checking only some projects. Run `pnpm typecheck` across all 5.
- **No CLI rebuild needed** — this sprint touches only `apps/api` and `apps/dashboard`, not `apps/cli`. (If that changes, remember this repo runs `apps/cli/dist`.)

## Tasks
1. Extract the per-resource spend arithmetic from `billing.ts:93` into an exported pure helper taking `(hourlyRate, monthlyRate, hoursElapsed)` and returning `min(hourly * hours, monthly)`. Use it for the server + IP spend.
2. Fix the month label in `billing-widget.tsx:77` so the rendered month always matches `data.month`, independent of local timezone (append a time component, format in UTC, or format the `YYYY-MM` string directly without `Date`).
3. Add floating IPs to the billing breakdown: fetch `GET /v1/floating_ips`, price them from `pricing.floating_ips`, and emit them as line items with a `type` discriminant distinct from `'server'`.
4. Make the dashboard render non-server line items correctly — either branch on `item.type` or make the rate fields optional. A floating IP has no `serverRate`/`ipv4Rate`.
5. Fix the token name in `hetzner.ts:25` and `:58` to `HCLOUD_TOKEN` so `getServerTypeMonthlyPrice` can actually run. Verify `/projects/:name/cost` then returns a non-null `eurPerMonth`.
6. Change `hetzner.ts:73` from `price_monthly.net` to `price_monthly.gross` so `/cost` and the widget agree, and update the `HetznerServerType` interface (`hetzner.ts:8`) which currently declares only `net`.
7. Add live-vs-config server-type drift detection: have `/cost` (or a small helper) compare the configured `serverType` against the real type from `GET /v1/servers` and surface a mismatch rather than silently pricing the stale value. Report it in the response; do not auto-correct the config file.
8. Extend `billing.test.ts`: the cap helper (under, at, and over the cap); floating-IP line items included; total projection matches the sum of all line items. Extend `cost.test.ts`: non-null price with the corrected token name, gross units, and the drift-detection branch.
9. Add a regression test for the month label that runs under a behind-UTC timezone and asserts July data renders as "July".
10. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across all 5 projects.
11. Verify against the live API (read-only): `GET /billing/hetzner` projects **€41.45/mo**, `spendToDate` no longer exceeds `projectedMonthly`, the floating IP appears, and the widget labels the correct month. Allow for the 1-hour cache.

## Files involved
- `apps/api/src/routes/billing.ts` — cap helper, floating-IP line items
- `apps/api/src/routes/billing.test.ts` — cap boundaries, floating-IP inclusion, projection total
- `apps/api/src/lib/hetzner.ts` — token name, gross units, interface update
- `apps/api/src/routes/cost.ts` — consume corrected price, add drift detection
- `apps/api/src/routes/cost.test.ts` — non-null price, gross units, drift branch
- `apps/dashboard/src/components/billing-widget.tsx` — month label, non-server line-item rendering

## Acceptance criteria
- [ ] `spendToDate` never exceeds a resource's monthly cap; the dashboard no longer shows spent > projected.
- [ ] The cap arithmetic is a pure, unit-tested helper covering under/at/over the cap, with no dependency on the current date.
- [ ] The month label matches `data.month` in a behind-UTC timezone, covered by a test that would fail on the old code.
- [ ] The floating IP (€3.50/mo) appears as a billing line item and is included in both `spendToDate` and `projectedMonthly`.
- [ ] The floating IP is still attached and `api.emitvision.com` still resolves to it — this sprint counts it, never removes it.
- [ ] `GET /billing/hetzner` projects €41.45/mo, matching the sum of its own line items.
- [ ] `/projects/:name/cost` returns a non-null `eurPerMonth` for a project with a valid `serverType`.
- [ ] `/cost` and the billing widget report the same units (gross) for the same server type.
- [ ] A configured `serverType` that disagrees with the live server type is surfaced rather than silently priced.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- The `cpx22` → `cx33` rescale itself and the `serverType` config correction — both already done (2026-07-28; emit-vision commit `fb8df37`).
- Removing or re-homing the floating IP. It is load-bearing for `api.emitvision.com`.
- Raising ClickHouse's 1 GiB container memory cap. The rescale freed headroom (8 GB total, was 4 GB) and ClickHouse sits at ~65% of its cap, but that's an `emit-vision` compose change, not an `emit-infra` one.
- Rightsizing any other server. The other four are `cx23` at €6.49, which is the fleet's best-value tier; no action needed.
- Volume, load-balancer, and snapshot line items beyond the generic non-server support from task 3 — all are currently zero.
- Cost alerting or budget thresholds.
