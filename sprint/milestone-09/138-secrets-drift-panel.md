# Sprint 138 — Secrets drift panel

**Difficulty:** 2

## Goal

Add a dashboard panel on the project detail page showing the secrets drift result — three colored buckets (missing, extra, present) — rendered only when `requiredEnvKeys` is configured.

## Reason

Sprint 137 computes the drift; this sprint makes it actionable. The panel gives developers a clear, colored signal: red for missing keys (must fix before deploy), yellow for extra keys (low risk but worth reviewing), green for present keys (expected state).

## Context

- Builds on sprint 137: `GET /projects/:name/secrets-drift` returns `{ status } | { status, missing, extra, present }`.
- Add `getSecretsDrift(name)` to `apps/dashboard/src/lib/api.ts`. The return type is a discriminated union — handle `status: 'unconfigured'` by returning `null` or a sentinel so the panel can conditionally render.
- Component: `apps/dashboard/src/components/detail/secrets-panel.tsx`. Card with title "Secrets" and `lock` icon.
  - If `status === 'unconfigured'`: don't render the panel (guard in page.tsx).
  - If `status === 'ok'` or `'drift'`:
    - Missing keys: each key as a red chip/badge (`var(--err)` background or border)
    - Extra keys: each key as a yellow chip (`var(--warn)`)
    - Present keys: each key as a green chip (`var(--ok)`)
    - Summary line at top: "N missing · N extra · N present"
  - Refresh button.
- Mount in `apps/dashboard/app/projects/[name]/page.tsx` after `BackupPanel`. Guard: only render when `project?.config.requiredEnvKeys != null`.
- Use the same chip/badge styling as the `Badge` component at `apps/dashboard/src/components/ui/badge.tsx` — check its API before building custom chips.

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` (last 20 lines) to confirm fetch pattern.
2. Read `apps/dashboard/src/components/ui/badge.tsx` to understand the Badge component API and variants.
3. Add `getSecretsDrift(name: string)` and `SecretsDrift` type to `apps/dashboard/src/lib/api.ts`.
4. Create `apps/dashboard/src/components/detail/secrets-panel.tsx`.
5. Mount `<SecretsPanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx` guarded by `project?.config.requiredEnvKeys != null`.
6. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add `SecretsDrift` type and `getSecretsDrift`
- new file: `apps/dashboard/src/components/detail/secrets-panel.tsx` — panel component
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] Panel only renders when `project.config.requiredEnvKeys` is set
- [x] Missing keys shown with error color, extra with warn, present with ok
- [x] Summary line ("N missing · N extra · N present") shown at panel top
- [x] Refresh button re-fetches with loading state
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `SecretsDrift` discriminated union type and `getSecretsDrift()` fetch function to `api.ts`. Created `SecretsPanel` component with lock icon, three colored badge sections (missing=red, extra=yellow, present=green using Badge component variants), summary line, and Refresh button with loading state. Mounted after `BackupPanel` in page.tsx, guarded by `project?.config.requiredEnvKeys != null`.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `SecretsDrift` type and `getSecretsDrift`
- (new) `apps/dashboard/src/components/detail/secrets-panel.tsx` — secrets drift panel
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `SecretsPanel`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
- none

## Out of scope

- Editing `requiredEnvKeys` from the dashboard
- Showing key values
- Auto-sync: writing missing keys to the server
