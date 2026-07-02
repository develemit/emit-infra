# Sprint 104 — Toast/snackbar component + action feedback wiring

**Difficulty:** 3

## Goal

Create a lightweight `<Toast>` UI primitive and a `useToast()` hook, then wire it up so rollback, container restart, secrets sync, and deploy operations show a brief success or error message when they complete.

## Reason

Users complete destructive and state-changing operations (rollback, container restart, secrets sync, deploy) with no confirmation that the action succeeded. The terminal output inside modals shows exit code, but once the modal closes that feedback is gone. A transient toast closes the loop without adding permanent UI clutter.

## Context

- No toast library exists in the project. Build a minimal one — a fixed-position overlay with one or two stacked messages, each with a type (`success` | `error`), a message string, and auto-dismiss after 4 seconds.
- Pattern: a `ToastProvider` wraps the app in `apps/dashboard/app/layout.tsx`. `useToast()` returns `{ showToast(msg, type) }`. Components call `showToast(...)` after their async operation resolves.
- Existing UI primitives to reference for style: `apps/dashboard/src/components/ui/badge.tsx` and `skeleton.tsx`. Keep the Toast styled similarly — no external dependency.
- Files that need a toast wired in:
  - `apps/dashboard/src/components/rollback-panel.tsx` — after `handleRestore` SSE stream exits with code 0, show success; on non-zero, show error.
  - `apps/dashboard/src/components/detail/container-table.tsx` — after `restartContainer` resolves, show success or error.
  - `apps/dashboard/src/components/secrets-sync-panel.tsx` — after sync completes, show success or error.
  - `apps/dashboard/src/components/deploy-panel.tsx` — after deploy SSE exits with code 0, show success; on non-zero, show error.
- The `<Toast>` component should render in a portal or fixed-position `div` at bottom-right (or top-right — pick one and be consistent). Auto-dismiss via `setTimeout` with cleanup in useEffect.

## Tasks

1. Create `apps/dashboard/src/components/ui/toast.tsx` — the `<Toast>` component and `ToastProvider`. Export a `useToast()` hook that returns `showToast(message: string, type: 'success' | 'error')`.
2. Add `<ToastProvider>` to `apps/dashboard/app/layout.tsx` wrapping the children.
3. Read `apps/dashboard/src/components/rollback-panel.tsx`. Wire `showToast` after the SSE stream ends.
4. Read `apps/dashboard/src/components/detail/container-table.tsx`. Wire `showToast` after `restartContainer`.
5. Read `apps/dashboard/src/components/secrets-sync-panel.tsx`. Wire `showToast` after sync completes.
6. Read `apps/dashboard/src/components/deploy-panel.tsx`. Wire `showToast` after deploy SSE ends.
7. Run `pnpm nx typecheck dashboard --skip-nx-cache`.

## Files involved

- (new) `apps/dashboard/src/components/ui/toast.tsx` — Toast component + ToastProvider + useToast hook
- `apps/dashboard/app/layout.tsx` — wrap children with ToastProvider
- `apps/dashboard/src/components/rollback-panel.tsx` — add showToast after SSE exit
- `apps/dashboard/src/components/detail/container-table.tsx` — add showToast after restartContainer
- `apps/dashboard/src/components/secrets-sync-panel.tsx` — add showToast after sync
- `apps/dashboard/src/components/deploy-panel.tsx` — add showToast after deploy SSE exit

## Acceptance criteria

- [x] `<Toast>` renders at a fixed screen position and auto-dismisses after 4 seconds
- [x] Success toasts are visually distinct from error toasts (color or icon difference)
- [x] Rollback, container restart, secrets sync, and deploy all show a toast on completion
- [x] Multiple simultaneous toasts stack without overlapping
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` clean

## Completed

**Date:** 2026-06-28

### Summary
Created a minimal `<Toast>` system in `toast.tsx` — a React Context with `ToastProvider` and `useToast()` hook. Toasts render in a fixed bottom-right overlay, auto-dismiss after 4 seconds via `setTimeout` in a `useEffect`, and stack vertically without overlap. Success toasts use `--ok` / `--ok-soft` color tokens; error toasts use `--err` / `--err-soft`, with a ✓/✗ prefix for quick scanning. `ToastProvider` wraps the app body in `layout.tsx`. The four operation panels wire in via `useToast()`: rollback and deploy watch `exit` via `useEffect`, secrets-sync does the same; container restart wraps `restartContainer` in try/catch with explicit `showToast` calls in both the desktop table handler and the mobile `MContainer` component.

### Files changed
- (new) `apps/dashboard/src/components/ui/toast.tsx` — `ToastProvider`, `ToastItem`, `useToast` hook
- `apps/dashboard/app/layout.tsx` — wrap body with `ToastProvider`
- `apps/dashboard/src/components/rollback-panel.tsx` — `useEffect` on `exit` to show toast
- `apps/dashboard/src/components/detail/container-table.tsx` — `showToast` in `MContainer.handleRestart` and `ContainerTable.handleRestart`
- `apps/dashboard/src/components/secrets-sync-panel.tsx` — `useEffect` on `exit` to show toast
- `apps/dashboard/src/components/deploy-panel.tsx` — `useEffect` on `exit` to show toast

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Toast for read-only actions (status refresh, metric polling)
- Persistent notification history or notification center
- Undo capability within the toast
