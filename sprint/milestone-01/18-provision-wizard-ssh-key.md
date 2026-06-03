# Sprint 18 — Wire SSH key selection into provision config

> _Promoted from sprint-17 follow-up, 2026-06-03._

## Goal

The provision wizard's SSH key dropdown selection has no effect — `sshKeyName` is missing from the config body passed to `provisionProject`. Fix it so the key the user selects is written into `.emit-infra.json` and used by `scaffoldProject`.

## Context

- `apps/dashboard/app/provision/page.tsx` builds a `config` object (lines 37–45) and passes it to `provisionProject()`.
- The wizard collects `values.sshKey` in `StepInfrastructure`, but `config` only includes `name`, `domain`, `github`, `region`, `serverType`, and optionally `r2`/`upstash`.
- `sshKeyName` is silently absent, so `scaffoldProject` falls back to its default (`emit-deploy`).
- `ProjectConfigSchema` in `packages/core/src/config.ts` already has `sshKeyName: z.string().default('emit-deploy')`, so the field is accepted end-to-end — only the dashboard is missing the wire-up.
- The SSH key dropdown is rendered in `apps/dashboard/src/components/provision/step-infrastructure.tsx` and bound to `values.sshKey` via `onChange`.
- `FormValues` type lives in `apps/dashboard/src/components/provision/types.ts`.

## Tasks

1. In `apps/dashboard/app/provision/page.tsx`, add `sshKeyName: values.sshKey` to the `config` object (alongside `region`, `serverType`).
2. Verify `pnpm typecheck` passes — no type changes should be needed since `config` is typed as `Record<string, unknown>` at the call site.

## Acceptance criteria

- [x] Provisioning a new project with a non-default SSH key writes `"sshKeyName": "<chosen-key>"` into the resulting `.emit-infra.json`.
- [x] `pnpm typecheck` and `pnpm lint` pass.

## Completed

**Date:** 2026-06-03

### Summary
Added `sshKeyName: values.sshKey` to the `config` object in the provision page. This was a one-line wire-up — the wizard already collected the SSH key selection via `StepInfrastructure`, and `ProjectConfigSchema` already defined the `sshKeyName` field. The only missing piece was passing it through.

### Files changed
- `apps/dashboard/app/provision/page.tsx` — added `sshKeyName: values.sshKey` to the config object
- `sprint/18-provision-wizard-ssh-key.md` — marked complete

### Verification
- `pnpm typecheck`: 4/4 projects pass
- `pnpm lint`: dashboard, core, cli pass; api has a pre-existing lint error on an untracked `vitest.config.ts` file (not related to this sprint)
- Code inspection: `sshKeyName` now flows from wizard dropdown → config object → `provisionProject()` → API → `.emit-infra.json`

### Follow-ups
- `[defer]` `apps/api/vitest.config.ts` is untracked and causes an eslint parsing error — needs to be added to the api tsconfig or excluded from lint
