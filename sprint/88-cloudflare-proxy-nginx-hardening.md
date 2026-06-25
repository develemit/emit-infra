# Cloudflare proxy activation + nginx real-IP hardening
**Difficulty:** 3

## Goal
Enable Cloudflare proxy mode (orange cloud) on the four projects not yet proxied — tastease,
develemail, diner-decider, martialops — and update each project's nginx config to trust
Cloudflare IP ranges and read the real user IP from the `CF-Connecting-IP` header.
Also add static asset cache headers so Cloudflare caches JS/CSS/images at the edge.

## Reason
Emit-vision is already behind Cloudflare (Origin Certificate + proxied). The other four
projects have DNS managed in Cloudflare but the proxy (orange cloud) is not enabled, so
they get no CDN caching, no DDoS protection, and no bandwidth offload. Enabling proxy +
hardening nginx is the single highest-leverage infrastructure change before any marketing
push — it effectively multiplies capacity 5–10× with zero cost increase and protects
origin servers from direct traffic.

## Context

### Current state
- emit-vision: ✅ fully proxied, Origin Certificate in place, correct nginx headers
- tastease: nginx uses certbot certs, `$remote_addr` for X-Real-IP (will be wrong when proxied)
- develemail, diner-decider, martialops: same pattern as tastease (assumed based on configs)

### Cloudflare proxy mechanics
When proxy mode is enabled, all traffic flows:
```
User → Cloudflare edge (DDoS/WAF/cache) → your nginx
```
nginx sees a Cloudflare IP in `$remote_addr`, not the real user IP. To recover the real IP:
1. Tell nginx to trust Cloudflare's IP ranges via `set_real_ip_from`
2. Set `real_ip_header CF-Connecting-IP` so nginx replaces `$remote_addr` with the header value
3. Then `$remote_addr` in all downstream logs and rate-limit rules reflects the real user IP

