# Alert rules engine: per-project rule schema + evaluation in the status monitor
**Difficulty:** 4

## Goal
Projects can define `alertRules[]` in their config (disk %, memory %, cert days-to-expiry, backup age hours), and the status monitor evaluates them each poll cycle, recording fired alerts with a cooldown so repeated breaches don't re-fire every cycle. (Push delivery + UI land in sprint 192.)

## Reason
Today the only proactive signal is binary up/down push notifications; everything else (disk filling, cert expiring, backups going stale) is discovered by opening the dashboard. This is the biggest capability jump from the 2026-07-02 scan — it converts the dashboard from something you check into something that tells you. Splitting engine (this sprint) from delivery/UI (192) keeps each session-sized.

## Context
- The status monitor lives in `apps/api/src/` (find `status-monitor.ts` — it polls projects on an interval, probes SSH/HTTP, writes incidents, and calls push on up/down transitions). Read it fully before designing; alert evaluation should hook into the same cycle so no new pollers are introduced.
- Project config: `.emit-infra.json` per project, already has `warnThresholds { diskPct, memPct, backupAgeHours }` (see `project-settings-panel.tsx` and the config types in `apps/api/src/lib/project-helpers.ts` or a types module — locate the ProjectConfig type first). Alert rules are a NEW optional field, distinct from warnThresholds (which drive UI banners): e.g.
  `alertRules?: { metric: 'diskPct' | 'memPct' | 'certDays' | 'backupAgeHours', op: 'gt' | 'lt', threshold: number, enabled: boolean }[]`
  Validate with Zod wherever config is PATCHed (`projects.ts` register/update paths).
- Metric sources during a poll cycle: disk/mem come from the status probe output; cert days from the cert check; backup age from backup status. Read how the monitor currently gathers these — reuse, don't re-probe. If a metric isn't available in the cycle (e.g. no cert), the rule is skipped silently.
- Fired-alert state: persist to a JSONL or small JSON state file (follow the data-dir convention used for `.incidents.jsonl`), recording `{ projectName, metric, threshold, value, firedAt }`. Cooldown: a rule that fired doesn't re-fire until the metric recovers below/above threshold OR a cooldown window passes (default 6h, constant is fine for now).
- Keep the evaluator pure and unit-testable: new module `apps/api/src/lib/alert-rules.ts` exporting `evaluateRules(rules, metrics, previousState) → { fired[], newState }`. The monitor supplies IO; the module does logic. Mirror the testing style of existing lib tests.
- Expose fired alerts read-only: `GET /projects/:name/alerts?days=7` route for sprint 192's UI (simple JSONL tail read, Zod-validated params).

## Tasks
1. Read the status monitor, ProjectConfig type, and config PATCH validation end-to-end.
2. Add `alertRules` to the config type + Zod schemas (register/PATCH paths).
3. Implement `alert-rules.ts` (pure evaluation + cooldown state transitions) with thorough unit tests: fires on breach, no re-fire during cooldown, re-arms on recovery, skips missing metrics, respects `enabled: false`.
4. Wire evaluation into the monitor's poll cycle; persist fired alerts + state.
5. Add `GET /projects/:name/alerts` route + test.
6. Typecheck; run API tests.

## Files involved
- `apps/api/src/lib/alert-rules.ts` (new) + `alert-rules.test.ts` (new)
- status monitor file (`apps/api/src/**/status-monitor.ts`) — wire evaluation into poll cycle
- ProjectConfig type + Zod schemas (`project-helpers.ts` / `projects.ts`)
- new or existing route file for `GET /projects/:name/alerts` (+ test, + registration)

## Acceptance criteria
- [x] `alertRules[]` accepted and validated in project config
- [x] Rules evaluated each poll cycle using already-gathered metrics (no extra SSH)
- [x] Cooldown prevents re-firing; recovery re-arms the rule
- [x] Fired alerts persisted and readable via `GET /projects/:name/alerts`
- [x] Evaluator unit tests cover fire/cooldown/re-arm/missing-metric/disabled; all API tests pass
- [x] Typecheck clean

## Out of scope
- Push delivery of fired alerts, rule-builder UI, cert <30d default rule (sprint 192)
- CPU-sustained rules (needs windowed history — future)

## Completed

**Date:** 2026-07-03

### Summary
Added a full alert rules engine. `alertRules[]` is now a validated optional field in `ProjectConfigSchema` (types package rebuilt). The `alert-rules.ts` pure evaluator handles breach detection, 6-hour cooldown, and recovery re-arming; 11 unit tests cover all behavioral cases. The status monitor's SSH probe was extended to gather disk%, mem%, cert days, and backup age in one call per project per cycle — no extra SSH connections. Fired alerts are persisted to `.alerts.jsonl` and cooldown state to `.alert-state.json` in each project directory. `GET /projects/:name/alerts?days=N` reads and filters the JSONL file; 7 route tests pass. The PATCH config route also accepts `alertRules` for update.

### Files changed
- `packages/types/src/project-config.ts` — added `AlertRuleItemSchema` + `alertRules` field to `ProjectConfigSchema`
- `packages/types/dist/` — rebuilt to include new types
- (new) `apps/api/src/lib/alert-rules.ts` — pure evaluator: `AlertRuleSchema`, `AlertMetrics`, `FiredAlert`, `evaluateRules`
- (new) `apps/api/src/lib/alert-rules.test.ts` — 11 tests for all evaluation behaviors
- `apps/api/src/lib/status-monitor.ts` — replaced `sshProbe` with `probeProject` (gathers metrics); added `readAlertState`, `persistAlerts`; wires evaluation into poll cycle
- `apps/api/src/routes/projects.ts` — added `alertRules` to `PatchConfigBody`
- (new) `apps/api/src/routes/alerts.ts` — `GET /projects/:name/alerts` route
- (new) `apps/api/src/routes/alerts.test.ts` — 7 route tests
- `apps/api/src/index.ts` — registered `alertsRoutes`

### Verification
- `npx nx run api:typecheck`: clean
- `npx nx run api:test`: 173/173 pass

### Follow-ups
- `[defer]` `backupAgeHours` metric uses `grep -o '"lastRun":"[^"]*"'` to extract the value from the backup-status.json on the remote server — if the format changes or the key name changes, the metric silently becomes unavailable (rule skipped). Consider making this more robust if backup format changes.
- `[defer]` Alert state and JSONL files are written per-project but never pruned — add a cleanup pass (trim `.alerts.jsonl` to last 90 days) in a future maintenance sprint.
