# Sprint 121 — Switch certbot to certonly --webroot

**Difficulty:** 4

## Goal

Replace `certbot --nginx` (which rewrites the Ansible-deployed nginx config in-place) with `certbot certonly --webroot`, so Ansible stays the sole owner of the nginx config file. Add a pre-SSL bootstrap template so nginx can start on port 80 before the cert exists.

## Reason

`certbot --nginx` works in two phases: it issues the cert AND inserts `ssl_certificate` directives into the nginx config. The second phase overwrites whatever Ansible deployed. On the next `ansible-playbook provision.yml`, Ansible re-deploys its template, wiping certbot's edits — nginx then reloads with Ansible's config (which references cert paths that now exist), which happens to work, but only accidentally. If someone runs provision before certbot has run (fresh server), nginx refuses to start because the cert paths in `ssl_certificate` don't exist yet. The `certonly --webroot` approach never touches nginx — Ansible owns the config file exclusively, and the only coordination needed is ensuring nginx is serving port 80 for the ACME challenge before certbot runs.

## Context

- `ansible/roles/nginx/tasks/main.yml` — the role that currently calls `certbot --nginx` on line 96–106. This is the only file that needs changes.
- `ansible/roles/nginx/templates/site.conf.j2` — the standard (non-blue-green) nginx template. Already has the HTTP server block with `location /.well-known/acme-challenge/` passthrough and `ssl_certificate` directives. Cannot be used before the cert exists (nginx fails to start with a missing cert path).
- `ansible/roles/nginx/templates/upstream-site.conf.j2` — the blue-green template. Same structure.
- `/var/www/certbot` — ACME webroot, already created by a task in the role (line 56–63).
- The wildcard cert path (`certbot certonly --dns-cloudflare`, lines 83–94) is **not affected** — it already uses `certonly` and doesn't touch nginx.
- The renewal cron (`certbot renew --quiet`, lines 133–140) must be updated to add `--deploy-hook "systemctl reload nginx"` so nginx picks up renewed certs. Without this, `certonly` mode doesn't reload nginx after renewal (unlike `--nginx` mode which does it automatically).

### The sequencing problem

On a fresh server, nginx can't start with the SSL config (cert file missing). The fix is a bootstrap nginx config — HTTP only, ACME challenge passthrough, no SSL — that nginx can load before certbot has run. Steps:

1. Write bootstrap HTTP-only config → nginx starts on port 80
2. Run `certbot certonly --webroot` → cert obtained
3. Write real SSL config → nginx reload → HTTPS live

Both step 1 and step 3 use Ansible `template:` tasks. The `creates:` check on step 2 makes the whole sequence idempotent on subsequent runs.

## Tasks

1. Read `ansible/roles/nginx/tasks/main.yml` and both `.conf.j2` templates in full to understand the current task order.

2. Create `ansible/roles/nginx/templates/site-bootstrap.conf.j2` — an HTTP-only config that nginx can load before the cert exists:
   ```nginx
   server {
       listen 80;
       server_name {{ domain }}{% if nginx_www | default(true) %} www.{{ domain }}{% endif %};

       location /.well-known/acme-challenge/ {
           root /var/www/certbot;
       }

       location / {
           return 301 https://$server_name$request_uri;
       }
   }
   ```
   This template is only used during the pre-cert bootstrap phase. It does not need an HTTPS block.

