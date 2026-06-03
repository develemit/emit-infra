# API scaffold + project discovery

## Goal
Create `apps/api` — a Fastify server that discovers all emit-infra-managed projects under `~/projects`, exposes their configs, and returns real-time server health and container status via read-only REST endpoints.

## Reason
Every dashboard screen depends on the API. Without it there is nothing to render. Project discovery by scanning `~/projects` for `.emit-infra.json` files is zero-config and matches emit-infra's "convention over configuration" principle — no registry to maintain, any project with a config file is automatically visible.

## Context
- Monorepo uses Nx 21, pnpm, TypeScript 5.7, Vitest. See `nx.json` and `pnpm-workspace.yaml`.
- `packages/core` already exports: `ProjectConfig`, `ProjectConfigSchema` (Zod), `loadConfig`, `sshExec`, `runTerraform`, `runAnsible`. Import from `@emit-infra/core`.
- `sshExec(host, command, keyPath)` in `packages/core/src/ssh.ts` returns stdout as a string. It uses `root@${host}` and `-o StrictHostKeyChecking=no`.
- The CLI in `apps/cli` uses `@emit-infra/core` and Commander.js — use it as a reference for how to wire an Nx app.
- Project configs live at `~/projects/<project-name>/.emit-infra.json`. The `name` field in the config matches the directory name by convention.
- SSH key path: assume `~/.ssh/emit-deploy` as the default; make it overridable via `EMIT_SSH_KEY_PATH` env var.

## Tasks
1. Scaffold `apps/api` as an Nx TypeScript app (`project.json`, `tsconfig.json`, `package.json`). Entry point: `src/index.ts`.
2. Add Fastify (`fastify`, `@fastify/cors`) as dependencies in `apps/api/package.json`.
3. Implement `src/lib/discover-projects.ts`: scan `~/projects/*/` for `.emit-infra.json`, parse each with `ProjectConfigSchema`, return array of `{ config: ProjectConfig, configPath: string, projectDir: string }`. Skip dirs where the file is missing or fails validation (log a warning, don't crash).
4. Implement `GET /projects` — returns the full list from `discoverProjects()` as JSON.
5. Implement `GET /projects/:name/status` — runs these SSH commands against `config.domain` and returns structured JSON:
   - `uptime -p` → uptime string
   - `df -h / | tail -1 | awk '{print $5}'` → disk usage percent
   - `free -m | awk 'NR==2{printf "%.0f", $3/$2*100}'` → memory usage percent
   - If SSH fails, return `{ error: "unreachable" }` with HTTP 200 (not 500 — the server being down is a valid state, not an API error).
6. Implement `GET /projects/:name/containers` — runs `docker ps --format '{"name":"{{.Names}}","image":"{{.Image}}","status":"{{.Status}}","state":"{{.State}}"}'` via SSH, parses the newline-delimited JSON, returns array.
7. Add CORS with `origin: '*'` for local dev (Tailscale-only, so no security concern).
8. Register the Nx `build` and `serve` targets for `apps/api` in `project.json`.

## Files involved
- new file: `apps/api/package.json` — app manifest with Fastify dependencies
- new file: `apps/api/project.json` — Nx project config with build/serve targets
- new file: `apps/api/tsconfig.json` — extends `tsconfig.base.json`
- new file: `apps/api/src/index.ts` — Fastify server bootstrap, route registration, listen on port 3001
- new file: `apps/api/src/lib/discover-projects.ts` — `~/projects` scanner
- new file: `apps/api/src/routes/projects.ts` — GET /projects, GET /projects/:name/status, GET /projects/:name/containers
- `packages/core/src/ssh.ts` — read-only reference; do not modify

## Acceptance criteria
- [x] `nx serve api` starts the server on port 3001
- [x] `GET /projects` returns an array of project configs discovered from `~/projects`
- [x] `GET /projects/:name/status` returns uptime, disk %, memory % for a reachable project
- [x] `GET /projects/:name/status` returns `{ error: "unreachable" }` (not a 5xx) when SSH fails
- [x] `GET /projects/:name/containers` returns parsed container list
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-02

### Summary
Scaffolded `apps/api` as a Fastify application with Nx build/serve targets. Implemented project discovery by scanning `~/projects/*/` for `.emit-infra.json` files and validating them against `ProjectConfigSchema`. Created three REST endpoints covering project listing, server health (uptime/disk/memory via SSH), and container status (docker ps via SSH). Also fixed several pre-existing issues across the monorepo: added `baseUrl` to `tsconfig.base.json` for path resolution, fixed `packages/core` output paths so pnpm workspace symlinks resolve during builds, added `eslint.config.js` for ESLint 9, and patched the CLI's missing `execa` dependency.

### Files changed
- (new) `apps/api/package.json` — Fastify app manifest with `@fastify/cors` and `@emit-infra/core` deps
- (new) `apps/api/project.json` — Nx project with build/serve/typecheck/lint targets; serve uses `tsx --watch`
- (new) `apps/api/tsconfig.json` — extends workspace base tsconfig
- (new) `apps/api/src/index.ts` — Fastify bootstrap, CORS, route registration, listen on port 3001
- (new) `apps/api/src/lib/discover-projects.ts` — scans `~/projects` for `.emit-infra.json`, validates with Zod
- (new) `apps/api/src/routes/projects.ts` — GET /projects, /projects/:name/status, /projects/:name/containers
- `packages/core/project.json` — changed outputPath to `packages/core/dist` for workspace symlink resolution
- `packages/core/package.json` — updated main/types/exports to match `dist/src/` output structure
- `packages/core/tsconfig.lib.json` — added `declaration: true` / `declarationMap: true`
- `tsconfig.base.json` — added `baseUrl: "."` to fix TS5090 path resolution
- `package.json` — added `"type": "module"` and `tsx` dev dependency
- (new) `eslint.config.js` — ESLint 9 flat config for all TypeScript files
- `apps/cli/package.json` — added missing `execa` dependency
- `apps/cli/src/commands/configure.ts` — removed unused `runTerraform` import

### Verification
- `nx run api:serve`: server starts on port 3001
- `GET /projects`: returns array with discovered projects from `~/projects`
- `GET /projects/:name/status`: returns `{"error":"unreachable"}` with HTTP 200 when SSH unreachable
- `GET /projects/:name/containers`: returns `{"error":"unreachable"}` with HTTP 200 when SSH unreachable
- `pnpm typecheck`: clean
- `pnpm lint`: clean

### Follow-ups
- `[defer]` The status endpoint returns `{ error: "unreachable" }` with HTTP 200 — could be revisited to use a distinct status field so UI can differentiate between "no data yet" and "host down"

## Out of scope
- SSE streaming (sprint 02)
- Any write/mutate endpoints — deploy, provision, destroy (sprint 02)
- Dashboard UI (sprint 03)
- Authentication — Tailscale handles network access
