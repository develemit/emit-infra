# Sprint 15 — Deploy-Readiness Nginx Checks

**Difficulty:** 3

## Goal

Add nginx and reverse-proxy validation to the deploy-readiness-check skill
so misconfigurations (missing site config, wrong upstream port, expired SSL)
are caught before first deploy or during quarterly audits.

## Reason

The deploy-readiness-check skill audits everything from env vars to security
headers, but has zero awareness of the nginx reverse proxy that sits in front
of every app. The martialops 502 incident (port mismatch) and the emit-vision
nginx issue both would have been caught by a simple "does the upstream port
match the app's configured port?" check. This is the most common class of
deploy failure and should be a `[blocker]` finding.

## Context

- The deploy-readiness-check skill lives at
  `~/.claude/commands/deploy-readiness-check.md`. It's a read-only audit
  skill organized into Steps 1-9. Step 3 covers "Pending setup (env vars
  + infra)." The nginx checks should be added to the Infra subsection of
  Step 3.
- The skill already detects hosting target via marker files (Dockerfile,
  vercel.json, etc.) — Dockerfile presence indicates Docker/self-hosted,
  which is the case for all emit-infra projects.
- Sprint 14 adds `nginxStatus`, `nginxConfigured`, and `sslExpiry` to the
  dashboard status endpoint — but the deploy-readiness skill runs locally
  against a project repo, not via the dashboard API. It should SSH directly
  (or instruct the user to run checks) rather than depending on the API.
- `.emit-infra.json` config has: `name`, `domain`, `serverIp`, `sshKeyName`,
  `deploy.appDir`, `deploy.composeDest`. The skill can use `loadConfig` or
  read the JSON directly.
- Nginx site configs are at `/etc/nginx/sites-enabled/<project_name>` on the
  server. They contain `proxy_pass http://...:<port>` directives.
- The app's port is typically in the compose file or `.env` file.
- The skill uses `@emit-infra/core`'s `sshExec` for remote commands (same
  as the CLI and API).

## Tasks

1. In `~/.claude/commands/deploy-readiness-check.md`, add a new subsection
   under Step 3 — Infra, titled "### Reverse Proxy (nginx)". Add it after
   the existing infra checks. The subsection should instruct Claude to:
   - Check if the project uses self-hosted Docker (Dockerfile or
     docker-compose present) — if not, skip this section entirely
   - If `.emit-infra.json` exists, read `serverIp` / `domain` / `sshKeyName`
     to SSH and run checks. If it doesn't exist, note that nginx checks
     require a configured project and skip with `[recommended]`.
   - **Check 1: Nginx running** — `systemctl is-active nginx`. Not running →
     `[blocker]`.
   - **Check 2: Site config exists** —
     `test -f /etc/nginx/sites-enabled/<project_name>`. Missing →
     `[blocker]` ("no nginx site config for this project").
   - **Check 3: SSL certificate valid** — read cert expiry via
     `openssl x509 -enddate -noout -in /etc/letsencrypt/live/<domain>/fullchain.pem`.
     Missing or expired → `[blocker]`. Expiring within 14 days →
     `[recommended]`. Valid → `[✓ pass]`.
   - **Check 4: Upstream port match** — parse the nginx site config for
     `proxy_pass` directive, extract the port. Compare against the app's
     port from the compose file (`docker compose config --format json` to
     get the first service's port mapping). Mismatch → `[blocker]` with
     both ports shown. Match → `[✓ pass]`.
   - **Check 5: Nginx config syntax** — `nginx -t 2>&1`. Errors →
     `[blocker]`. Clean → `[✓ pass]`.
2. Add corresponding check IDs to the `status.json` guidance in Step 8:
   `nginx-running`, `nginx-site-config`, `ssl-certificate`,
   `nginx-port-match`, `nginx-syntax`.
3. Keep the skill file well-organized — the new section should follow the
   existing patterns (severity tags, file:line references, specific
   actionable findings).

## Files involved

- `~/.claude/commands/deploy-readiness-check.md` — add reverse proxy checks

## Acceptance criteria

- [x] Skill checks nginx service status and flags if not running
- [x] Skill checks site config existence for the project
- [x] Skill checks SSL cert validity and expiry
- [x] Skill checks upstream port matches the app's configured port
- [x] Skill checks nginx config syntax via `nginx -t`
- [x] New check IDs added to status.json guidance
- [x] Skill file remains well-structured and follows existing patterns

## Out of scope

- Automated fixing of nginx issues (the skill is read-only by design)
- Checking nginx config content beyond the upstream port
  (rate limiting, headers, etc.)
- Nginx checks for non-Docker projects (Vercel, Fly, etc. handle their
  own reverse proxy)

## Completed

**Date:** 2026-06-05

### Summary
Added a "Reverse Proxy (nginx)" subsection to Step 3 — Infra of the deploy-readiness-check
skill. The section includes five checks: nginx service status (`systemctl is-active`), site
config existence, SSL certificate validity/expiry, upstream port match (comparing nginx
`proxy_pass` port against the app's compose port), and nginx config syntax (`nginx -t`). Each
check uses severity tags consistent with the existing skill format — `[blocker]` for service
down / missing config / port mismatch / syntax errors, `[recommended]` for certs expiring
within 14 days. The section skips entirely for non-Docker projects and gracefully handles
missing `.emit-infra.json`. Also added five new check IDs (`nginx-running`, `nginx-site-config`,
`ssl-certificate`, `nginx-port-match`, `nginx-syntax`) to the status.json guidance in Step 8.

### Files changed
- `~/.claude/commands/deploy-readiness-check.md` — added "Reverse Proxy (nginx)" subsection under Step 3 Infra, added nginx check IDs to Step 8 status.json entry list

### Verification
- Manual review: section follows existing patterns (severity tags, actionable findings, skip conditions)
- Check IDs present in status.json guidance line

### Follow-ups
none
