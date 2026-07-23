# Add nginx vhost drift detection API route
**Difficulty:** 3

## Goal
A new `GET /projects/:name/nginx-drift` route compares the repo-owned nginx vhost file (`nginx.customConfigSrc`) against the file actually deployed at `/etc/nginx/sites-available/<project>` on the server, and reports whether they match — including a line-level diff when they don't.

## Reason
emit-infra never deploys vhost configs. `ansible/playbooks/deploy.yml` runs only the `app-deploy` and `postgres-backup` roles — the `nginx` role runs exclusively during provisioning. So `nginx.customConfigSrc` is written to the server once at bootstrap and never again. Editing that file in an app repo changes nothing in production, and nothing reveals the gap.

This caused a real incident in emit-vision: every browser-initiated `/v1/*` call on `app.emitvision.com` returned 404 for a long time (email-verification resend, weekly-digest toggle, saved segments, live KPI polling, manual export all silently broken) because the vhost fix that would have routed `/v1` at nginx sat committed in the repo and never reached the box.

**Five of seven managed projects declare `nginx.customConfigSrc`** — emit-vision, develemail, emit-social, tastease, and martialops — so all five have drifted by an unknown amount. This sprint ships **read-only detection first**, deliberately before sprint 232 makes deploys start overwriting these files. We need to see the blast radius before we touch it; otherwise fixing emit-vision silently blows away four other projects' hand-applied server config.

## Context
Model this route closely on the existing secrets-drift route — same shape, same caching, same failure handling:

- `apps/api/src/routes/secrets.ts` (66 lines) — `GET /projects/:name/secrets-drift`. Copy its structure: zod name param validation, `findProject()` → 404, `createTtlCache` for results, `sshExec` in a try/catch, `503 { error: 'unreachable' }` on SSH failure with `null` cached to avoid hammering a down box.
- `apps/api/src/lib/project-helpers.ts` — `findProject(name)` returns a `DiscoveredProject | null`; `sshKeyPath(sshKeyName)` builds the key path.
- `apps/api/src/lib/discover-projects.ts` — `DiscoveredProject` is `{ config, configPath, projectDir }`. Use `projectDir` to resolve the local vhost path; do **not** rebuild it from `homedir()`.
- `apps/api/src/lib/ttl-cache.ts` — `createTtlCache<T>(ms)` exposes `get` / `set` / `invalidate`.
- Host selection convention: `config.serverIp ?? config.domain`.
- The config field is `config.nginx?.customConfigSrc` (optional string, relative to the project dir) — see `packages/types/src/project-config.ts:42-47`.
- Server destination is `/etc/nginx/sites-available/{{ project_name }}` — see `ansible/roles/nginx/tasks/main.yml:22-30`.

Keep the diff logic in a **separate pure module** so it's unit-testable without SSH — this repo consistently extracts pure helpers for exactly this reason (see `apps/api/src/lib/weekly-digest.ts`, `alert-rules.ts`).

Note the API app registers routes explicitly in `apps/api/src/index.ts` (see the `await app.register(...)` block around lines 43-70) — the new route must be added there or it won't be reachable.

## Tasks
1. Create `apps/api/src/lib/nginx-diff.ts` exporting two pure functions:
   - `normalizeConfig(raw: string): string[]` — split on newlines, strip trailing whitespace per line, drop trailing blank lines. (Do **not** strip comments or interior blank lines; a comment change is a real change.)
   - `diffConfigLines(local: string[], server: string[], maxLines = 200): string[]` — return unified-style lines (`- ` for server-only, `+ ` for local-only, `  ` for context), truncated to `maxLines` with a final `... (N more lines)` marker when clipped.
2. Create `apps/api/src/routes/nginx-config.ts` exporting `nginxConfigRoutes(app: FastifyInstance)` with `GET /projects/:name/nginx-drift`, returning:
   - `{ status: 'unconfigured' }` when `config.nginx?.customConfigSrc` is absent
   - `{ status: 'missing-local', localPath }` when declared but the local file doesn't exist
   - `{ status: 'ok' | 'drift', localPath, serverPath, localLines, serverLines, diff }` otherwise
   - `503 { error: 'unreachable' }` when SSH fails
3. Read the server file with `sshExec(host, \`cat /etc/nginx/sites-available/${name} 2>/dev/null\`, key)`. Treat empty output as a distinct `status: 'missing-server'` case rather than reporting a huge false drift.
4. Cache results with a 30s TTL, matching `DRIFT_TTL` in `secrets.ts`.
5. Register `nginxConfigRoutes` in `apps/api/src/index.ts` alongside the other route registrations.
6. Write `apps/api/src/lib/nginx-diff.test.ts` covering: identical input → empty diff; trailing-whitespace-only difference → treated as identical; added line; removed line; truncation past `maxLines`.
7. Write `apps/api/src/routes/nginx-config.test.ts` covering: unconfigured project, missing local file, matching configs → `ok`, differing configs → `drift`, SSH failure → 503. Mock `@emit-infra/core`'s `sshExec` and `../lib/project-helpers.js` the way `secrets.test.ts` and `fleet.test.ts` do.
8. Run `npx nx run api:test` and `npx nx run api:typecheck`.

## Files involved
- (new file) `apps/api/src/lib/nginx-diff.ts` — pure normalize + diff helpers
- (new file) `apps/api/src/lib/nginx-diff.test.ts` — unit tests for the helpers
- (new file) `apps/api/src/routes/nginx-config.ts` — the drift route
- (new file) `apps/api/src/routes/nginx-config.test.ts` — route tests
- `apps/api/src/index.ts` — register the new route
- `apps/api/src/routes/secrets.ts` — read-only reference for structure; do not modify

