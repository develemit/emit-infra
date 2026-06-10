# Sprint 34 — Blue-Green: Add HTTPS/SSL to upstream-site.conf.j2

> _Promoted from sprint-30 follow-up + sprint-33 blocker, 2026-06-09._

**Difficulty:** 2

## Goal
Add HTTPS/SSL server blocks (with certbot certificate paths) to `upstream-site.conf.j2` so that emit-vision can safely switch from its custom nginx config to the template-managed config without dropping HTTPS.

## Reason
`upstream-site.conf.j2` currently only emits an HTTP (port 80) server block. emit-vision (and any future project using blue-green) uses certbot for HTTPS. The sprint-33 blocker is that the live provisioning test has not been run — but running it against emit-vision production is premature until the template supports HTTPS, because switching to the template would break HTTPS for the site.

## Context
- `upstream-site.conf.j2` lives at `ansible/roles/nginx/templates/upstream-site.conf.j2`
- The current template has two modes: `blue_green` (include-based upstreams) and standard (`active_backend_port`)
- Both modes emit only `listen 80` — no TLS
- emit-vision's actual nginx config on the server uses a custom file (`nginx_custom_config_src`). That custom config has HTTPS blocks that certbot manages.
- certbot (HTTP-01 or DNS-01) modifies nginx configs after initial cert issuance, adding `listen 443 ssl` blocks. When using a template, certbot typically adds these via `certbot --nginx` or the blocks should be pre-populated in the template.
- For blue-green, certbot manages one wildcard cert (`*.emit-vision.com` or similar) — both the main domain and `api.` subdomain share the same cert.
- Ansible's nginx role already has certbot tasks that issue and renew certs. The template just needs to support the SSL redirect and proxy-pass under HTTPS.
- Convention: emit-infra nginx templates let certbot manage SSL additions for standard sites (`certbot --nginx` modifies the template-rendered config in-place). For blue-green, we need the template to emit the cert paths explicitly so the config stays under Ansible control.

## Tasks
1. Read `ansible/roles/nginx/tasks/main.yml` to confirm certbot task order and cert path conventions (`/etc/letsencrypt/live/{{ domain }}/...`).

2. Update `upstream-site.conf.j2` to add HTTPS support:
   - Add an HTTP→HTTPS redirect block (`listen 80 → 301 https://`)
   - Add `listen 443 ssl` server block with cert paths from certbot:
     ```nginx
     ssl_certificate     /etc/letsencrypt/live/{{ domain }}/fullchain.pem;
     ssl_certificate_key /etc/letsencrypt/live/{{ domain }}/privkey.pem;
     ```
   - Keep the `proxy_pass` logic in the HTTPS block (same as the current HTTP block)
   - Gate SSL blocks on `nginx_ssl | default(true)` so local/test environments can opt out
   - Apply the same pattern to the `api.{{ domain }}` block when present

3. Ensure the HTTP-01 certbot task still works: certbot needs `/.well-known/acme-challenge/` reachable over HTTP before the cert is issued. Add a `location /.well-known/acme-challenge/` block in the HTTP redirect server block.

4. Update `ansible/roles/nginx/tasks/main.yml` so the certbot task runs **after** the template is written (template-based provisioning requires the domain server block to exist before certbot can verify it). Verify the task ordering is already correct or fix it.

5. Update the `site.conf.j2` template (non-blue-green) with the same SSL pattern for consistency, if it doesn't already have it.

6. Validate the template renders valid nginx syntax: substitute test values and run `nginx -t` locally using a docker nginx container:
   ```bash
   docker run --rm -v $PWD/test-nginx.conf:/etc/nginx/conf.d/test.conf nginx nginx -t
   ```

## Files involved
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — add HTTP→HTTPS redirect + SSL server blocks
- `ansible/roles/nginx/templates/site.conf.j2` — add same SSL pattern for consistency
- `ansible/roles/nginx/tasks/main.yml` — verify/fix certbot task ordering (template before certbot)

## Acceptance criteria
- [x] `upstream-site.conf.j2` emits HTTP→HTTPS redirect, HTTPS server block with certbot cert paths, and `api.{{ domain }}` HTTPS block when blue_green
- [x] `nginx_ssl: false` var disables SSL blocks for local/test environments
- [x] `location /.well-known/acme-challenge/` in the HTTP block allows certbot HTTP-01 challenge
- [x] `nginx -t` passes on a rendered version of the template (docker nginx test)
- [x] certbot task ordering in `nginx/tasks/main.yml` confirmed: template rendered before certbot runs

## Completed

**Date:** 2026-06-09

### Summary
Updated `upstream-site.conf.j2` to emit full HTTPS support: when `nginx_ssl | default(true)` is true, renders an HTTP→HTTPS redirect block (with `/.well-known/acme-challenge/` passthrough for certbot HTTP-01) and a `listen 443 ssl` block with certbot cert paths from `/etc/letsencrypt/live/{{ domain }}/`. When `nginx_ssl: false`, falls back to the plain HTTP block (for local/test environments without certs). Applied the same pattern to the `api.{{ domain }}` server block (both blue_green and `nginx_api_port` paths).

Updated `site.conf.j2` with the same SSL gating pattern for consistency — both templates now behave identically for the SSL/non-SSL distinction.

Confirmed certbot task ordering in `nginx/tasks/main.yml` is already correct (template write at line 33, certbot tasks at lines 74/87). No ordering fix needed.

### Files changed
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — added HTTP→HTTPS redirect + HTTPS server blocks gated on `nginx_ssl`; same for `api.{{ domain }}` block; 45 → 120 lines
- `ansible/roles/nginx/templates/site.conf.j2` — added same SSL pattern; 17 → 54 lines

### Verification
- `docker run nginx:alpine nginx -t` on rendered template: exit 0
- Certbot task ordering confirmed: template write (line 33) → certbot (line 74/87)
- `nginx_ssl: false` fallback path reviewed: produces valid plain HTTP config
- `/.well-known/acme-challenge/` passthrough present in both HTTP redirect blocks

### Follow-ups
- `[defer]` The `/var/www/certbot` root for ACME challenges needs to exist on the server before certbot runs. Add an Ansible task to create it during provisioning if it's not already there.
- `[defer]` `certbot --nginx` (HTTP-01 path, line 87 in nginx/tasks/main.yml) rewrites the nginx config in-place. After adopting the template, switch to `certbot certonly --webroot` + manual ssl cert path injection so Ansible stays in control of the config file.

## Out of scope
- Actually switching emit-vision's production nginx config to this template (that's a manual ops step after verifying on a test server)
- Wildcard DNS-01 cert config changes — just use the existing certbot tasks
