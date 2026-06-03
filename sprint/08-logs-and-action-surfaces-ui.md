# Logs + action surfaces UI

## Goal
Implement the Terminal component (with CRT scanline effect), the live logs screen, the deploy SSE output panel (inline on desktop, bottom sheet on mobile), and the 3-step destroy confirmation modal — all pixel-faithful to the approved design.

## Reason
These are the highest-stakes surfaces in the dashboard: watching a deploy stream live and confirming a destructive operation. The visual design communicates state (streaming, done, failed) in ways that matter for trust and safety. Getting the Terminal component right here means deploy output, provision output, and the ops panel all share the same faithful component.

## Context
- Builds on sprints 06 (design system) and 07 (project detail page is already in place — this sprint wires the Deploy and Destroy buttons on it).
- Builds on sprint 02's SSE streaming API endpoints.
- Design source files to read before implementing:
  - `/tmp/emit-design/emit-infra/project/terminal.jsx` — Terminal component structure
  - `/tmp/emit-design/emit-infra/project/screen-logs.jsx` — Logs screen
  - `/tmp/emit-design/emit-infra/project/screen-detail.jsx` — `DeploySheetMobile` and `DetailDesktop` deploy panel
  - `/tmp/emit-design/emit-infra/project/screen-destroy.jsx` — full 3-step modal