## Acceptance criteria
- [ ] `GET /projects/emit-vision/nginx-drift` returns a `drift` or `ok` status with a readable diff (emit-vision declares `infra/nginx/emit-vision.conf`). **Not met as literally worded — see Completed summary: live emit-vision actually returns `missing-server`, a real finding, not a code defect. The `drift`/`ok` code paths were proven live against other fleet projects instead.**
- [x] A project with no `nginx.customConfigSrc` returns `{ status: 'unconfigured' }`, not an error.
- [x] An unreachable server returns 503 rather than hanging or throwing.
- [x] Diff output is capped and cannot return an unbounded payload.
- [x] Whitespace-only differences do not report as drift.
- [x] `npx nx run api:test` passes and `npx nx run api:typecheck` is clean.

## Completed

**Date:** 2026-07-23

### Summary
Implemented the read-only nginx vhost drift detector exactly as scoped: a pure `normalizeConfig`/`diffConfigLines` module in `nginx-diff.ts`, and a `GET /projects/:name/nginx-drift` route modeled on `secrets.ts` (same zod param validation, `findProject`/`sshKeyPath` helpers, 30s TTL cache, 503-on-unreachable-with-negative-caching).

While verifying live against the real fleet (all 7 managed projects, via SSH with each project's own deploy key), I found and fixed a real bug: the server-read command was `cat ${serverPath} 2>/dev/null`, and `cat` on a missing file exits 1 even with stderr redirected — `execa`/ssh propagated that as a thrown error, so a genuinely missing server file was indistinguishable from a real SSH failure (both surfaced as `503 unreachable`). Fixed by appending `|| true` to the remote command so a missing file cleanly falls through to the `missing-server` status instead of masquerading as unreachable.

Live verification against the real fleet exercised every status the route can produce:
- `develemail` → `ok` (71/71 lines match)
- `emit-social` → `ok` (52/52 lines match)
- `tastease` → `drift`, with a real, readable, capped diff
- `martialops` → `missing-server`
- `emit-vision` → `missing-server` (not `drift`/`ok` as acceptance criterion 1 assumed)
- `diner-decider`, `test-smoke` (no `nginx.customConfigSrc`) → `unconfigured`

The `emit-vision` result is a genuine, valuable finding, not a bug: `ansible/roles/nginx/tasks/main.yml` deploys to `/etc/nginx/sites-available/{{ project_name }}` (no extension), but the server's actual live file (confirmed via `ls -la /etc/nginx/sites-available/` over SSH) is named `emit-vision.conf`, symlinked into `sites-enabled/` under that same `.conf`-suffixed name. That file was hand-placed out-of-band at some point — outside of anything ansible would ever produce — so it sits completely invisible to a route that (correctly, per this sprint's spec) checks the ansible-canonical extensionless path. This is exactly the kind of drift-detection gap sprint 230 exists to surface, one level deeper than expected. Flagged below for whoever picks up sprint 232.

The 503-unreachable path is covered by mocked unit tests (matching the existing `secrets.test.ts` pattern) rather than a live negative test, since deliberately pointing at an unreachable host wasn't worth the SSH timeout cost given the code path is a straight copy of `secrets.ts`'s already-proven try/catch shape.

### Files changed
- (new) `apps/api/src/lib/nginx-diff.ts` — pure `normalizeConfig` + `diffConfigLines` helpers
- (new) `apps/api/src/lib/nginx-diff.test.ts` — 9 unit tests: normalization, identical/added/removed/changed lines, truncation, whitespace-equivalence
- (new) `apps/api/src/routes/nginx-config.ts` — `GET /projects/:name/nginx-drift`
- (new) `apps/api/src/routes/nginx-config.test.ts` — 7 route tests: 404, unconfigured, missing-local, ok, drift, missing-server, 503
- `apps/api/src/index.ts` — registered `nginxConfigRoutes`

### Verification
- `npx nx run api:test`: 317/317 pass (40 test files)
- `npx nx run api:typecheck`: clean
- Live SSH verification against all 7 managed fleet projects (see Summary) — every status branch (`unconfigured`, `ok`, `drift`, `missing-server`, `missing-local` not hit live but covered by unit test, `503` covered by unit test) exercised with real project configs and real SSH keys.

### Follow-ups
- `[blocker]` Before sprint 232 (sync-vhost-on-deploy) starts writing vhost files: emit-vision's live nginx file lives at `/etc/nginx/sites-available/emit-vision.conf` (symlinked into `sites-enabled/` under the same name), not the ansible-canonical `/etc/nginx/sites-available/emit-vision` that `nginx.customConfigSrc` deploys expect. A naive sync would create a second, differently-named file alongside the real one rather than replacing it — sprint 232 needs to reconcile or migrate this naming mismatch first, or it will silently fail to fix emit-vision's actual routing problem.
- `[defer]` martialops also returns `missing-server` — same class of gap as emit-vision, lower urgency since no incident has been reported for it yet.

## Out of scope
- Any dashboard UI — that's sprint 231.
- Changing deploy behavior or writing anything to a server — this sprint is strictly read-only. Sprint 232 owns enforcement.
- Adding an "apply / push vhost now" endpoint.
- Template-based projects that use the generated `upstream-site.conf.j2` rather than `customConfigSrc` — they have no local file to compare and should return `unconfigured`.
