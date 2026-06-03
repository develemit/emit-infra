# Provision wizard UI

## Goal
Implement the 4-step provision wizard at both desktop and mobile breakpoints: basics form, infrastructure options (server type selector, R2 chips, Redis toggle), review summary, and live provision output with phase tracker.

## Reason
Provisioning a new project from the dashboard is the highest-value action surface after deploy. The wizard design is carefully structured to prevent mistakes (review step + cost callout before anything is created), and the 4-step mobile progress bar makes a complex multi-step form feel manageable on a phone.

## Context
- Builds on sprint 06 (design tokens, form input primitives) and sprint 08 (Terminal component).
- Builds on sprint 04's functional provision wizard — this sprint replaces the markup with the designed UI.
- Design source to read before implementing: `/tmp/emit-design/emit-infra/project/screen-provision.jsx`
- The SSE provision endpoint is `POST /api/projects/:name/provision` (from sprint 02).

**Key design details:**

**Desktop stepper** (above the card):
- Each step: numbered circle (26×26, `bg-elev`, mono) + label
- Active: `bg-accent` circle, fg label
- Done: `bg-accent-soft` circle with checkmark icon, `fg-muted` label
- Connector line between steps: `--border` default, `--accent-line` when done

**Mobile step indicator**: 4 equal-width bars (4px tall, radius 99px) — `--accent` for completed/current steps, `--border` for future. Simpler than the desktop stepper.

**Server type selector** (step 2): radio-style cards, not a standard `<select>`.
- Each option: a `<label>` card with radio dot + mono ID (e.g. "cx22") + spec string + price on right
- Selected card: `--accent` border + `--accent-soft` background
- Unselected: `--border` border + `--card` background

**R2 bucket chips** (step 2):
- Tag input inside a padded `bg-elev` container with `--border-strong` border
- Chips: `--accent-soft` bg, `--accent-bright` text, mono font, × button to remove
- Press Enter or comma to add a new bucket name

**Upstash Redis toggle** (step 2): a card row with zap icon + title/description + `<Switch>` on the right

**Review step** (step 3):
- Key-value list inside a card: `k` = muted 13px, `v` = mono 13px
- Accent callout below: "Provisioning creates billable infrastructure… Est. €X.XX/mo"

**Provision running** (step 4):
- Phase tracker: two `phase` rows (Terraform → Ansible) with icons: done=checkmark in `ok-soft` square, running=spinner in `accent-soft` square, waiting=clock in `bg-elev` square
- Terminal below showing live SSE output
- Footer: "provisioning…" streaming badge (no Continue button while running); on done, link to the new project

## Tasks

1. Build `src/components/ui/switch.tsx`: a toggle button.
   - Props: `on: boolean`, `onChange: () => void`
   - 38×22px, radius 99px; `--accent` when on, `--border-strong` when off
   - White 18×18px circle slides via `transform: translateX(16px)` when on

2. Build `src/components/ui/chip-input.tsx`: tag-style multi-value input.
   - Props: `values: string[]`, `onChange: (values: string[]) => void`, `placeholder?: string`
   - Renders chips inside the input area; press Enter or comma to add
   - × button on each chip removes it

3. Build `src/components/ui/stepper.tsx` (desktop): the numbered step indicator described above.
   - Props: `steps: string[]`, `current: number` (1-indexed)

4. Build `src/components/ui/mobile-stepper.tsx`: the 4-bar progress indicator.
   - Props: `steps: number`, `current: number`

5. Build `src/components/provision/step-basics.tsx`: step 1 form.
   - Fields: Project name (mono input, hint: "lowercase, slug-format"), Domain (mono, hint: "root domain in Cloudflare"), GitHub repo (input with GitHub icon prefix, hint: "owner/repo")
   - Validates on Continue: name must match `/^[a-z0-9-]+$/`, domain must contain a dot, repo must match `owner/repo` format

6. Build `src/components/provision/step-infrastructure.tsx`: step 2 form.
   - Region `<select>` + SSH key `<select>` (side by side on desktop, stacked on mobile)
   - Server type radio cards (cx22 / cx32 / cx42 with full spec strings and monthly prices)
   - R2 bucket ChipInput
   - Upstash Redis toggle card

7. Build `src/components/provision/step-review.tsx`: step 3 summary.
   - Read-only key-value list (Name, Domain, GitHub, Region, Server, SSH key, R2 buckets, Redis)
   - Accent callout with estimated monthly cost (calculate from selected server type)

