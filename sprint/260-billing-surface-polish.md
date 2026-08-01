# Billing surface polish: honest drift state, widget coverage, and a split cost test file
**Difficulty:** 2

> _Promoted from sprint-245 follow-ups, 2026-08-01._

## Goal
`/cost` distinguishes "server type checked and matching" from "couldn't check", the billing widget's render branches are covered by a component test, and `cost.test.ts` is back under the 300-line house limit.

## Reason
Three follow-ups from sprint 245, all in the cost-reporting surface it just repaired.

**1. `typeDrift: false` currently means two different things.** Sprint 245 added live-vs-config server-type drift detection to `/cost`, matched by `serverIp`. Projects that don't declare a `serverIp` get `liveType: null, typeDrift: false` — identical to a project that *was* checked and genuinely matches. martialops is in this state today (its `serverIp` was deliberately removed when the project was shelved). A boolean can't express "not checked," so the response quietly claims reassurance it hasn't earned. A tri-state (`matching` / `drifted` / `unknown`) is honest; the same applies when the Hetzner lookup fails, which also collapses to `false` today.

This matters because drift detection exists precisely to catch a silent, expensive mistake: emit-vision ran `cpx22` (€22.99/mo) while its config claimed `cx22` (€5.49/mo), a 4x understatement that went unnoticed for weeks.

**2. The widget has no component test.** Sprint 245 made `BillingBreakdownItem` a discriminated union and added an `item.type === 'server'` render branch so floating IPs render as `€3.50 floating IP` rather than reading `serverRate`/`ipv4Rate` that don't exist on them. That branch is currently guarded only by TypeScript. The month-label fix is well covered, but at the `formatBillingMonth` helper level — nothing asserts the widget actually calls it, so a regression that reverted the widget to inline `new Date(...)` would pass every test.

**3. `cost.test.ts` is 338 lines**, over the project's 300-line target, after sprint 245 added five drift cases. It has two clearly separable concerns: server pricing / drift, and R2 storage cost.

## Context
- **Changing `typeDrift`'s type is a breaking response change.** Check for consumers before altering it — `grep -rn "typeDrift\|liveType" apps/dashboard apps/cli` — and update them together. Adding a separate `driftStatus` field while leaving `typeDrift` as a boolean is an acceptable alternative if a consumer depends on the boolean; decide deliberately and say which you chose and why.
- **Where the three states come from** (`apps/api/src/routes/cost.ts`): no `serverIp` on the project → unknown; `getLiveServerTypeByIp` returns null or throws → unknown; live type resolved and differs from config → drifted; resolved and matches (case-insensitively) → matching. The existing five tests in `cost.test.ts` already cover all four input paths, so they map onto the new states directly.
- **Pricing behavior must not change.** Sprint 245 deliberately prices the *live* type when known, so stale config can't produce a confident price for a box that doesn't exist. Keep that.
- **Dashboard testing is set up and conventional.** `apps/dashboard/vitest.config.ts` uses jsdom with globals and an `@` → `src` alias; there are existing component tests under `src/components/detail/` (e.g. `container-row.test.tsx`, `backup-panel.test.tsx`) to copy the pattern from. The widget fetches on mount via `useEffect`, so the test needs `fetch` stubbed.
- **Two useful widget assertions:** a `floating_ip` line item renders its monthly rate and does *not* render an `IPv4` fragment; and a `2026-07` payload renders "July 2026" (which fails if anyone reintroduces the `Date`-based label — this machine is `America/Phoenix`, UTC−7).
- **Splitting `cost.test.ts`:** keep the file-per-route convention. A sibling like `cost-drift.test.ts` alongside `cost.test.ts` is fine; both can import the same route. Do not merge them into a shared harness that obscures which route is under test.
- Read sprint **245**'s `## Completed` section first — especially the note that the `net`/`gross` change was preventive only (`vat_rate` is 0 on this account, so `net == gross`). Don't go looking for a VAT discrepancy; there isn't one.

## Tasks
1. Replace or supplement `typeDrift` with a tri-state that distinguishes matching / drifted / unknown, and update every consumer found by grep.
2. Map the existing four input paths onto the new states and update `cost.test.ts`'s drift assertions accordingly.
3. Add a `billing-widget.test.tsx` covering: server line item renders `serverRate` + `ipv4Rate`; floating-IP line item renders its monthly rate with no `IPv4` fragment; the month label renders "July 2026" for a `2026-07` payload; the unavailable state renders when the API returns `{ error }`.
4. Split `cost.test.ts` so both resulting files are under 300 lines, keeping the file-per-route convention.
5. Run `pnpm test`, `pnpm typecheck`, `pnpm lint` across all 5 projects.
6. Verify live (read-only) that `/projects/:name/cost` reports the new state correctly for a project **with** a `serverIp` (emit-vision → matching) and one **without** (martialops → unknown).

## Files involved
- `apps/api/src/routes/cost.ts` — tri-state drift reporting
- `apps/api/src/routes/cost.test.ts` — updated drift assertions; split for size
- (new) `apps/api/src/routes/cost-drift.test.ts` — the extracted half
- (new) `apps/dashboard/src/components/billing-widget.test.tsx` — render branches and month label
- `apps/dashboard/src/components/billing-widget.tsx` — read-only unless a consumer update is needed

## Acceptance criteria
- [ ] `/cost` distinguishes "checked and matching" from "couldn't check" — a project without `serverIp` is not reported the same as one that genuinely matches.
- [ ] A failed Hetzner lookup also reports unknown rather than matching.
- [ ] Pricing still uses the live type when known.
- [ ] Every consumer of the changed field was found by grep and updated.
- [ ] A widget component test covers the server branch, the floating-IP branch, the month label, and the unavailable state.
- [ ] The month-label widget test fails if the widget reverts to inline `new Date(...)`.
- [ ] Both cost test files are under 300 lines.
- [ ] Live read-only check confirms correct state for one project with and one without a `serverIp`.
- [ ] `pnpm test`, `pnpm typecheck`, `pnpm lint` clean across all 5 projects.

## Out of scope
- Volume, load-balancer, and snapshot line items — all zero on this account; the discriminated-union shape already makes adding them mechanical.
- Switching floating-IP spend off proration — Hetzner's pricing API exposes no `price_hourly` for floating IPs.
- Cost alerting or budget thresholds.
- Re-litigating the `net`/`gross` decision.
