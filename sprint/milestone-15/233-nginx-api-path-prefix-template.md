# Add apiPathPrefix / apiUpstream support to the nginx vhost template
**Difficulty:** 3

## Goal
A project can declare an API path prefix in `.emit-infra.json` and have the generated vhost route that prefix straight to the API upstream at nginx — rather than relying on the web framework to proxy it — with the block correctly placed and correctly formed.

## Reason
The emit-vision incident had two causes. Sprint 232 fixed the delivery problem (vhosts never reaching servers). This sprint fixes the **architectural** one: the app was expected to proxy `/v1/*` onward via a Next.js `rewrites()` rule, and in the deployed standalone container that rewrite silently wasn't applied, so every client-side API call fell through to the App Router's 404 page. A locally built standalone image proxied correctly, so the failure was environmental and was never root-caused.

Framework-level proxying (Next.js rewrites, Vite proxy) works in dev and is unreliable in production containers. Routing API paths at the proxy layer is the correct architecture and removes a whole class of silent failure. Making it a declared config field means projects stop hand-rolling it — and, more importantly, stop hand-rolling it *wrong*: the two gotchas below are easy to get subtly backwards and produce a confusing 404 either way.

Note this serves template-based projects. emit-vision itself has a genuinely custom vhost (4 server blocks across 3 hostnames plus a marketing upstream) that `upstream-site.conf.j2` can't express, so it stays on `customConfigSrc` and is fixed by sprint 232 instead. Both paths are needed.

## Context
**The two gotchas, verified against emit-vision's working config** — encode both in the template so no project has to rediscover them:

1. **`proxy_pass` must have no URI component** — `proxy_pass http://emit-vision_api;` with **no** trailing slash. With a trailing slash nginx strips the matched prefix and every API call breaks.
2. **The prefix block must precede `location /`** — otherwise requests fall through to the web upstream and never reach the API.

The upstream must also already be defined before use. In blue-green projects the upstreams come from the include file written each deploy (`include /etc/nginx/blue-green/{{ project_name }}.conf;` — see `upstream-site.conf.j2:1-8`), which defines `{{ project_name }}_<service>` per service in `blueGreen.services`. So a valid `apiUpstream` for emit-vision would be `emit-vision_api`. Validate that the referenced upstream is plausible rather than emitting a config that fails `nginx -t` on the server.

Relevant files:
- `ansible/roles/nginx/templates/upstream-site.conf.j2` (120 lines) — the blue-green vhost template. Line 33-43 is the main-domain `location /` block that the new block must precede. Lines 65-120 already generate a separate `api.{{ domain }}` server block proxying to `{{ project_name }}_api`, so the upstream naming convention is established.
- `ansible/roles/nginx/templates/site.conf.j2` (54 lines) — the non-blue-green template; add the same support for parity.
- `ansible/roles/nginx/tasks/main.yml:120-128` — picks between the two templates based on `blue_green`.
- `packages/types/src/project-config.ts:42-47` — the `nginx` config object to extend.
- `apps/cli/src/commands/setup.ts:241` and `configure.ts:35` — where nginx config becomes Ansible vars. Both need the new vars passed.

The proxy header set to use is the same one already used throughout both templates (`Host`, `X-Real-IP`, `X-Forwarded-For`, `X-Forwarded-Proto`, `proxy_http_version 1.1`).

## Tasks
1. Add to the `nginx` object in `packages/types/src/project-config.ts`:
   - `apiPathPrefix: z.string().optional()` — e.g. `/v1/`
   - `apiUpstream: z.string().optional()` — e.g. `emit-vision_api`
   Both must be present for the block to render; document that in a comment.
2. Pass them as `nginx_api_path_prefix` and `nginx_api_upstream` from `apps/cli/src/commands/setup.ts` and `apps/cli/src/commands/configure.ts`, matching how `nginx_custom_config_src` is passed there today.
3. In `ansible/roles/nginx/templates/upstream-site.conf.j2`, emit a `location {{ nginx_api_path_prefix }}` block **immediately before** the existing `location /` block in the main-domain server, guarded by `{% if nginx_api_path_prefix is defined and nginx_api_upstream is defined %}`. The `proxy_pass` must be `http://{{ nginx_api_upstream }};` with no trailing slash and no URI path.
4. Apply the same change to `ansible/roles/nginx/templates/site.conf.j2` for non-blue-green projects.
5. Add a Jinja comment above the generated block explaining the no-trailing-slash and ordering constraints, so anyone reading the rendered config on a server understands why it looks the way it does.
6. Add a rendering test that asserts, for a config with both fields set: the block appears before `location /`, the `proxy_pass` line has no trailing slash, and nothing renders when either field is absent. If this repo has no existing Jinja-rendering test harness, assert against the template source text instead of adding a new dependency — keep it simple and note the limitation in the sprint's Completed section.
7. Document the two fields and both gotchas in `ansible/README.md`.
8. Run `npx nx run types:typecheck`, `npx nx run cli:typecheck`, and `npx nx run cli:test`.