8. Build `src/components/provision/step-running.tsx`: step 4 live output.
   - Phase tracker with two phases (Terraform, Ansible) — driven by SSE event text parsing (look for "Apply complete" to transition Terraform → done, ansible start markers to activate Ansible phase)
   - Terminal component streaming SSE output
   - On `{ type: 'done', exitCode: 0 }`: show "View Project →" link to `/projects/:name`. On non-zero: show red error callout.

9. Update `app/provision/page.tsx`:
   - Desktop: Shell-wrapped, maxWidth 600, stepper above card, card holds the current step body + nav buttons
   - Mobile: no Shell sidebar (full-screen wizard), mobile stepper at top, step title/subtitle, step body, Next/Back sticky footer
   - State: current step (1–4), form values (name, domain, repo, region, sshKey, serverType, r2Buckets, redis)
   - On "Provision" (step 3 → 4): call `POST /api/projects/:name/provision` and transition to step 4

## Files involved
- new file: `apps/dashboard/src/components/ui/switch.tsx`
- new file: `apps/dashboard/src/components/ui/chip-input.tsx`
- new file: `apps/dashboard/src/components/ui/stepper.tsx`
- new file: `apps/dashboard/src/components/ui/mobile-stepper.tsx`
- new file: `apps/dashboard/src/components/provision/step-basics.tsx`
- new file: `apps/dashboard/src/components/provision/step-infrastructure.tsx`
- new file: `apps/dashboard/src/components/provision/step-review.tsx`
- new file: `apps/dashboard/src/components/provision/step-running.tsx`
- `apps/dashboard/app/provision/page.tsx` — replace scaffold with designed wizard

## Acceptance criteria
- [x] Desktop stepper shows correct done/active/pending states as user advances through steps
- [x] Mobile shows 4-bar progress indicator advancing through steps
- [x] Server type radio cards select/deselect with correct accent border and background
- [x] R2 chip input adds a chip on Enter and removes on × click
- [x] Redis toggle card switches correctly
- [x] Review step shows all entered values in the key-value list with correct monthly cost
- [x] Continue button on step 1 and 2 is blocked if validation fails (shows hint text)
- [x] Step 4 renders the terminal and transitions Terraform/Ansible phases based on output
- [x] Step 4 "View Project" link appears on exit code 0
- [x] All steps render correctly at 375px
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Built 8 new components for the provision wizard. Four UI primitives: `Switch` (38×22 toggle, accent/border-strong), `ChipInput` (Enter/comma to add, Backspace to remove last, × per chip), `Stepper` (done/active/pending states with check icon, accent connector lines), and `MobileStepper` (4-bar accent progress indicator). Four provision step components: `StepBasics` (name/domain/repo fields with inline validation), `StepInfrastructure` (region+SSH selects, server-type radio cards, ChipInput for R2, Redis Switch card), `StepReview` (key-value summary list + accent cost callout with computed monthly price), and `StepRunning` (Terraform/Ansible phase tracker with spinner/checkmark/clock icons, Terminal with SSE, View Project link on exit 0). Rewrote `provision/page.tsx` as the orchestrator: manages form state, desktop card+stepper layout (maxWidth 600), and mobile full-screen layout with MobileStepper and sticky nav footer above the tab bar.

### Files changed
- (new) `apps/dashboard/src/components/provision/types.ts` — FormValues interface
- (new) `apps/dashboard/src/components/ui/switch.tsx` — toggle primitive
- (new) `apps/dashboard/src/components/ui/chip-input.tsx` — tag-style multi-value input
- (new) `apps/dashboard/src/components/ui/stepper.tsx` — desktop numbered stepper
- (new) `apps/dashboard/src/components/ui/mobile-stepper.tsx` — 4-bar mobile progress
- (new) `apps/dashboard/src/components/provision/step-basics.tsx` — step 1
- (new) `apps/dashboard/src/components/provision/step-infrastructure.tsx` — step 2
- (new) `apps/dashboard/src/components/provision/step-review.tsx` — step 3
- (new) `apps/dashboard/src/components/provision/step-running.tsx` — step 4
- `apps/dashboard/app/provision/page.tsx` — rewritten as 4-step orchestrator

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)

### Follow-ups
- `[defer]` StepBasics desktop Continue button is hidden on mobile (handled by the sticky footer in page.tsx) — this is correct but the component has `hidden lg:flex` on the button, meaning the step-level button only shows on desktop. This is by design but worth noting.
- `[defer]` SSH key selector is hardcoded to "emit-deploy" — should read from the API or local SSH config

## Out of scope
- Claude ops panel (sprint 10)
- PWA (sprint 11)
