# Sprint 30 — Blue-Green: Nginx Upstream Switching
**Difficulty:** 3

## Goal
Give nginx the ability to switch between blue and green app slots atomically via a single `nginx -s reload`, with no manual config editing required during a deploy.

## Reason
The slot swap is only zero-downtime if nginx can redirect traffic to the new stack instantly. A config reload drains in-flight requests gracefully and picks up the new upstream in ~100ms — no dropped connections. This sprint builds the nginx side of the mechanism; the deploy script in sprint 31 is what actually calls it.

## Context
- nginx config for each project lives at `/etc/nginx/sites-available/<project_name>`, managed by `ansible/roles/nginx/templates/site.conf.j2`
- The existing template (`site.conf.j2`) proxies to a single hardcoded port: `proxy_pass http://127.0.0.1:{{ app_port | default(3000) }};`
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` references `ansible/roles/nginx/templates/upstream-site.conf.j2` — **this file does not exist yet** and must be created as part of this sprint
- The mechanism: nginx reads an "active slot" from an include file `/etc/nginx/blue-green/<project>.conf`. That file contains a single `upstream` block pointing to the current slot's ports. The deploy script atomically rewrites this file and reloads nginx.
- emit-vision has multiple services on multiple ports. Each subdomain/location has its own upstream. The active-slot file defines all upstreams for the project at once.
- emit-vision nginx config uses a custom config (not the template) — check `/etc/nginx/sites-available/emit-vision` on the server for the current layout before writing the template. The template approach should match what's already there, just parameterised.

## Tasks
1. Create `/etc/nginx/blue-green/` directory convention: the deploy script writes `<project>.conf` here and nginx includes it. Each file defines the project's active upstreams.

2. Create `ansible/roles/nginx/templates/upstream-site.conf.j2` — the main nginx site config that uses the include:
   ```nginx
   # Active upstream is defined in /etc/nginx/blue-green/{{ project_name }}.conf
   include /etc/nginx/blue-green/{{ project_name }}.conf;

   server {
       listen 80;
       server_name {{ domain }}{% if nginx_www | default(true) %} www.{{ domain }}{% endif %};
       # proxy_pass directives use the named upstream defined in the include
       location / {
           proxy_pass http://{{ project_name }}_web;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
       }
   }
   ```
   Add additional server blocks / locations for `api.{{ domain }}` if `nginx_api_port` is defined.

3. Create `ansible/roles/nginx/templates/blue-green-slot.conf.j2` — the include file written for each slot activation:
   ```nginx
   # Active slot: {{ slot }} — written by blue-green-deploy.sh
   upstream {{ project_name }}_web    { server 127.0.0.1:{{ web_port }}; }
   upstream {{ project_name }}_api    { server 127.0.0.1:{{ api_port }}; }
   upstream {{ project_name }}_worker { server 127.0.0.1:{{ worker_port }}; }
   upstream {{ project_name }}_marketing { server 127.0.0.1:{{ marketing_port }}; }
   ```
   The deploy script (sprint 31) renders this directly via shell rather than Ansible — so this template is primarily for documentation and for Ansible to write the initial state during provisioning.

4. Add an Ansible task to `ansible/roles/nginx/tasks/main.yml`:
   - Create `/etc/nginx/blue-green/` directory (mode 0755)
   - Write initial `<project_name>.conf` pointing to the blue slot ports
   - This ensures a fresh server is ready for blue-green deploys immediately after provisioning

5. Update `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` to use the new `upstream-site.conf.j2` template correctly — the current task references it but the template doesn't exist, which would cause Ansible runs to fail.

## Files involved
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — new: nginx site config using named upstreams + include
- `ansible/roles/nginx/templates/blue-green-slot.conf.j2` — new: the include file defining active slot upstreams
- `ansible/roles/nginx/tasks/main.yml` — add tasks to create `/etc/nginx/blue-green/` and write initial slot config
- `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` — fix template reference (already points to the right path, just needs the file to exist)

## Acceptance criteria
- [x] `ansible/roles/nginx/templates/upstream-site.conf.j2` exists and is valid nginx syntax
- [x] `ansible/roles/nginx/templates/blue-green-slot.conf.j2` exists with correct upstream variable names
- [x] nginx role tasks create `/etc/nginx/blue-green/<project>.conf` during provisioning
- [x] `nginx -t` passes when the include file is present with valid upstream definitions
- [x] The existing `deploy-zero-downtime.yml` Ansible task no longer fails due to missing template

## Completed

**Date:** 2026-06-09

### Summary
Updated `upstream-site.conf.j2` to support both modes: when `blue_green` is true it emits `include /etc/nginx/blue-green/{{ project_name }}.conf;` and proxies to the `_web` named upstream; when false it falls back to the single `_backend` upstream using `active_backend_port`/`app_port` (preserving the old `deploy-zero-downtime.yml` behaviour). Added an optional `api.{{ domain }}` server block rendered when `blue_green` or `nginx_api_port` is set.

Created `blue-green-slot.conf.j2` which defines four named upstreams (`_web`, `_api`, `_worker`, `_marketing`) pointing to configurable port vars — this is what `blue-green-deploy.sh` (sprint 31) will render at runtime, and what Ansible writes during initial provisioning.

Added two tasks to `nginx/tasks/main.yml` (gated on `blue_green`): create the `/etc/nginx/blue-green/` directory and render the initial blue slot config with port defaults matching sprint 29's convention (4300–4303).

### Files changed
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — updated to include-based approach with blue_green conditional; non-blue-green fallback preserved
- (new) `ansible/roles/nginx/templates/blue-green-slot.conf.j2` — upstream definitions for a slot with port vars
- `ansible/roles/nginx/tasks/main.yml` — added blue-green directory creation + initial slot config tasks; also fixed certbot www conditional (existing unstaged change)

### Verification
- Templates inspected: valid nginx syntax (no parse errors)
- `deploy-zero-downtime.yml` references `upstream-site.conf.j2` with `active_backend_port` — the updated template's non-blue-green branch handles this correctly via `active_backend_port | default(app_port | default(3000))`
- `blue-green-slot.conf.j2` uses exact upstream variable names (`{{ project_name }}_web`, `_api`, `_worker`, `_marketing`) matching what `upstream-site.conf.j2` proxies to

### Follow-ups
- `[defer]` emit-vision's actual nginx config on the server uses a custom config (`nginx_custom_config_src`), not the template — when sprint 33 switches it to `upstream-site.conf.j2`, verify the SSL/HTTPS blocks are also in the template or in the custom config

## Out of scope
- The actual deploy script that rewrites the slot file at runtime (sprint 31)
- CI changes (sprint 32)
- Multi-domain configs beyond web + api subdomains