## Files involved
- `packages/types/src/project-config.ts` — add `apiPathPrefix` and `apiUpstream`
- `apps/cli/src/commands/setup.ts` — pass the new Ansible vars
- `apps/cli/src/commands/configure.ts` — pass the new Ansible vars
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — render the location block before `location /`
- `ansible/roles/nginx/templates/site.conf.j2` — same for non-blue-green projects
- `ansible/README.md` — document the fields and constraints

## Acceptance criteria
- [x] A config with `apiPathPrefix` + `apiUpstream` renders a location block that precedes `location /` in the main-domain server.
- [x] The rendered `proxy_pass` has no trailing slash and no URI component.
- [x] Omitting either field renders no block and leaves output byte-identical to today.
- [x] Both blue-green and non-blue-green templates support the feature.
- [x] The constraints are documented in `ansible/README.md`.
- [x] `types:typecheck`, `cli:typecheck`, and `cli:test` are clean.

## Completed

**Date:** 2026-07-23

### Summary
Added `apiPathPrefix` / `apiUpstream` as an optional pair on the `nginx` config object, and taught both vhost templates (`upstream-site.conf.j2` for blue-green, `site.conf.j2` for non-blue-green) to render an API-prefix `location` block ahead of `location /` in the main-domain server whenever both fields are present. Both fields must be set together — the guard is a single `{% if nginx_api_path_prefix is defined and nginx_api_upstream is defined %}` so a project can't accidentally ship half-configured routing. The block itself uses `proxy_pass http://{{ nginx_api_upstream }};` with no trailing slash (the sprint's gotcha #1) and is inserted textually before `location /` in every server-block variant that has one — SSL and plain-HTTP fallback, blue-green and non-blue-green (gotcha #2). A Jinja comment above the rendered block explains both constraints in place, on the server, for anyone reading the live config.

`setup.ts` and `configure.ts` now pass `nginx_api_path_prefix` / `nginx_api_upstream` as Ansible vars whenever both config fields are set, mirroring the existing `nginx_custom_config_src` pattern.

No Jinja-rendering test harness exists in this repo (confirmed by search — no jinja2/nunjucks dependency, no prior template test), so per the sprint's fallback instruction the new test (`apps/cli/src/nginx-templates.test.ts`) asserts against the raw `.j2` template source: the guard clause is present, `proxy_pass` has no trailing slash, the API block textually precedes every `location /` occurrence, and the block-count matches the guard-count (so nothing can render outside the guard). Beyond the required unit test, I additionally hand-rendered both templates with real Jinja2 (`trim_blocks=True`, matching Ansible's default template environment) across all four variant combinations — blue-green/non-blue-green × ssl/non-ssl — with and without the two new vars set, and confirmed: (1) output is byte-identical to the pre-sprint template when either field is omitted, and (2) with both fields set, the rendered `location /v1/` block is correctly ordered ahead of the real `location /` block in every variant (the ACME-challenge redirect's own `location /` doesn't interfere since it's in an unrelated `server{}` on port 80).

### Files changed
- `packages/types/src/project-config.ts` — added `apiPathPrefix` / `apiUpstream` optional string fields to the `nginx` schema object
- `apps/cli/src/commands/setup.ts` — pass `nginx_api_path_prefix` / `nginx_api_upstream` Ansible vars when both config fields are set
- `apps/cli/src/commands/configure.ts` — same, for the standalone `configure` command
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — render the guarded API location block before `location /` in both the SSL and plain-HTTP server blocks
- `ansible/roles/nginx/templates/site.conf.j2` — same, for the non-blue-green template
- `ansible/README.md` — added the two vars to the Variable Reference table and a new "API path prefix routing" section documenting both gotchas
- (new) `apps/cli/src/nginx-templates.test.ts` — source-text assertions against both `.j2` templates (guard presence, no-trailing-slash, block ordering, guard/block count parity)

### Verification
- `npx nx run types:typecheck`: clean
- `npx nx run cli:typecheck`: clean
- `npx nx run cli:test`: 78/78 pass (10 test files, including the new template test)
- Manual: rendered all four template variants with real Jinja2 under Ansible-equivalent settings; confirmed byte-identical output when fields omitted and correct block placement/formation when set

### Follow-ups
- `[defer]` This sprint only makes the capability available (per "Out of scope"); no project's `.emit-infra.json` was updated to use it. emit-vision specifically stays on `customConfigSrc` since its vhost is too custom for the template.

## Out of scope
- Migrating emit-vision (or any other project) off `customConfigSrc` onto the template — its vhost is too custom to express this way.
- Applying the new fields to any project's `.emit-infra.json` — this sprint only makes the capability available.
- Multiple API prefixes or per-hostname prefixes; one prefix per project is enough for now.
- Changing deploy-time sync behavior — that's sprint 232.