3. In `ansible/roles/nginx/tasks/main.yml`, restructure the HTTP-01 cert section (the `when: not (nginx_wildcard_cert | ...)` block). Replace it with this sequence — insert these tasks **before** the existing "Write nginx site config from template" task, guarded by `when: not (nginx_wildcard_cert | default(false))`:

   a. **Write bootstrap HTTP config** (only when cert doesn't already exist):
   ```yaml
   - name: Write bootstrap HTTP nginx config (pre-cert)
     template:
       src: site-bootstrap.conf.j2
       dest: "/etc/nginx/sites-available/{{ project_name }}"
       owner: root
       group: root
       mode: "0644"
     when:
       - not (nginx_wildcard_cert | default(false))
       - not (nginx_ssl | default(true)) or not ansible_facts['stat_fullchain'] | default(false)
     notify: reload nginx
   ```
   Use `ansible.builtin.stat` to check if `/etc/letsencrypt/live/{{ domain }}/fullchain.pem` exists before deciding whether to write the bootstrap. A cleaner approach: use a `stat` task to register `cert_stat`, then condition on `not cert_stat.stat.exists`.

   b. **Force nginx reload** before certbot (use `meta: flush_handlers` or an explicit `service` task).

   c. **Run certbot certonly --webroot** (replacing the existing `certbot --nginx` task):
   ```yaml
   - name: Obtain SSL certificate (HTTP-01 webroot)
     command: >
       certbot certonly --webroot
       -w /var/www/certbot
       --non-interactive
       --agree-tos
       --email {{ certbot_email }}
       -d {{ domain }}
       {% if nginx_www | default(true) %}-d www.{{ domain }}{% endif %}
     args:
       creates: "/etc/letsencrypt/live/{{ domain }}/fullchain.pem"
     when: not (nginx_wildcard_cert | default(false))
   ```

4. The existing "Write nginx site config from template" task (which writes `site.conf.j2` or `upstream-site.conf.j2` with SSL) should remain **after** the certbot task — certbot now runs first, cert exists, nginx gets the real SSL config. No change to that task needed.

5. Update the renewal cron task to add `--deploy-hook`:
   ```yaml
   - name: Set up certbot auto-renewal
     cron:
       name: certbot-renew
       job: "certbot renew --quiet --deploy-hook 'systemctl reload nginx'"
       hour: "3"
       minute: "30"
       weekday: "1"
   ```

6. Verify the task ordering in the final file makes logical sense:
   - Install nginx + certbot
   - Start nginx
   - Create `/var/www/certbot`
   - Stat the cert file → register `cert_stat`
   - If HTTP-01 and cert missing: write bootstrap config → flush handlers (nginx reloads on 80)
   - Run certbot certonly (idempotent via `creates:`)
   - Write real nginx config (SSL) — always, whether cert was just issued or already existed
   - Reload nginx
   - Set up renewal cron (with deploy-hook)

## Files involved

- `ansible/roles/nginx/tasks/main.yml` — restructure HTTP-01 cert block; update renewal cron
- new file: `ansible/roles/nginx/templates/site-bootstrap.conf.j2` — HTTP-only bootstrap config

## Acceptance criteria

- [x] `site-bootstrap.conf.j2` template exists and contains no `ssl_certificate` directives
- [x] `ansible/roles/nginx/tasks/main.yml` calls `certbot certonly --webroot` (not `certbot --nginx`) for HTTP-01
- [x] The bootstrap template is written and nginx reloaded **before** the certbot task runs
- [x] The certbot task uses `creates:` for idempotency (won't re-issue on subsequent runs)
- [x] The renewal cron includes `--deploy-hook 'systemctl reload nginx'`
- [x] The wildcard cert path (DNS-01 `certbot certonly --dns-cloudflare`) is unchanged
- [x] `ansible-lint ansible/roles/nginx/tasks/main.yml` passes (or no ansible-lint installed — note it)

## Completed

**Date:** 2026-06-29

### Summary
Created `ansible/roles/nginx/templates/site-bootstrap.conf.j2` — an HTTP-only nginx config that lets nginx start on port 80 before the cert exists, serving only the ACME challenge path. Restructured `ansible/roles/nginx/tasks/main.yml` to: move `/var/www/certbot` creation earlier, stat the cert file, conditionally write the bootstrap config, flush handlers (so nginx reloads on port 80), then run `certbot certonly --webroot` (replacing `certbot --nginx`), then write the real SSL config. The wildcard DNS-01 path is unchanged. Renewal cron updated to include `--deploy-hook 'systemctl reload nginx'` so nginx picks up renewed certs automatically.

### Files changed
- (new) `ansible/roles/nginx/templates/site-bootstrap.conf.j2` — HTTP-only pre-cert nginx config for ACME challenge bootstrap
- `ansible/roles/nginx/tasks/main.yml` — restructured HTTP-01 cert block; added stat, bootstrap write, flush_handlers before certbot; replaced `certbot --nginx` with `certbot certonly --webroot`; updated renewal cron with `--deploy-hook`

### Verification
- `site-bootstrap.conf.j2`: no `ssl_certificate` directives (0 occurrences)
- `main.yml`: `certbot certonly --webroot` present, `certbot --nginx` absent
- Bootstrap (line 50) → `flush_handlers` (line 75) → `certonly --webroot` (line 110): correct ordering confirmed
- `creates:` on both certbot tasks: idempotent
- `--deploy-hook 'systemctl reload nginx'` in renewal cron: confirmed
- DNS-01 wildcard path: unchanged
- `ansible-lint`: not installed — skipped

### Follow-ups
- `[defer]` Remove `python3-certbot-nginx` from the apt install list now that `--nginx` mode is no longer used (low risk, purely cleanup)

## Out of scope

- Re-issuing existing certs on live servers (that's an ops step: `certbot delete` then re-provision, or `certbot certonly --webroot` manually)
- Migrating custom nginx configs (those bypass the template entirely)
- Changing cert renewal frequency or adding monitoring of cert expiry