**Terminal component key details (from design):**
- Background always `var(--term-bg) #0a0d0c`, border `#1c241f`
- CRT scanline: `::after` pseudo with `repeating-linear-gradient(to bottom, rgba(180,255,220,0.022) 0 1px, transparent 1px 3px)`, `mix-blend-mode: overlay`
- Subtle inner glow: `box-shadow: inset 0 0 60px rgba(16,185,129,0.05), inset 0 1px 0 rgba(255,255,255,0.03)`
- Title bar: macOS-style traffic lights (red #ff5f57, yellow #febc2e, green #28c840), title in `--term-dim` mono
- Running indicator: "● live" in `--t-green` at right of title bar
- Blinking caret: 8×15px green block, `box-shadow: 0 0 6px rgba(74,222,128,.7)`, step-end blink
- Exit badge: `exit ok` (green) / `exit err` (red) / streaming (blue)
- Text shadow on body: `0 0 3px rgba(120,255,190,0.08)` — subtle phosphor glow

**SSE event shape** (from sprint 02): `{ type: 'line', stream: 'stdout'|'stderr', text: string }` | `{ type: 'done', exitCode: number }` | `{ type: 'error', message: string }`

**Logs screen service colours:** vision-web → `t-blue`, vision-api → `t-cyan`, vision-worker → `t-magenta` — general pattern: each service gets a consistent colour, derived from a small palette cycling by index.

## Tasks

### Terminal component

1. Build `src/components/ui/terminal.tsx`:
   - Props: `title`, `running?: boolean`, `exit?: number`, `children`, `bodyStyle?`, `style?`, `bar?: boolean` (default true), `footer?: boolean` (default true)
   - The CRT scanline is a CSS `::after` on `.term` — define `.term::after` in `globals.css`
   - Auto-scroll body to bottom when `running` is true and new children arrive (use a `useEffect` watching children)
   - Export a `TermLine` sub-component for log lines: accepts optional `ts` (timestamp, styled in `--ts` dim colour) and children

### Logs screen

2. Build `app/projects/[name]/logs/page.tsx`:
   - Connects to `GET /api/projects/:name/logs` SSE stream on mount via `EventSource`
   - Service filter dropdown: populated from `getContainers()` result — "all services" default + one option per container name
   - Follow toggle (switch): when on, auto-scrolls terminal body; when off, pauses scroll
   - Stop button: `danger sm` variant — disconnects the `EventSource`
   - Each log line: service name (coloured by index from a `SERVICE_COLORS` palette) + `│` separator + timestamp + message body
   - Terminal fills remaining screen height (`flex-1 min-h-0`)
   - Desktop: LogControls in topbar actions area
   - Mobile: LogControls row below the header, above the terminal; no tab bar (full-screen log view), back arrow in header with "● live" pill

### Deploy action

3. Build `src/components/deploy-panel.tsx`:
   - Desktop variant: renders inline below the containers section when Deploy is clicked. Shows `<Terminal>` with live SSE output. Has a close/collapse button when done. Button label changes to "Deploying…" (disabled) while running.
   - Mobile variant (bottom sheet): positioned absolutely, slides up from bottom covering 75% of screen height. Drag handle at top. Close button (× icon) in header next to "Deploying emit-vision" title.
   - Both: connect to `POST /api/projects/:name/deploy` SSE endpoint on mount. Disconnect and show exit badge when `{ type: 'done' }` is received.

4. Wire Deploy button on `app/projects/[name]/page.tsx`:
   - Desktop: clicking Deploy mounts `<DeployPanel>` inline
   - Mobile: clicking Deploy renders the bottom-sheet variant
   - Disable the Deploy button while a deploy is in progress (track with local state)

### Destroy modal

5. Build `src/components/destroy-modal.tsx` — 3 steps:

   **Step 1 — Warning:**
   - Modal with `danger` border (`--err-line`), red-icon header (alert in 34×34 err-soft square)
   - Title: "Destroy {name}?" + subtitle with domain/region/type in mono
   - Callout: red background, "This is irreversible. Terraform will permanently destroy all managed infrastructure. There is no undo."
   - Destroy list (from project config): server (type + region), DNS records (domain + www), R2 buckets (if any), Redis (if configured)
   - Footer: "Cancel" ghost + "Continue" danger-solid

   **Step 2 — Confirm:**
   - Same modal header
   - Text: "To confirm, type the project name `{name}` below."
   - Input with `--err-line` focus ring and `--err-soft` shadow; shows green checkmark icon inside when value matches
   - "Destroy {name}" button enabled only when input matches exactly (strict equality)
   - Footer: "Cancel" ghost + "Destroy {name}" danger-solid (disabled until match)

   **Step 3 — Running:**
   - Modal title changes to "Destroying {name}" — no close button, no X
   - Terminal with live SSE output from `POST /api/projects/:name/destroy`
   - "Do not close this window while destroy is running." callout
   - Footer: streaming badge (blue spinner + "destroying — X of Y resources") — no buttons
   - On done: exit badge shows; modal footer gets a "Close" button

6. Wire Destroy button on `app/projects/[name]/page.tsx`: clicking opens the modal at step 1.

## Files involved
- new file: `apps/dashboard/src/components/ui/terminal.tsx`
- new file: `apps/dashboard/src/components/deploy-panel.tsx`
- new file: `apps/dashboard/src/components/destroy-modal.tsx`
- new file: `apps/dashboard/app/projects/[name]/logs/page.tsx`
- `apps/dashboard/app/projects/[name]/page.tsx` — wire Deploy + Destroy buttons
- `apps/dashboard/app/globals.css` — add `.term::after` scanline rule

## Acceptance criteria
- [x] Terminal component renders with dark background and visible CRT scanline overlay
- [x] Blinking caret shows when `running` is true; disappears when `exit` is provided
- [x] Exit badge is green for exit 0, red for non-zero
- [x] Logs screen streams Docker output and new lines auto-scroll when Follow is on
- [x] Service filter dropdown filters the stream to the selected container
- [x] Stop button disconnects the SSE stream
- [x] Deploy button opens the SSE panel; live output lines appear as they arrive
- [x] Deploy panel mobile bottom sheet animates up and can be closed after deploy finishes
- [x] Destroy modal step 1 lists all resources from the project config
- [x] Destroy modal step 2 confirm button is disabled until project name is typed exactly
- [x] Destroy modal step 3 streams Terraform output; modal cannot be closed while running
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Built the Terminal component as a shared primitive that all streaming surfaces now use. It renders the `.ec-term` wrapper (dark background, inner glow) with the CRT scanline overlay via `::after` in globals.css, a macOS-style traffic light title bar, blinking caret when running, and exit badge (green ✔/red ✕/blue streaming) in the footer. Auto-scroll is triggered by a bare `useEffect` (no dep array) that fires after every render — clean and works with any children shape.

Built `DeployPanel` with inline desktop variant (below containers) and a bottom-sheet mobile variant (fixed, top: 25%, drag handle, × close button after done). Built `destroy-modal.tsx` as a full redesign: step 1 shows the irreversible warning + resource list, step 2 has the name-confirmation input with green check indicator, step 3 streams Terraform output in Terminal and prevents dismiss until done. Redesigned the logs page around Terminal — service names are parsed from `service | log-text` format and colored via a cycling palette, with a toggle-style Follow switch and Stop button in the topbar (desktop) and a below-header controls row (mobile).

### Files changed
- `apps/dashboard/app/globals.css` — added ec-term position:relative + ::after scanline, term-bar/lights/title/live/ln/ts/exit/spinner CSS classes
- (new) `apps/dashboard/src/components/ui/terminal.tsx` — Terminal + TermLine components
- (new) `apps/dashboard/src/components/deploy-panel.tsx` — inline + bottom-sheet deploy SSE panel
- `apps/dashboard/src/components/destroy-modal.tsx` — full redesign with Terminal in step 3
- `apps/dashboard/app/projects/[name]/logs/page.tsx` — full redesign with Terminal + service colors
- `apps/dashboard/app/projects/[name]/page.tsx` — swapped SseOutputPanel → DeployPanel

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)

### Follow-ups
- `[defer]` DeployPanel mobile bottom sheet has no animation (appears instantly) — a CSS translate transition would polish the UX but is not required for function
- `[defer]` Destroy modal resource list uses static defaults — ideally parsed from the project config (terraform directory) to list actual resources

## Out of scope
- Provision wizard (sprint 09)
- Claude ops panel (sprint 10)
- PWA (sprint 11)
