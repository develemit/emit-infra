# emit-infra — Deployment Pitfalls

Hard-won lessons across emit-infra-provisioned projects. Each entry is a real
failure we hit. See also `docs/emit-vision/DEPLOYMENT-PITFALLS.md` for
emit-vision-specific pitfalls.

---

## 1. Missing `TF_VAR_*` env vars produce a cryptic Terraform error

**Symptom:** `terraform apply` exits with "Invalid provider configuration" or
"No value for required variable". The error buries the actual missing var.

**Cause:** `emit-infra setup` runs Terraform as a subprocess. If
`TF_VAR_hcloud_token`, `TF_VAR_cloudflare_api_token`, or
`TF_VAR_cloudflare_zone_id` aren't exported in the calling shell, Terraform
silently uses empty strings and then fails with misleading messages.

**Fix (in the CLI):** `setup.ts` now checks these three vars before running
Terraform and exits early with a clear error and instructions.

**What to do if you hit this manually:**

```bash
export TF_VAR_hcloud_token="<hetzner api token>"
export TF_VAR_cloudflare_api_token="<cf api token>"
export TF_VAR_cloudflare_zone_id="<zone id for the domain>"
emit-infra setup <project>
```

---

## 2. Wildcard subdomains require DNS-01 certs — HTTP-01 can't issue them

**Symptom:** The provisioned nginx config works for `domain.com` but any
subdomain (`*.domain.com`) returns an SSL error or falls through to nginx's
default server block.

**Cause:** The default certbot task uses `--nginx` (HTTP-01 challenge), which
can only issue certs for explicit hostnames. Wildcard certs (`*.domain.com`)
require the DNS-01 challenge, which verifies ownership via a TXT record.

**Fix:** Set `nginx.wildcardCert: true` in `.emit-infra.json`. The nginx role
now:
1. Installs `python3-certbot-dns-cloudflare`
2. Writes the Cloudflare API token to `/etc/letsencrypt/cloudflare/credentials.ini`
3. Runs `certbot certonly --dns-cloudflare -d domain.com -d *.domain.com`

The Cloudflare API token used for Terraform (`TF_VAR_cloudflare_api_token`) is
reused — no separate token needed.

---

## 3. Multi-service apps need a custom nginx config, not the default template

**Symptom:** After `emit-infra configure`, nginx routes all traffic to port 3000.
The API on port 4000 is unreachable; subdomains all land on the same service.

**Cause:** The default `site.conf.j2` template handles a single-port app at
`domain.com`. It doesn't know about `api.domain.com`, wildcard routing, or
multi-port services.

**Fix:** Set `nginx.customConfigSrc` in `.emit-infra.json` to the relative path
of your project's nginx config (e.g. `docker/nginx/prod.conf`). The nginx role
copies it verbatim instead of rendering the template.

```json
{
  "nginx": {
    "wildcardCert": true,
    "customConfigSrc": "docker/nginx/prod.conf"
  }
}
```

---

## 4. Docker containers must bind ports to `127.0.0.1`, not just the container network

**Symptom:** nginx on the host returns 502. `docker ps` shows `4000/tcp` (no
host binding), not `0.0.0.0:4000->4000/tcp`.

**Cause:** By default, Docker Compose only exposes ports on the container's
internal network. nginx running on the host cannot reach `127.0.0.1:4000`
because the container never bound to the host interface.

**Fix:** In `docker-compose.prod.yml`, bind each service explicitly:

```yaml
api:
  ports:
    - "127.0.0.1:4000:4000"
web:
  ports:
    - "127.0.0.1:3000:3000"
```

`127.0.0.1` prefix prevents the ports from being exposed externally (UFW would
block them anyway, but defence in depth).

---

## 5. Ansible roles that use `notify:` must have a `handlers/main.yml`

**Symptom:** Ansible playbook fails with `The requested handler 'restart sshd'
was not found` (or `reload nginx`).

**Cause:** The `common` and `nginx` roles use `notify:` directives but the
`handlers/` subdirectory was missing entirely.

**Fix:** Both handler files are now present in the repo. If you add a new role
that uses `notify:`, create `ansible/roles/<role>/handlers/main.yml` with the
corresponding handler task.

---

## 6. Each SSH command in CI gets its own session — no shared `cd`

**Symptom:** CI deploy step succeeds; migrations step fails with
`open /home/deploy/docker-compose.prod.yml: no such file or directory`.

**Cause:** Each `ssh` invocation in a GitHub Actions `run:` block starts a
fresh session in the user's home directory. The `cd /app` in the deploy step
does not carry over.

**Fix:** Every separate `ssh` call that needs to run from `/app` must prefix
with `cd /app &&`:

```yaml
- name: Run database migrations
  run: |
    ssh deploy@${{ secrets.SERVER_IP }} "
      cd /app &&
      docker compose -f docker-compose.prod.yml exec -T api \
        pnpm exec prisma migrate deploy --schema apps/api/prisma/schema.prisma
    "
```

---

## 7. `prisma migrate deploy` needs `--schema` in a monorepo container

**Symptom:** `prisma migrate deploy` exits with "Could not find Prisma Schema".

**Cause:** In a monorepo Docker container, the working directory is the repo
root (`/app`). Prisma looks for `prisma/schema.prisma` or `schema.prisma`
relative to cwd. In a monorepo the schema lives at `apps/api/prisma/schema.prisma`.

**Fix:** Always pass `--schema` explicitly:

```bash
pnpm exec prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

---

## 8. Backup script: use configurable `app_dir` and `compose_file`

**Symptom:** The backup cron exits with
`open /opt/<project>/docker-compose.yml: no such file or directory`.

**Cause:** The `db-backup.sh.j2` template previously hardcoded
`APP_DIR="/opt/{{ project_name }}"` and `docker-compose.yml`. The actual app
lives at `/app` and uses `docker-compose.prod.yml`.

**Fix:** Both values are now Jinja variables with sensible defaults:
- `app_dir` defaults to `/app` (driven by `deploy.appDir` in `.emit-infra.json`)
- `compose_file` defaults to `docker-compose.prod.yml`

---

## Debugging checklist for a new emit-infra deployment

1. `TF_VAR_*` set? → Run `echo $TF_VAR_hcloud_token` before `emit-infra setup`
2. Wildcard subdomain? → Set `nginx.wildcardCert: true` + `nginx.customConfigSrc` in config
3. Port 4000/3000 not reachable from host? → Check `docker ps` for `127.0.0.1:PORT` bindings
4. nginx 502? → Confirm host-to-container binding (see #4 above)
5. Ansible `handler not found`? → Verify `ansible/roles/<role>/handlers/main.yml` exists
6. Migrations failing in CI? → Add `cd /app &&` prefix and `--schema` flag (see #6, #7)
