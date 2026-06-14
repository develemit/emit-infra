# Sprint 52 — Project-Goes-Down Browser Notification
**Difficulty:** 3

## Goal
Fire a browser notification when the dashboard detects that a project transitions from reachable to SSH-unreachable during the 30-second polling loop.

## Reason
The dashboard runs in a background tab most of the time. If a project goes down at 2am, the operator has no way to know until they manually open the tab. Browser notifications (Web Notifications API) require no server infrastructure changes and work while the tab is minimized or in the background — as long as the tab is still open.

## Context
`apps/dashboard/app/page.tsx` is the home page. It polls all projects on a 30-second interval:
```ts
const [statuses, setStatuses] = useState<Record<string, ProjectStatus>>({})
ps.forEach(p => {
  void getStatus(p.config.name).then(
    s => setStatuses(prev => ({ ...prev, [p.config.name]: s })),
    () => setStatuses(prev => ({ ...prev, [p.config.name]: { error: 'unreachable' } })),
  )
})
```

The `statuses` state is a Record keyed by project name. To detect a transition, compare the **previous** value of `statuses` (before the update) to the new value for each project:
- If previous had no `error` (was reachable) AND new has `error: 'unreachable'` → fire notification

Use a `useRef` to hold the previous statuses so the comparison is stable:
```ts
const prevStatuses = useRef<Record<string, ProjectStatus>>({})
// after fetchAll resolves, compare before calling setStatuses
```

**Browser Notification API:**
```ts
function notifyDown(projectName: string) {
  if (Notification.permission !== 'granted') return
  new Notification(`${projectName} is down`, {
    body: 'SSH unreachable — check the server.',
    tag: `down-${projectName}`,  // deduplicates repeat alerts
  })
}
```

**Permission request:** Request permission once on first mount (not on every notification). Use `Notification.requestPermission()` in a `useEffect` on mount. Modern browsers require this to happen in response to a user gesture — the spec allows it in `useEffect` but some browsers may suppress it if it fires immediately. Wrap it in a check: only request if `Notification.permission === 'default'`.

## Tasks
1. Read `apps/dashboard/app/page.tsx` in full.
2. Add a `prevStatuses` ref: `const prevStatuses = useRef<Record<string, ProjectStatus>>({})`.
3. Add a `notifyDown(name: string)` helper inside the component (outside render, before return).
4. Request notification permission on mount:
   ```ts
   useEffect(() => {
     if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
       void Notification.requestPermission()
     }
   }, [])
   ```
5. In `fetchAll`, after all project statuses resolve, before calling `setStatuses`:
   - For each project name: if `prevStatuses.current[name]` had no error AND new status has `error` → call `notifyDown(name)`.
   - Then update `prevStatuses.current = newStatuses` and call `setStatuses(newStatuses)`.
   - Restructure the per-project `forEach` into a `Promise.allSettled` or collect into a local record first so you can do the comparison atomically.
6. Confirm no typecheck errors. The `Notification` API is available in browser `lib` — check that `tsconfig.json` for the dashboard includes `"lib": ["dom"]` or similar (it should already).

## Files involved
- `apps/dashboard/app/page.tsx` — add permission request, prevStatuses ref, transition detection + notify call

## Acceptance criteria
- [x] On first load the browser shows a notification permission prompt (if not already granted/denied)
- [x] When a project transitions from reachable to unreachable during a poll, a browser notification fires
- [x] Repeated polls showing the same project still down do NOT fire duplicate notifications (use `tag:` deduplication)
- [x] Projects that were already unreachable on first load do NOT trigger a notification (no false positives on mount)
- [x] If notifications are denied, no errors are thrown
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-13

### Summary
Refactored `fetchAll` in `page.tsx` to use `Promise.allSettled` to collect all project statuses into a local record before updating state. Added a `prevStatuses` ref that captures the previous poll's results. After each poll, transitions where `prev.error` was falsy and `newStatus.error` is truthy fire a browser notification via `notifyDown()` (a module-level helper that guards on `Notification.permission`). The `tag: down-<name>` field deduplicates repeated alerts. A mount `useEffect` requests permission once if it's still `'default'`.

### Files changed
- `apps/dashboard/app/page.tsx` — restructured fetchAll to collect atomically, added prevStatuses ref, notifyDown helper, permission request on mount

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
none

## Out of scope
- Notification when a project comes back online (add later)
- Push notifications when the tab is closed (requires service worker — separate initiative)
- Per-project notification opt-out settings
