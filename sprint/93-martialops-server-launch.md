# Sprint 93 — martialops server provision + first deploy

> _Promoted from sprint-89 follow-up + sprint-88/61 backlog items, 2026-06-27._
> _This item may benefit from `/plan-sprint martialops-launch` to expand into a multi-sprint sequence._

**Difficulty:** 4

## Goal

Get martialops fully live: provision a new Hetzner server, run the first API deploy, update `.emit-infra.json`, commit the staged `/healthz` route, and point DNS at the new server IP.

## Context

### Current state (from sprint 89 investigation)

- **No Hetzner server exists** for martialops. `hcloud server list` shows only: emit-vision-prod, diner-decider, tastease, develemail. There is no martialops server.
- The martialops nginx vhost currently lives on the tastease server (`178.104.195.59`) pointing to `proxy_pass http://127.0.0.1:4000` — but no martialops API container has ever been deployed there.
- `.emit-infra.json` has `"serverIp": "178.104.195.59"` (tastease's IP) — wrong; needs updating after new server is provisioned.
- `~/projects/martialops/terraform/` — terraform config exists to provision a cx23 in nbg1. The server doesn't exist in state, so `terraform apply` will create a new one. **This costs money (~€6/month) — user must confirm before running.**
- `~/projects/martialops/` — has a `docker-compose.prod.yml` and `scripts/deploy.sh` for CI/CD deploys, but no image has ever been pushed.

### Staged but uncommitted work

- Sprint 61 left a `/healthz` route staged in `apps/api/src/routes/health.ts` (martialops repo). Committing requires postgres running locally (pre-commit hook runs e2e tests).
- `docker/nginx/martialops.conf` may also have staged changes — same commit-blocker.

### DNS situation

- `api.martialops.app` — currently pointing to tastease server (178.104.195.59) via Cloudflare. This will need updating to the new server IP.
- `www.martialops.app` + `martialops.app` (apex) — still pointing to old decommissioned server `178.156.218.94`. These need updating regardless.

### Terraform

- Dir: `~/projects/martialops/terraform/`
- Expected resource: `hcloud_server.main` (check `main.tf` to confirm)
- Server type: cx23, region: nbg1 (check terraform config)

## Tasks

### 0. Pre-flight (user confirmation required)
Confirm with the user that it's OK to provision a new Hetzner cx23 (~€6/mo) before running `terraform apply`.

### 1. Provision the server
```bash
cd ~/projects/martialops/terraform
terraform init   # if not already done
terraform plan   # confirm resource creation looks right (no surprises)
terraform apply  # creates new Hetzner server
```
Note the new server IP from terraform output.

### 2. Update .emit-infra.json
Update `serverIp` in `~/projects/martialops/.emit-infra.json` to the new server IP.

### 3. Server setup (via emit-infra provision or manual Ansible)
If `emit-infra provision` handles initial server setup (nginx, certbot, deploy user), run it.
Otherwise, manually:
1. SSH in, install docker + nginx + certbot
2. Copy `docker/nginx/martialops.conf` to nginx sites-enabled
3. Run certbot for `api.martialops.app`
4. Start the martialops docker stack

### 4. First deploy
Run `~/projects/martialops/scripts/deploy.sh` (or CI dispatch from GitHub Actions) to build and push the API image, then pull and start it on the new server.

Verify: `curl -sf https://api.martialops.app/healthz` returns `{ status: "ok", ... }`.

### 5. Commit staged /healthz + nginx config
With postgres running locally:
```bash
cd ~/projects/martialops
# start postgres if needed
pnpm --filter api db:migrate  # or however migrations are run
git add apps/api/src/routes/health.ts docker/nginx/martialops.conf
git commit -m "feat: add /healthz route + nginx config"
```

### 6. Update DNS
In Cloudflare (or wherever DNS is managed):
- Update `api.martialops.app` A record → new server IP
- Update `www.martialops.app` and `martialops.app` (apex) A records → new server IP

## Files involved

- `~/projects/martialops/.emit-infra.json` — update `serverIp`
- `~/projects/martialops/terraform/` — `terraform apply`
- `~/projects/martialops/apps/api/src/routes/health.ts` — commit staged changes
- `~/projects/martialops/docker/nginx/martialops.conf` — commit staged changes

## Acceptance criteria

- [ ] `curl -sf https://api.martialops.app/healthz` returns 200 with `{ status: "ok" }`
- [ ] `~/projects/martialops/.emit-infra.json` has correct `serverIp` for the new server
- [ ] `terraform state list` includes `hcloud_server.main`
- [ ] `/healthz` route and nginx config committed in martialops repo
- [ ] `api.martialops.app`, `www.martialops.app`, and `martialops.app` DNS all point to the new server
