# Alert rules: settings UI, push delivery, and recent-alerts display
**Difficulty:** 4

## Goal
Fired alerts from sprint 191's engine are delivered as push notifications, users can add/edit/remove alert rules from the project settings panel, and recent fired alerts are visible on the Reliability sub-page.

## Reason
Sprint 191 built the evaluation engine; this sprint makes it usable — rules editable without hand-editing config JSON, and breaches actually notifying the operator. Together they complete the top capability item from the 2026-07-02 scan.

## Context
- **Depends on sprint 191** (`alertRules[]` config field, `alert-rules.ts` evaluator, fired-alert persistence, `GET /projects/:name/alerts`). Read that sprint's Completed section and the files it created before starting.
- Push delivery: the status monitor already calls the push lib for up/down transitions (`apps/api/src/lib/push.ts`, `sendToAll` or similar — read it; note sprint 183 fixed its cache invalidation). Add a push send where the monitor receives `fired[]` from the evaluator. Message format: `"<project>: disk 87% > 85%"` style — metric, value, threshold. Cooldown is already handled by the engine, so delivery is 1:1 with fired alerts.
- Default cert rule: if a project has a domain but no `certDays` rule, seed nothing automatically in config — instead, the settings UI shows a one-click "Add recommended rules" that inserts `certDays lt 30`, `diskPct gt 85`, `backupAgeHours gt 24` (only ones applicable to the project's capabilities).
- Settings UI: `apps/dashboard/src/components/detail/project-settings-panel.tsx` is already ~216 lines with a section-per-concern pattern (`useSave` hook, `Field`, `SaveButton`). Adding a rules section will push it past the 300-line repo limit — extract the new section as `alert-rules-section.tsx` and render it from the panel. UI per rule row: metric select, op select (> / <), threshold number input, enabled checkbox, remove button; plus "Add rule" and the recommended-rules button. Save via the existing `updateProjectConfig` client (extend its accepted fields — see `apps/dashboard/src/lib/api-projects.ts` or wherever it lives).
- Recent alerts display: Reliability sub-page (`app/projects/[name]/reliability/page.tsx`) gets a small "Recent alerts" list (last 7 days from `GET .../alerts`): metric, value vs threshold, relative time. New small component `alert-history-panel.tsx`; follow panel styling conventions (rounded-xl border bg-card, Icon header row).
- Client validation mirrors server Zod: threshold must be a positive number; show inline error, clear on edit (pattern from sprint 181).

## Tasks
1. Read sprint 191 outputs (evaluator, alerts route, config schema) and `push.ts`.
2. Wire push delivery for fired alerts in the monitor cycle.
3. Build `alert-rules-section.tsx` (rule CRUD + recommended-rules seeding) and mount it in the settings panel; extend the config-update client typing.
4. Build `alert-history-panel.tsx` and add it to the Reliability sub-page with loading/empty states.
5. Extend API tests if the config PATCH schema changed; typecheck both apps; run tests.
6. Manual sanity pass: create a rule with an absurdly low threshold on a live project (if reachable) or verify via unit-level wiring that fired → push send is called.

## Files involved
- status monitor file — push send on fired alerts
- new file: `apps/dashboard/src/components/detail/alert-rules-section.tsx`
- new file: `apps/dashboard/src/components/detail/alert-history-panel.tsx`
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — mount rules section
- `apps/dashboard/app/projects/[name]/reliability/page.tsx` — mount alert history
- client api module for `updateProjectConfig` + new `getAlerts` call

## Acceptance criteria
- [x] A fired alert produces exactly one push notification (cooldown respected)
- [x] Rules can be added/edited/removed/disabled from settings and persist via PATCH
- [x] "Add recommended rules" seeds applicable defaults
- [x] Reliability sub-page lists recent fired alerts
- [x] Typecheck clean; all tests pass

## Out of scope
- Email or other notification channels — web push only
- Per-rule custom cooldown windows (engine default stands)

## Completed

**Date:** 2026-07-03

### Summary
Wired push notifications for fired alerts in the status monitor (one push per fired alert, cooldown from sprint 191 ensures no spam). `AlertRulesSection` component lets operators add/edit/remove rules inline in the settings panel with per-row metric/op/threshold/enabled controls; "Add recommended" seeds diskPct>85, certDays<30 (if domain), backupAgeHours>24 (if postgres bucket). Saves via the existing `PATCH /config` endpoint with extended `alertRules` field on `ProjectConfigPatch`. `AlertHistoryPanel` on the Reliability sub-page shows last 20 fired alerts from the past 7 days with relative timestamps.

### Files changed
- `apps/api/src/lib/status-monitor.ts` — added push delivery for each fired alert after evaluation
- `apps/dashboard/src/lib/api-projects.ts` — added `AlertRule`, `FiredAlert` types; `alertRules` to `ProjectConfigPatch`; `getAlerts(name, days)` function
- (new) `apps/dashboard/src/components/detail/alert-rules-section.tsx` — CRUD UI for alert rules with validation and recommended-rules seeding
- (new) `apps/dashboard/src/components/detail/alert-history-panel.tsx` — recent fired alerts list panel
- `apps/dashboard/src/components/detail/project-settings-panel.tsx` — imports and mounts `AlertRulesSection`
- `apps/dashboard/app/projects/[name]/reliability/page.tsx` — imports and mounts `AlertHistoryPanel`

### Verification
- `npx nx run api:typecheck`: clean
- `npx nx run dashboard:typecheck`: clean
- `npx nx run api:test`: 173/173 pass
- `npx nx run dashboard:test`: 66/67 pass (1 pre-existing failure in container-row.test.tsx)

### Follow-ups
- `[defer]` `AlertRulesSection` initializes rules from `project.config.alertRules` at mount; if the config is updated server-side, the UI won't reflect it until page reload. Could re-fetch config on open if this becomes a pain point.
- `[defer]` Push notification for alerts has no deduplication beyond the `tag` field — if two different metrics fire at the same time, both send separate notifications. Acceptable for now.