### SSL mode
- These projects use certbot (Let's Encrypt) certs. With Cloudflare proxy active, Cloudflare
  terminates TLS at the edge. The Cloudflare → origin connection can use either:
  - **Full**: origin has any valid (or self-signed) cert. Keeps certbot working, no changes needed.
  - **Full (strict)**: origin has a CA-valid cert. Certbot certs qualify. Set this mode.
  - **Flexible**: Cloudflare to origin is plain HTTP — do NOT use this.
- Set SSL mode to "Full (strict)" in Cloudflare dashboard per domain. This is a manual click.
- Alternatively: swap to Cloudflare Origin Certificate (15-year, free, no renewal). This is
  what emit-vision uses and is cleaner long-term. Only do this if sprint scope allows.

### Cloudflare IP ranges
Always fetch the current list from https://www.cloudflare.com/ips-v4 and https://www.cloudflare.com/ips-v6
These are the ranges as of 2026:

IPv4:
```
103.21.244.0/22, 103.22.200.0/22, 103.31.4.0/22
104.16.0.0/13, 104.24.0.0/14
108.162.192.0/18, 131.0.72.0/22, 141.101.64.0/18
162.158.0.0/15, 172.64.0.0/13, 173.245.48.0/20
188.114.96.0/20, 190.93.240.0/20, 197.234.240.0/22, 198.41.128.0/17
```

IPv6:
```
2400:cb00::/32, 2405:8100::/32, 2405:b500::/32
2606:4700::/32, 2803:f800::/32, 2a06:98c0::/29, 2c0f:f248::/32
```

### Static asset caching
Next.js serves `/_next/static/` files with content-hash filenames — they are immutable and
safe to cache forever. Add to nginx server blocks:
```nginx
location /_next/static/ {
    add_header Cache-Control "public, max-age=31536000, immutable";
    proxy_pass ...;
}
```
Cloudflare respects `Cache-Control: immutable` and caches these at the edge permanently
(until a new deploy changes the hash). Dramatically reduces origin hits for returning users.

### Terraform / Cloudflare API
Cloudflare DNS records are provisioned via Terraform (`cloudflare-dns` module). To enable
proxy mode: in the relevant Terraform config, set `proxied = true` on each A record.
Then run `terraform apply`. This is the preferred approach over clicking in the dashboard
so the state stays in Terraform.
Read the existing Terraform configs before editing to understand the current `proxied` setting.

## Tasks

### 1. Verify current proxy status
SSH into each server and check if requests arrive from Cloudflare IPs or real IPs:
```bash
tail -20 /var/log/nginx/access.log | awk '{print $1}'
```
Compare against Cloudflare IP ranges. This tells you which projects are already proxied.

### 2. Update nginx configs — add CF-Connecting-IP + real_ip block
For each project NOT yet proxied (and for correctness, for all projects):

Add this block near the top of each nginx config (inside `http {}` context or at the top of
the server-level include):
```nginx
# Trust Cloudflare proxy IPs — restore real visitor IP
set_real_ip_from 103.21.244.0/22;
set_real_ip_from 103.22.200.0/22;
set_real_ip_from 103.31.4.0/22;
set_real_ip_from 104.16.0.0/13;
set_real_ip_from 104.24.0.0/14;
set_real_ip_from 108.162.192.0/18;
set_real_ip_from 131.0.72.0/22;
set_real_ip_from 141.101.64.0/18;
set_real_ip_from 162.158.0.0/15;
set_real_ip_from 172.64.0.0/13;
set_real_ip_from 173.245.48.0/20;
set_real_ip_from 188.114.96.0/20;
set_real_ip_from 190.93.240.0/20;
set_real_ip_from 197.234.240.0/22;
set_real_ip_from 198.41.128.0/17;
set_real_ip_from 2400:cb00::/32;
set_real_ip_from 2405:8100::/32;
set_real_ip_from 2405:b500::/32;
set_real_ip_from 2606:4700::/32;
set_real_ip_from 2803:f800::/32;
set_real_ip_from 2a06:98c0::/29;
set_real_ip_from 2c0f:f248::/32;
real_ip_header CF-Connecting-IP;
```

Note: `set_real_ip_from` directives must be in an `http {}` block or server block where
`ngx_http_realip_module` is available. On Ubuntu nginx packages this module is compiled in.

### 3. Add /_next/static/ cache block to each nginx config
For each Next.js app server block, add before the catch-all location:
```nginx
location /_next/static/ {
    proxy_pass http://<upstream>;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    add_header Cache-Control "public, max-age=31536000, immutable";
}
```

### 4. Enable Cloudflare proxy via Terraform
Read the Terraform cloudflare-dns module config for each project. Find the A record
resources and set `proxied = true`. Check if a `proxied` variable already exists.
Run `terraform plan` to preview, then `terraform apply`.

Projects to proxy:
- tastease (tastease.app, www.tastease.app, app.tastease.app)
- develemail (develemail.com and subdomains)
- diner-decider (dinerdecider.app and subdomains)
- martialops (martialops.app and subdomains)

### 5. Set SSL mode in Cloudflare dashboard (manual)
For each domain now being proxied, go to Cloudflare dashboard → SSL/TLS → set to
**Full (strict)**. This ensures Cloudflare validates the origin cert (certbot certs are valid).
Do NOT leave it at Flexible — that would strip HTTPS on the Cloudflare → origin connection.

### 6. Deploy nginx changes
For each project, copy the updated nginx config to the server and reload nginx:
```bash
scp -i ~/.ssh/<key> docker/nginx/prod.conf root@<host>:/etc/nginx/sites-available/<project>.conf
ssh -i ~/.ssh/<key> root@<host> "nginx -t && systemctl reload nginx"
```

### 7. Verify
After proxy is enabled and nginx is reloaded:
```bash
# Real IP should now appear in nginx logs, not Cloudflare IPs
ssh root@<host> "tail -5 /var/log/nginx/access.log"

# CF-Connecting-IP header should be set
curl -I https://tastease.app | grep -i cf-ray
# CF-Ray header in response confirms traffic went through Cloudflare
```

## Files involved
- `~/projects/tastease/docker/nginx/prod.conf` — add real_ip block + cache location
- `~/projects/develemail/infra/nginx/prod.conf` — same
- `~/projects/diner-decider/infra/nginx/` — same (read to confirm path)
- `~/projects/martialops/docker/nginx/martialops.conf` — same
- Terraform cloudflare-dns configs for each project — set `proxied = true`

## Acceptance criteria
- [x] nginx `nginx -t` passes on all four servers after config update
- [x] `curl -I https://tastease.app` returns a `CF-Ray:` response header (confirms Cloudflare proxy active)
- [x] Same verification for develemail, diner-decider, api.martialops.app
- [x] `/_next/static/` cache location present in each nginx config
- [x] SSL mode is "Full (strict)" in Cloudflare dashboard for each domain
- [x] No SSL handshake failures after enabling proxy

## Manual steps required (cannot be automated)
- Setting SSL mode to "Full (strict)" in Cloudflare dashboard per domain
- Verifying Cloudflare Account → Zones → SSL/TLS settings

## Progress (2026-06-22)

### Done so far
- Added Cloudflare `set_real_ip_from` + `real_ip_header CF-Connecting-IP` block to all 5 project nginx configs (tastease, develemail, martialops, diner-decider, emit-vision)
- Added `/_next/static/` cache location with `Cache-Control: immutable` to tastease (both marketing + app server blocks), develemail, diner-decider, and martialops (also added header to existing `/_app/_next/` block + new `/_next/static/` for marketing site)
- Created `infra/nginx/prod.conf` for diner-decider (didn't have an nginx config in repo — was inline in `blue-green-deploy.sh` bootstrap). Updated bootstrap to `cp` from the file. Added SCP step to `deploy.sh`.
- Set `proxied = true` on all Terraform DNS modules: tastease, develemail, diner-decider, martialops
- Added `cloudflare_record.api_subdomain` for `api.martialops.app` (proxied) and changed `create_www = true` for martialops www record
- Also set `proxied = true` on tastease's standalone `cloudflare_record.app_subdomain`
- `bash -n` passes on all modified shell scripts
- emit-vision already proxied — got real_ip block only (no static cache, as it's out of sprint scope)

### Completed (2026-06-22)
- nginx configs deployed to all servers, `nginx -t` passed, nginx reloaded on all
- SSL mode set to Full (strict) in Cloudflare dashboard for all four domains (manual)
- Terraform applied for tastease ✓, diner-decider ✓
- develemail: tfvars was missing `cloudflare_zone_id` — `TF_VAR_cloudflare_zone_id` env pointed at diner-decider zone. Fixed by writing `terraform.tfvars` with the correct zone ID (`9eb6f1980d070254da1944da7b163e9b`), destroyed the wrong records, re-applied. Records now correct in develemail.com zone.
- martialops: terraform state was empty (server never in state) — running apply would have provisioned a new Hetzner server. Proxy enabled directly via Cloudflare API for `api.martialops.app`. Cert issued via certbot DNS-01 challenge (cloudflare plugin) for `api.martialops.app`. nginx vhost enabled and reloaded.
- CF-Ray headers confirmed on all 7 endpoints: tastease.app, app.tastease.app, develemail.com, www.develemail.com, dinerdecider.com, www.dinerdecider.com, api.martialops.app

### Remaining / follow-up
- `api.martialops.app` returns 502 — martialops API container not running on 178.104.195.59. Nginx and Cloudflare proxy are correct; this is a deployment issue for a future sprint.
- martialops www/apex DNS still points to old server `178.156.218.94` — those vhosts are excluded from this sprint.
- martialops terraform state is empty — needs `terraform import` of existing server before it can be managed via IaC.
- develemail terraform.tfvars created locally (not committed) — commit with the rest of the config changes.

### Deployment runbook

**Order matters: deploy nginx first, then enable proxy. Otherwise nginx logs Cloudflare IPs until the real_ip block is active.**

#### Step 1 — Deploy nginx configs to servers

```bash
# tastease
scp -i ~/.ssh/emit-deploy ~/projects/tastease/docker/nginx/prod.conf \
  root@<tastease-ip>:/etc/nginx/sites-available/tastease.conf
ssh -i ~/.ssh/emit-deploy root@<tastease-ip> "nginx -t && systemctl reload nginx"

# develemail
scp -i ~/.ssh/emit-deploy ~/projects/develemail/infra/nginx/prod.conf \
  root@<develemail-ip>:/etc/nginx/sites-available/develemail
ssh -i ~/.ssh/emit-deploy root@<develemail-ip> "nginx -t && systemctl reload nginx"

# diner-decider
scp -i ~/.ssh/emit-deploy ~/projects/diner-decider/infra/nginx/prod.conf \
  root@167.233.43.96:/etc/nginx/sites-enabled/diner-decider
ssh -i ~/.ssh/emit-deploy root@167.233.43.96 "nginx -t && systemctl reload nginx"

# martialops
scp -i ~/.ssh/emit-deploy ~/projects/martialops/docker/nginx/martialops.conf \
  root@<martialops-ip>:/etc/nginx/sites-available/martialops.conf
ssh -i ~/.ssh/emit-deploy root@<martialops-ip> "nginx -t && systemctl reload nginx"

# emit-vision (real_ip block only)
scp -i ~/.ssh/emit-deploy ~/projects/emit-vision/infra/nginx/emit-vision.conf \
  root@<emit-vision-ip>:/etc/nginx/sites-available/emit-vision
ssh -i ~/.ssh/emit-deploy root@<emit-vision-ip> "nginx -t && systemctl reload nginx"
```

#### Step 2 — Set SSL mode in Cloudflare dashboard
For each domain (tastease.app, develemail.com, dinerdecider.com, martialops.app):
Cloudflare dashboard → select zone → SSL/TLS → Overview → set to **Full (strict)**

#### Step 3 — Terraform apply (enable proxy)

```bash
# For each project:
cd ~/projects/<project>/terraform
terraform init
terraform plan    # review changes — should only show proxied: false → true
terraform apply

# For martialops: if www/api records already exist manually, import first:
# terraform import cloudflare_record.api_subdomain <zone_id>/<record_id>
```

#### Step 4 — Verify

```bash
# CF-Ray header confirms Cloudflare proxy active
curl -sI https://tastease.app | grep -i cf-ray
curl -sI https://develemail.com | grep -i cf-ray
curl -sI https://dinerdecider.com | grep -i cf-ray
curl -sI https://martialops.app | grep -i cf-ray

# Real IPs in nginx logs (not 104.x.x.x / 172.x.x.x Cloudflare ranges)
ssh root@<ip> "tail -5 /var/log/nginx/access.log | awk '{print \$1}'"

# No SSL errors
curl -sf https://tastease.app > /dev/null && echo "OK"
curl -sf https://app.tastease.app > /dev/null && echo "OK"
curl -sf https://develemail.com > /dev/null && echo "OK"
curl -sf https://dinerdecider.com > /dev/null && echo "OK"
curl -sf https://martialops.app > /dev/null && echo "OK"
curl -sf https://api.martialops.app > /dev/null && echo "OK"
```

### Pickup notes
- All config changes are in the working trees of each project repo (not committed). Commit after successful deployment verification.
- The diner-decider domain is `dinerdecider.com` (not `.app` as the sprint description states).
- martialops `create_www` was changed from `false` to `true` and a new `api_subdomain` record was added. If these DNS records already exist in Cloudflare (created outside Terraform), `terraform import` is needed before apply.

## Out of scope
- Switching from certbot to Origin Certificates for remaining projects (worth doing later but not blocking)
- Cloudflare Page Rules / Cache Rules (paid feature configuration)
- WAF custom rules
- Enabling Cloudflare on emit-vision (already done)
