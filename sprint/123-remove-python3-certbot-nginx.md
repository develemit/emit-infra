# Sprint 123 — Remove python3-certbot-nginx from apt install

> _Promoted from sprint-121 follow-up, 2026-06-29._

**Difficulty:** 1

## Goal

Remove `python3-certbot-nginx` from the nginx role's apt install list now that `certbot --nginx` is no longer used (replaced with `certbot certonly --webroot` in sprint-121).

## Context

`ansible/roles/nginx/tasks/main.yml` installs three packages in its first task:

```yaml
- name: Install nginx and certbot
  apt:
    name:
      - nginx
      - certbot
      - python3-certbot-nginx
```

`python3-certbot-nginx` is the Certbot plugin that enables `certbot --nginx` (auto-edits nginx config). Sprint-121 replaced `certbot --nginx` with `certbot certonly --webroot`, so the plugin is now dead weight. Removing it keeps the package list clean and avoids a dependency that is specifically designed to do something we explicitly don't want (editing nginx configs in-place).

The `certbot` package itself must stay — it's still needed for `certonly` mode.

## Tasks

1. Open `ansible/roles/nginx/tasks/main.yml`.
2. In the first task ("Install nginx and certbot"), remove the `python3-certbot-nginx` line from the `name:` list.
3. Verify no other task in the file references `python3-certbot-nginx`.

## Acceptance criteria

- [ ] `python3-certbot-nginx` is absent from `ansible/roles/nginx/tasks/main.yml`
- [ ] `certbot` and `nginx` are still present in the apt install list
- [ ] No other reference to `python3-certbot-nginx` remains in the file
