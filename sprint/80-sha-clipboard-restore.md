# Restore SHA clipboard copy on CI and deploy history rows
**Difficulty:** 1

## Goal
Re-add a small copy icon next to the short SHA in CI and deploy timeline rows. The icon copies the full SHA to clipboard and stops event propagation so it doesn't navigate to the log viewer.

## Reason
The SHA copy button was removed in sprint 78 when rows were converted to `<Link>` elements. Having the full SHA available from the timeline is useful for `git checkout`, `git show`, and cross-referencing GitHub — and the row-as-link shouldn't preclude it.

## Context
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — each row is a `<Link href=".../ci-log/${r.sha}">`. The SHA is rendered as `<span className="font-mono text-[12px] text-fg">{r.sha.slice(0, 7)}</span>`.
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — same pattern with `d.sha`.
- The copy button must call `e.preventDefault()` and `e.stopPropagation()` to avoid triggering the Link navigation.
- Use `navigator.clipboard.writeText(fullSha)` — no fallback needed (this is a local dashboard, modern browser guaranteed).
- The `Icon` component is already imported in both files (`import { Icon } from '@/components/icon'`). Use `icon name="copy"` or whichever copy icon name the Icon component supports — check `apps/dashboard/src/components/icon.tsx` for the available names.
- Keep the copy button as a `<button>` element (not another `<a>`), styled minimally: `className="text-subtle hover:text-fg transition-colors"` with `type="button"`.

## Tasks
1. Open `apps/dashboard/src/components/icon.tsx` to confirm the copy icon name.
2. In `ci-timeline.tsx`, after the `{r.sha.slice(0, 7)}` span, add:
   ```tsx
   <button
     type="button"
     className="text-subtle hover:text-fg transition-colors"
     onClick={e => { e.preventDefault(); e.stopPropagation(); void navigator.clipboard.writeText(r.sha) }}
   >
     <Icon name="copy" size={11} />
   </button>
   ```
3. Apply the same change to `deploy-timeline.tsx` using `d.sha`.

## Files involved
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — add copy button after SHA span
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — same

## Acceptance criteria
- [x] Clicking the copy icon copies the full 40-char SHA to clipboard
- [x] Clicking the copy icon does NOT navigate to the log viewer
- [x] Clicking the row text area (outside the icon) still navigates normally
- [x] `pnpm typecheck` passes

## Completed

**Date:** 2026-06-20

### Summary
Added a small copy icon button next to the 7-char SHA display in both CI and deploy timeline rows. The button calls `e.preventDefault()` and `e.stopPropagation()` before writing the full SHA to clipboard, so clicking it doesn't trigger the row's `<Link>` navigation. Used the existing "copy" icon from the project's Icon component at size 11.

### Files changed
- `apps/dashboard/src/components/detail/ci-timeline.tsx` — copy button added after SHA span
- `apps/dashboard/src/components/detail/deploy-timeline.tsx` — same

### Verification
- `pnpm typecheck` (dashboard): clean
- Copy button placement and stopPropagation logic: verified in code

### Follow-ups
none

## Out of scope
- Toast/confirmation feedback after copy (would need a toast system)
- Copy button on the log viewer page header (separate concern)
