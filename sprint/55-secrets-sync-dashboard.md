# Sprint 55 — Secrets Sync Dashboard UI
**Difficulty:** 3

## Goal
Add a "Sync Secrets" action to the project detail page that pushes `.env.prod` secrets to the GitHub repo via the dashboard — no CLI required.

## Reason
`emit-infra secrets-sync` is one of the most common pre-deploy tasks but requires a terminal. Since the API server runs on the same machine as the project files (with access to `~/projects/<name>/.env.prod` and the `gh` CLI), all the pieces are in place to expose this as a dashboard action. The pattern (spawn a process, stream output) is identical to the existing deploy/prune flows.

## Context

### API: new SSE endpoint

`POST /projects/:name/secrets-sync`

The CLI version (`apps/cli/src/commands/secrets-sync.ts`) does:
1. Resolve env file: `.env.prod` falling back to `.env` in the project dir (`~/projects/<name>/`)
2. Parse `KEY=VALUE` lines, skip comments
3. For each key: `gh secret set KEY --repo org/repo` with the value on stdin

The API endpoint mirrors this exactly, using `execa` (already a dependency — check `apps/api/package.json`) to spawn `gh secret set`.

Stream via SSE: send a `line` event for each secret (`set KEY`) and a final `done` event. If the env file doesn't exist, send an `error` event immediately.

The project's GitHub repo is in `project.config.github.repo` — read via `findProject(name)`.

**Endpoint body (optional):** `{ envFile?: string }` to allow overriding the env file path (default: `.env.prod` → `.env` fallback).

### Dashboard: inline panel

In `apps/dashboard/app/projects/[name]/page.tsx`:
- Add a "Sync Secrets" button to the desktop topbar (after the Logs button, before Deploy). Use a small key or lock icon.
- When clicked, open a `<SecretsSyncPanel>` that streams the output (same Terminal + SSE pattern as DeployPanel).

`apps/dashboard/src/components/secrets-sync-panel.tsx` — simpler than RollbackPanel:
1. On open: immediately POSTs to `/projects/:name/secrets-sync` and streams output
2. No snapshot list — just a terminal with running output
3. Shows close button when done
4. Show a warning if `exitCode !== 0` (e.g. `gh` not installed or not authenticated)

Add `syncSecrets(name: string): { url: string }` to `apps/dashboard/src/lib/api.ts` — just returns the URL for use with the SSE fetch (same pattern as `provisionProject`).

## Tasks
1. Verify `execa` is available in the API: `grep execa apps/api/package.json`.
2. Add `POST /projects/:name/secrets-sync` to `apps/api/src/routes/operations.ts`:
   - Find project with `findProject(name)`
   - Resolve env file path: `~/projects/<name>/.env.prod` → `~/projects/<name>/.env`
   - If not found: SSE error + done
   - Parse env file (copy `parseEnvFile` helper from CLI or inline it)
   - For each `[key, value]`: run `execa('gh', ['secret', 'set', key, '--repo', project.config.github.repo], { input: value })`
   - Write `line` SSE event per key (`"set KEY"`)
   - Write `done` event with exitCode 0 (or 1 on first failure)
3. Add `syncSecrets(name: string)` to `apps/dashboard/src/lib/api.ts` — returns `{ url: string }` pointing to the endpoint.
4. Write `apps/dashboard/src/components/secrets-sync-panel.tsx`. Reuse the `useDeploySse` pattern from `deploy-panel.tsx` (or extract it to a shared hook if that file is touched for sprint 53 — coordinate). Stream output in a Terminal component.
5. Read `apps/dashboard/app/projects/[name]/page.tsx` — add `showSecretsSync` state + "Sync Secrets" button in topbar + `<SecretsSyncPanel>` rendering.
6. Check `ProjectConfig` type in `apps/dashboard/src/lib/api.ts` — confirm `github?: { repo: string }` is available client-side. If not, add it to the interface (the API already returns it in the projects list response).
7. Run `pnpm nx run dashboard:typecheck`.

## Files involved
- `apps/api/src/routes/operations.ts` — new `POST /projects/:name/secrets-sync` SSE endpoint
- `apps/dashboard/src/lib/api.ts` — add `syncSecrets()`, potentially extend `ProjectConfig`
- (new) `apps/dashboard/src/components/secrets-sync-panel.tsx` — SSE terminal panel
- `apps/dashboard/app/projects/[name]/page.tsx` — Sync Secrets button + panel state

## Acceptance criteria
- [x] `POST /projects/:name/secrets-sync` streams SSE and pushes all secrets from `.env.prod`
- [x] Falls back to `.env` if `.env.prod` doesn't exist; SSE error if neither exists
- [x] "Sync Secrets" button appears on project detail topbar (desktop) and mobile footer
- [x] SecretsSyncPanel opens, streams "set KEY" lines, shows close button on completion
- [x] `pnpm nx run dashboard:typecheck` clean

## Completed

**Date:** 2026-06-13

### Summary
Added `POST /projects/:name/secrets-sync` SSE endpoint to `operations.ts`. It resolves `.env.prod` (falling back to `.env`) in `~/projects/<name>/`, parses key-value pairs with `parseEnvFile` (copied from CLI), and calls `execa('gh', ['secret', 'set', key, '--repo', ...])` for each secret, streaming `line` events. SSE error if no env file found. Added `syncSecrets()` to the dashboard API lib and `github?: { repo: string }` to the `ProjectConfig` interface. Created `secrets-sync-panel.tsx` that immediately starts streaming on mount (no UI before running — just a terminal). Shows a warning if `exitCode !== 0` pointing to `gh` not being installed/authenticated. Added "Sync Secrets" button to desktop topbar and mobile footer ("Secrets" label for space) in the project detail page.

### Files changed
- `apps/api/src/routes/operations.ts` — `POST /projects/:name/secrets-sync` SSE endpoint, `parseEnvFile` helper, `execa`/`readFile`/`existsSync` imports
- `apps/dashboard/src/lib/api.ts` — added `syncSecrets()`, added `github?` to `ProjectConfig`
- (new) `apps/dashboard/src/components/secrets-sync-panel.tsx` — SSE terminal panel with failure warning
- `apps/dashboard/app/projects/[name]/page.tsx` — Sync Secrets button + `showSecretsSync` state + `<SecretsSyncPanel>`

### Verification
- `pnpm nx run dashboard:typecheck`: clean

### Follow-ups
- `[defer]` `operations.ts` is now ~380 lines — candidate for splitting into sub-files (rollback, secrets-sync, provision/destroy) when next endpoint is added

## Out of scope
- Secret preview / listing before sync (just sync directly — it's non-destructive to review)
- Per-secret selection (sync all or nothing)
- Creating/editing secrets from the dashboard (sync only, from existing env file)
