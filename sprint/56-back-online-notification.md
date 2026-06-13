# Sprint 56 — Project-Comes-Back-Online Browser Notification
**Difficulty:** 2

> _Promoted from sprint-52 out-of-scope, 2026-06-13._

## Goal
Fire a browser notification when a project transitions from SSH-unreachable back to reachable, mirroring the goes-down notification from sprint 52.

## Reason
Sprint 52 added "goes down" notifications. Operators who see the "down" alert and wait for the server to recover currently have to check the dashboard manually — there's no signal that it came back. A "back online" notification completes the pair and removes that manual polling loop.

## Context
`apps/dashboard/app/page.tsx` already has:
- `prevStatuses` ref: `useRef<Record<string, ProjectStatus>>({})`
- `notifyDown(name: string)` function that guards on `Notification.permission !== 'granted'`
- Transition detection loop (after each `Promise.allSettled` poll):
  ```ts
  for (const [name, newStatus] of Object.entries(newStatuses)) {
    const prev = prevStatuses.current[name]
    if (prev && !prev.error && newStatus.error) {
      notifyDown(name)
    }
  }
  ```

The `notifyDown` helper is a module-level function. Add a matching `notifyUp(name)` alongside it, then add a second branch in the transition detection loop:

```ts
if (prev?.error && !newStatus.error) {
  notifyUp(name)
}
```

`notifyUp` should use `tag: up-${name}` for deduplication and a distinct message:
```ts
function notifyUp(name: string) {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  new Notification(`${name} is back online`, {
    body: 'SSH reachable — server has recovered.',
    tag: `up-${name}`,
  })
}
```

## Tasks
1. Read `apps/dashboard/app/page.tsx` in full to see the current state after sprint 52.
2. Add `notifyUp(name: string)` as a module-level function next to `notifyDown`.
3. In the transition detection loop, add a second condition:
   ```ts
   if (prev?.error && !newStatus.error) {
     notifyUp(name)
   }
   ```
4. Run `pnpm nx run dashboard:typecheck` to confirm clean.

## Files involved
- `apps/dashboard/app/page.tsx` — add `notifyUp` + back-online transition detection

## Acceptance criteria
- [ ] When a project transitions from unreachable to reachable during a poll, a browser notification fires
- [ ] Repeated polls showing the same project still up do NOT fire duplicate notifications (`tag: up-<name>`)
- [ ] Projects that were already reachable on first load do NOT trigger a notification
- [ ] Goes-down notifications still work (no regression)
- [ ] `pnpm nx run dashboard:typecheck` clean

## Out of scope
- Per-project opt-out settings for up/down notifications
- Push notifications when the tab is closed (service worker — separate initiative)
