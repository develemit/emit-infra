# Sprint 227 — Bundle simultaneous alert notifications

> _Promoted from backlog item (sprint 192), 2026-07-17._

## Goal
When multiple alert rules fire in the same poll cycle for a project, send a single bundled push notification instead of one per metric.

## Context
- `apps/api/src/lib/status-monitor.ts` lines 194-211: after `evaluateRules` returns a `fired` array, each alert sends a separate `sendToAll()` call. If disk, memory, and cert fire simultaneously, the operator gets 3 separate push notifications.
- `sendToAll` is in `apps/api/src/lib/push.ts` — accepts `{ title, body, url?, tag? }`.
- The `tag` field in Web Push replaces notifications with the same tag, so rapid-fire same-tag notifications collapse. But different metrics have different tags (`alert:<name>:<metric>`), so they stack.

## Tasks
1. In `status-monitor.ts`, after the `evaluateRules` call (line 197), collect all fired alerts.
2. If `fired.length > 1`, construct a single bundled notification:
   - Title: `<project name>`
   - Body: `"3 alerts: disk 92% > 90, memory 85% > 80, cert days 5 < 14"` (one-line summary)
   - Tag: `alert:<name>:bundle`
3. If `fired.length === 1`, send the existing single-metric notification (no change).
4. Add a test for the bundling logic — extract the notification formatting to a small pure function (e.g. `formatAlertNotification(fired: FiredAlert[]): PushPayload`) that can be unit-tested.
5. Run `npx nx run api:test` and `npx nx run api:typecheck`.

## Acceptance criteria
- [x] Multiple simultaneous alerts → single push notification with summary body.
- [x] Single alert → same behavior as before.
- [x] Tests cover both single and bundled paths.
- [x] Typecheck clean.

## Completed

**Date:** 2026-07-18

### Summary
Extracted the per-alert notification logic from `status-monitor.ts` into an exported pure function `formatAlertNotification(fired: FiredAlert[]): PushPayload`. When `fired.length === 1` it produces the same single-metric body as before; when `fired.length > 1` it emits a single bundled notification (`"N alerts: ..."`) with tag `alert:<name>:bundle`. The original per-alert `for` loop is replaced with a single `sendToAll(formatAlertNotification(fired))` call, so simultaneous threshold breaches in one poll cycle produce exactly one push notification.

### Files changed
- `apps/api/src/lib/status-monitor.ts` — added `formatAlertNotification`, moved `metricLabels` to module scope, replaced per-alert loop with single bundled sendToAll call
- (new) `apps/api/src/lib/status-monitor.test.ts` — 7 tests covering single-alert path, bundle path, unknown metric fallback, URL encoding, and value rounding

### Verification
- `npx nx run api:test`: 301/301 pass (7 new in status-monitor.test.ts)
- `npx nx run api:typecheck`: clean

### Follow-ups
- none
