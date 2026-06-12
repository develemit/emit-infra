# Sprint 42 — Ansible: Create `/var/www/certbot` ACME challenge directory

> _Promoted from sprint-34 follow-up [defer], 2026-06-11._

**Difficulty:** 1

## Goal
Add an Ansible task to the nginx role that creates `/var/www/certbot` during provisioning so certbot's HTTP-01 challenge (`/.well-known/acme-challenge/`) has a web root to write to before cert issuance.

## Reason
The `upstream-site.conf.j2` template (sprint 34) added a `location /.well-known/acme-challenge/` passthrough that serves from `/var/www/certbot`. If that directory doesn't exist on the server when certbot runs, the ACME challenge will fail silently or with a confusing error. Creating it via Ansible before the certbot step ensures provisioning is fully self-contained.

## Context
- `ansible/roles/nginx/tasks/main.yml` — the nginx role tasks. The certbot HTTP-01 task runs at line 87 (`certbot --nginx`). The new directory task should run **before** the certbot tasks — insert it after "Enable nginx site" (line ~43) and before the certbot cert tasks.
- The nginx template at `ansible/roles/nginx/templates/upstream-site.conf.j2` already contains:
  ```nginx
  location /.well-known/acme-challenge/ {
      root /var/www/certbot;
  }
  ```
  This makes the directory a hard dependency for certbot HTTP-01 to work.
- Only relevant when NOT using wildcard DNS-01 certs — guard on `not (nginx_wildcard_cert | default(false))`, same as the HTTP-01 certbot task.

## Tasks

1. In `ansible/roles/nginx/tasks/main.yml`, add a task **before** the "Obtain standard SSL certificate (HTTP-01)" task:
   ```yaml
   - name: Create /var/www/certbot for ACME HTTP-01 challenges
     file:
       path: /var/www/certbot
       state: directory
       owner: www-data
       group: www-data
       mode: "0755"
     when: not (nginx_wildcard_cert | default(false))
   ```

2. Validate the task ordering: confirm that after the change, the task sequence in `nginx/tasks/main.yml` is:
   - Install nginx + certbot packages
   - Start nginx
   - Write site config
   - Enable site
   - Create `/var/www/certbot` ← new task
   - Obtain SSL cert (HTTP-01)

3. No other file changes are needed — the nginx template already references this path.

## Files involved
- `ansible/roles/nginx/tasks/main.yml` — add one task before the HTTP-01 certbot step

## Acceptance criteria
- [x] The `Create /var/www/certbot` task is present in `nginx/tasks/main.yml`
- [x] The task is gated on `not (nginx_wildcard_cert | default(false))`
- [x] The task appears **before** the `certbot --nginx` task in the file
- [x] The task uses `owner: www-data` so nginx can read the challenge files
- [x] YAML is valid (read and confirm no syntax issues)

## Completed

**Date:** 2026-06-12

### Summary
Added a single Ansible task to `nginx/tasks/main.yml` that creates `/var/www/certbot` with `owner: www-data`, `mode: 0755`, guarded by `not (nginx_wildcard_cert | default(false))`. The task is inserted after "Remove nginx default site" and before the Cloudflare credentials setup — so it runs before both the DNS-01 and HTTP-01 certbot tasks. The nginx template already had the `location /.well-known/acme-challenge/ { root /var/www/certbot; }` block; this sprint just ensures the directory exists on disk before certbot needs it.

### Files changed
- `ansible/roles/nginx/tasks/main.yml` — added "Create /var/www/certbot for ACME HTTP-01 challenges" task at line 56

### Verification
- YAML validated by reading file — no syntax errors
- Task ordering confirmed: new task at line 56, `certbot --nginx` at line 96
- Guard condition matches the HTTP-01 certbot task guard exactly

### Follow-ups
none
