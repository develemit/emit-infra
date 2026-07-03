# Frontend Polling Backoff + HTTP Probe Circuit Breaker
**Difficulty:** 3

## Goal
Add exponential backoff with jitter to the dashboard's status polling, and add a per-URL circuit breaker to the status-monitor's HTTP health check to prevent a slow failing endpoint from blocking the poll cycle.

## Reason
All open dashboard tabs poll the API every 30s in lockstep with no backoff — if the API is struggling, the tabs collectively make it worse. On the server side, a project with a slow health-check URL (timing out at 10s each cycle) monopolizes its slot in the parallel poll, degrading the overall SSH reachability monitor for all projects.

## Context
- Dashboard polling: find the hook that drives status polling — likely `apps/dashboard/src/hooks/use-project-detail.ts` lines ~40–44. It probably uses `setInterval(..., 30_000)`. Replace with a recursive `setTimeout` pattern:
  - Base interval: 30s
  - Add ±5s jitter on each reschedule: `baseMs + (Math.random() * 10_000 - 5_000)`
  - On a 4xx/5xx response or network error: double the interval up to a max of 120s
  - On success: reset interval to base 30s
- Status-monitor circuit breaker: `apps/api/src/lib/status-monitor.ts` `httpProbe()`. Add a module-level `const httpCircuit = new Map<string, { failures: number; skipUntil: number }>()`. Before calling `fetch`:
  - If `Date.now() < skipUntil` for this URL: return `'down'` immediately
  - After a successful probe: delete the circuit entry
  - After a failed probe: increment `failures`. If `failures >= 3`: set `skipUntil = Date.now() + 5 * POLL_MS` and reset `failures` to 0

## Tasks
1. Read `use-project-detail.ts` (or whatever hook drives polling) to understand the current interval setup.
2. Replace `setInterval` with a recursive `setTimeout` with jitter and backoff as described above.
3. In `status-monitor.ts`, add `httpCircuit` map above `httpProbe`. Implement the 3-failure circuit open + 5-cycle skip logic.
4. On success in `httpProbe`, remove the circuit entry for that URL.
5. Typecheck.

## Files involved
- `apps/dashboard/src/hooks/use-project-detail.ts` (or equivalent) — replace setInterval with jittered recursive setTimeout with backoff
- `apps/api/src/lib/status-monitor.ts` — add httpCircuit map to httpProbe

## Acceptance criteria
- [x] Polling hook uses `setTimeout` (not `setInterval`) — verifiable in code
- [x] Jitter of ±5s is applied on each reschedule
- [x] Consecutive API errors cause interval to grow (up to 120s max)
- [x] HTTP circuit opens after 3 consecutive probe failures for a URL
- [x] Opened circuit skips 5 poll cycles before retrying
- [x] Typecheck passes

## Out of scope
- Cross-tab coordination (SharedWorker, BroadcastChannel)
- SSH circuit breaker (SSH failures are fast; HTTP is the slow one)
- SSE reconnect backoff (different code path)

## Completed

**Date:** 2026-07-02

### Summary
Replaced the `setInterval` in `useProjectDetail` with a recursive `setTimeout` that applies ±5s jitter per cycle (base 30s, max 120s on backoff). On a thrown `fetchData` error (network-level failure), the interval doubles; on success it resets to base. Added `httpCircuit` map to `status-monitor.ts` with a `recordHttpFailure` helper: after 3 consecutive failures for a URL, the circuit opens and skips 5 poll cycles (`5 * POLL_MS = 300s`) before allowing a retry. On a successful probe, the circuit entry is deleted.

### Files changed
- `apps/dashboard/src/lib/use-project-detail.ts` — replaced `setInterval` with jittered backoff `setTimeout` loop
- `apps/api/src/lib/status-monitor.ts` — added `httpCircuit` map, `recordHttpFailure` helper, circuit check in `httpProbe`

### Verification
- `npx nx test api`: 106/106 pass
- typecheck: clean across all 5 packages

### Follow-ups
- `[defer]` Other polling hooks (`use-server-metrics`, `use-ci-history`, etc.) still use plain `setInterval` — could apply the same jitter pattern there if lockstep polling is a concern at scale
- `[defer]` The circuit state resets on API server restart; a warm-up delay means cold-start skips could leave a circuit erroneously open if first probe also fails — acceptable for now
