# UX: Nginx Path Tooltip + Settings ARIA Labels
**Difficulty:** 1

## Goal
Add a `title` tooltip to truncated nginx endpoint paths and add `aria-expanded` / `aria-label` to the Settings panel toggle button.

## Reason
The nginx path column clips at ~260px with no hover text — users on narrow screens cannot read the full endpoint path. The Settings panel collapsible has no `aria-expanded` or `aria-label`, so screen readers announce a nameless button with no open/closed state. Both are 1–3 line fixes in different components.

## Context
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` line ~43: the `<td>` or inner element rendering `ep.path` needs `title={ep.path}` so browsers show the full path on hover. Add it to the innermost element that clips.
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` line ~95: the toggle `<button>` that expands/collapses the settings form needs two attributes:
  - `aria-expanded={open}` — reflects the current open/closed state (where `open` is the existing boolean state variable)
  - `aria-label="Project settings"` — gives the button a name for screen readers

## Tasks
1. In `nginx-endpoints-panel.tsx`, find the element rendering `ep.path` and add `title={ep.path}`.
2. In `project-settings-panel.tsx`, find the collapse toggle button and add `aria-expanded={open}` and `aria-label="Project settings"`.
3. Run `npx tsc --noEmit` to confirm no type errors.

## Files involved
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — add `title` attribute to path cell
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — add `aria-expanded` and `aria-label` to toggle button

## Acceptance criteria
- [x] Hovering over a truncated path in the nginx panel shows the full path in a native browser tooltip
- [x] Settings toggle button has `aria-expanded={open}` that changes when the panel opens/closes
- [x] Settings toggle button has a non-empty `aria-label`
- [x] Typecheck passes

## Out of scope
- Custom tooltip components (native `title` is sufficient)
- Other ARIA improvements beyond the toggle button
- Nginx panel column width changes

## Completed

**Date:** 2026-07-01

### Summary
Two one-liner additions: `title={ep.path}` on the nginx path `<td>` (browsers show the full path on hover even when the cell truncates), and `aria-expanded={open}` + `aria-label="Project settings"` on the Settings collapsible toggle button.

### Files changed
- `apps/dashboard/src/components/detail/nginx-endpoints-panel.tsx` — added `title={ep.path}` to path cell
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — added `aria-expanded={open}` and `aria-label="Project settings"` to toggle button

### Verification
- typecheck: clean (dashboard freshly compiled, all 5 packages pass)

### Follow-ups
none
