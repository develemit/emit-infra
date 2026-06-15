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

## 9. `environment:` key is invalid on reusable workflow jobs — GitHub silently skips the workflow

**Symptom:** The deploy workflow shows as "skipped" or completes in under 2 seconds with no steps executing. No error message is surfaced. CI passes but nothing ever ships.

**Cause:** GitHub Actions does not allow the `environment:` key on a job that calls a reusable workflow via `uses:`. The YAML is syntactically valid so no parse error is shown, but GitHub silently drops the entire workflow definition and treats every run as skipped.

**Fix:** Remove `environment:` from any job that uses `uses:`. If you need environment-level secret scoping, apply it to individual steps or pass secrets explicitly via the `secrets:` block on the `uses:` job.

```yaml
# Wrong — silently breaks the whole workflow
deploy:
  uses: org/repo/.github/workflows/deploy.yml@main
  environment: production   # ← invalid here

# Right
deploy:
  uses: org/repo/.github/workflows/deploy.yml@main
  secrets: inherit
```

**Prevention:** Run `actionlint` in CI. It catches this. Add it to `check-all` so it runs pre-push.

---

## 10. GHCR login must be in the same SSH session as the image pull

**Symptom:** Blue-green deploy fails with `denied: permission_denied` when docker tries to pull the image, even though a `docker login` step ran immediately before.

**Cause:** Each `ssh` invocation starts an independent shell session. `docker login` in one session writes credentials to `/root/.docker/config.json` but the CI runner's environment is not available in the next SSH session. The pull session reads stale or missing credentials.

**Fix:** Pipe the token and run login + pull + deploy in a single SSH command:

```yaml
- name: Blue-green deploy
  env:
    GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: |
    printf '%s\n' "$GHCR_TOKEN" | \
      ssh -i ~/.ssh/deploy_key root@${{ secrets.SERVER_IP }} \
      "docker login ghcr.io -u ${{ github.repository_owner }} --password-stdin \
       && /opt/myapp/blue-green-deploy.sh myapp"
```

---

## 11. Secrets sync from local `.env` overwrites production values with dev defaults

**Symptom:** After syncing secrets to GitHub, the deployed API connects to `localhost:55432` or `redis://localhost:56379` — dev default ports that don't exist on the production server.

**Cause:** The secrets sync was run against the local `.env` file, which contains development defaults. Those values were written to GitHub Secrets, overwriting the previously correct production values.

**Fix:**
- Always sync from `.env.prod` (or a dedicated production secrets file), never from `.env`.
- Keep `.env` strictly for local dev with no production values.
- After any sync, verify with `gh secret list` — check the update timestamps on sensitive secrets and confirm the source was correct.
- Add a guard in sync tooling to reject files containing `localhost` URLs or dev-port patterns (e.g. `:55432`, `:56379`).

---

## 12. Docker Compose network label conflict when the network was pre-created manually

**Symptom:** `docker compose up` fails with `network <name> was found but has incorrect label com.docker.compose.network set to "" (expected: "<name>")`.

**Cause:** An earlier deploy step created the network with `docker network create` (no Compose labels). When a Compose file later tries to "own" that network (without `external: true`), Compose rejects the label mismatch.

**Fix:** Any network shared between multiple Compose stacks must be declared `external: true` in every file that uses it. Create it manually before any `compose up`:

```yaml
# Both infra and app compose files
networks:
  myapp-infra:
    external: true
```

```bash
docker network create myapp-infra 2>/dev/null || true
docker compose -f docker-compose.infra.yml up -d
```

---

## 13. Infra services must be running before the app health check fires

**Symptom:** Blue-green health check returns HTTP 503 immediately and persists for the full retry window. Container logs show `ECONNREFUSED` to the database, Redis, or ClickHouse address.

**Cause:** The deploy workflow started the app (green slot) before the infra stack was up. The app process starts and accepts HTTP, but its `/readyz` endpoint pings all infra dependencies — any one that's down returns 503.

**Fix:** Add an idempotent "Ensure infra services" step that runs before the blue-green deploy step:

```bash
docker network create myapp-infra 2>/dev/null || true
docker compose \
  -f /opt/myapp/docker-compose.infra.yml \
  --env-file /opt/myapp/.env \
  --project-name myapp \
  up -d --remove-orphans
```

If infra is already running, Compose is a no-op. If it just started, the app containers have seconds of extra startup time before the health check begins.

---

## 14. Always pass `--env-file` explicitly to docker compose in deploy scripts

**Symptom:** Docker Compose substitutes `${DATABASE_URL}` and similar vars as empty strings. The container either crashes on startup (required-var validation) or connects to wrong hosts.

**Cause:** Docker Compose auto-discovers `.env` from the project directory (directory of the first `-f` file). This is fragile in deploy scripts where the CWD when the script runs may differ from the compose file's directory.

**Fix:** Always pass `--env-file` explicitly on every `docker compose` call — pull, up, stop, and down:

```bash
docker compose \
  -f /opt/myapp/docker-compose.app.yml \
  -f /opt/myapp/docker-compose.green.yml \
  --env-file /opt/myapp/.env \
  --project-name myapp-green \
  up -d
```

---

## 15. NX Cloud plan expiry exits CI with code 1 — remove `nxCloudId` when not on a paid plan

**Symptom:** CI fails in under 60 seconds with `Your organization can be re-enabled immediately by an organization admin upgrading to the Team plan`. All tasks are skipped.

**Cause:** When the NX Cloud free-tier quota is exhausted or the org plan lapses, the integration returns a hard error rather than falling back gracefully to local caching.

**Fix:** Remove `nxCloudId` from `nx.json` and stop passing `NX_CLOUD_ACCESS_TOKEN` to CI. Nx falls back to local task caching with no functional change:

```json
// nx.json — remove or comment out
"nxCloudId": "6a1e70e8d32a9b685af16560"
```

Re-add when a paid Cloud plan is in place.

---

## 16. Ansible-provisioned nginx config conflicts with deploy-managed config — hardcoded ports cause 502 on slot swap

**Symptom:** After a blue-green deploy succeeds (health checks pass, new slot containers are healthy), all HTTPS traffic returns 502. nginx logs show `conflicting server name "domain.com" on 0.0.0.0:443, ignored` for every domain.

**Cause:** The Ansible nginx role writes to `/etc/nginx/sites-available/<project>` (no `.conf` extension) and enables it via symlink. A deploy script that writes to `sites-available/<project>.conf` and enables that creates two simultaneous configs for the same server names. nginx processes both, warns about conflicts, and **uses the first one alphabetically** — the extensionless Ansible config wins. That config was rendered at provision time with hardcoded blue slot ports (e.g. `proxy_pass http://127.0.0.1:4300`). When green becomes active, HTTPS traffic hits the Ansible config and is proxied to stopped blue containers → 502.

The issue is invisible while blue is active (the hardcoded ports happen to be correct) and only surfaces after the first slot swap.

**Fix:** The deploy script must remove the Ansible-provisioned config before or during each nginx config update:

```bash
# Remove legacy Ansible-provisioned config (hardcoded ports, not blue-green aware)
rm -f /etc/nginx/sites-enabled/<project> /etc/nginx/sites-available/<project>
ln -sf /etc/nginx/sites-available/<project>.conf /etc/nginx/sites-enabled/<project>.conf
nginx -t && nginx -s reload
```

Add this to the "Deploy nginx config" step in `deploy.yml`. The `rm -f` is idempotent — safe to run even after the file is already gone.

**Also:** the deploy-managed config (`<project>.conf`) must handle HTTPS (port 443) itself. If it only has `listen 80` blocks, the Ansible config's 443 blocks were the only thing handling HTTPS — removing it without adding 443 blocks will break SSL. Use named upstreams (from the blue-green slot include file) rather than hardcoded ports.

---

## 17. Blue-green nginx config `include` requires slot file to exist before first reload

**Symptom:** First deploy to a freshly provisioned server fails at the "Deploy nginx config" step with `nginx: [emerg] open() "/etc/nginx/blue-green/<project>.conf" failed (2: No such file or directory)`.

**Cause:** The project's nginx config includes `/etc/nginx/blue-green/<project>.conf` to load named upstreams (e.g. `upstream <project>_web { server 127.0.0.1:4400; }`). This file is written by `blue-green-deploy.sh` on each deploy — but on the very first deploy it doesn't exist yet. nginx refuses to reload with a missing include.

**Fix:** The Ansible `nginx` role already handles this — its final task writes an initial blue-slot config to `/etc/nginx/blue-green/<project>.conf` using `blue-green-slot.conf.j2`. **Run the Ansible playbook before the first deploy.** This is a hard prerequisite for blue-green projects; CI cannot substitute for it.

If you need to bootstrap manually without Ansible:

```bash
mkdir -p /etc/nginx/blue-green
cat > /etc/nginx/blue-green/<project>.conf <<'EOF'
# Bootstrap — blue slot defaults. Overwritten by blue-green-deploy.sh on first deploy.
upstream <project>_web      { server 127.0.0.1:4300; }
upstream <project>_api      { server 127.0.0.1:4301; }
upstream <project>_worker   { server 127.0.0.1:4302; }
upstream <project>_marketing { server 127.0.0.1:4303; }
EOF
```

---

## 18. Google OAuth state dies on API restart or blue-green deploy

**Symptom:** `google_auth_failed` URL after clicking "Continue with Google." Logs show `google_oauth: state not found in store`.

**Cause:** Storing OAuth state (code verifier, nonce, returnTo) in a process-local `Map` means any API restart or blue-green slot swap between `/start` and `/callback` clears it — the callback arrives at a fresh process that has never seen the state.

**Fix:** Store OAuth state in Redis with a TTL:

```typescript
storeOAuthState: async (state, entry) => {
  await redis.set(`oauth:state:${state}`, JSON.stringify(entry), "EX", 600);
},
consumeOAuthState: async (state) => {
  const key = `oauth:state:${state}`;
  const raw = await redis.get(key);
  if (!raw) return null;
  await redis.del(key);
  return JSON.parse(raw);
},
```

Redis is shared across slots and survives restarts. An in-memory fallback is fine for local dev where there's no Redis.

---

## 19. openid-client v5 requires the `iss` parameter forwarded to `client.callback()`

**Symptom:** `google_oauth: token exchange failed` in logs. Error: `RPError: iss missing from the response`.

**Cause:** Google's OAuth callback URL includes an `iss` query parameter (`iss=https%3A%2F%2Faccounts.google.com`) per RFC 9207. openid-client v5 validates this parameter and throws if it's not included in the `callbackParams` object passed to `client.callback()`.

**Fix:** Add `iss` to the Querystring type, destructure it, and forward it:

```typescript
// Querystring type
{ code?: string; state?: string; error?: string; iss?: string }

// In the handler
const { code, state, error, iss } = request.query;

// In client.callback()
const tokenSet = await client.callback(
  callbackUrl,
  { code, state, iss },   // ← iss must be included
  { state, nonce: stored.nonce, code_verifier: stored.codeVerifier },
);
```

---

## 20. OAuth callback cookie must set `Domain` to the parent domain

**Symptom:** Token exchange succeeds (callback returns 302), but every subsequent API call returns 401. The session cookie was never sent.

**Cause:** The OAuth callback runs on `api.<domain>`. Setting a cookie without an explicit `Domain` attribute scopes it to exactly that host. When the browser redirects to `app.<domain>`, the cookie isn't sent — the API returns 401.

**Fix:** Set `Domain` to the shared parent domain when issuing the session cookie:

```typescript
const appHostname = new URL(appUrl).hostname;
const hostParts = appHostname.split(".");
const cookieDomain =
  hostParts.length >= 2 ? hostParts.slice(-2).join(".") : appHostname;

reply.header(
  "Set-Cookie",
  `emit_session=...; Path=/; HttpOnly; Secure; SameSite=Lax; Domain=${cookieDomain}`,
);
```

`app.emitvision.com` → `cookieDomain = emitvision.com`. Both `api.<domain>` and `app.<domain>` can now read and send the cookie.

---

## Debugging checklist for a new emit-infra deployment

1. `TF_VAR_*` set? → Run `echo $TF_VAR_hcloud_token` before `emit-infra setup`
2. Wildcard subdomain? → Set `nginx.wildcardCert: true` + `nginx.customConfigSrc` in config
3. Port 4000/3000 not reachable from host? → Check `docker ps` for `127.0.0.1:PORT` bindings
4. nginx 502? → Confirm host-to-container binding (see #4 above)
5. Ansible `handler not found`? → Verify `ansible/roles/<role>/handlers/main.yml` exists
6. Migrations failing in CI? → Add `cd /app &&` prefix and `--schema` flag (see #6, #7)
7. Deploy workflow silently skipped? → Check for `environment:` on a `uses:` job (see #9)
8. GHCR pull denied in blue-green? → Ensure login + deploy are one SSH command (see #10)
9. API health check 503 on first deploy? → Confirm infra stack is up before app starts (see #13)
10. nginx 502 after first slot swap? → Check for conflicting Ansible-provisioned config (see #16)
11. `nginx -t` fails on first deploy with missing include? → Run Ansible playbook first to bootstrap blue-green slot file (see #17)
12. Env vars empty in container? → Add `--env-file` to every `docker compose` call (see #14)
13. OAuth state not found after restart or blue-green swap? → Store state in Redis, not in-memory (see #18)
14. `iss missing from the response` on OAuth callback? → Forward `iss` query param to `client.callback()` (see #19)
15. Session cookie not sent after OAuth redirect to app subdomain? → Set `Domain` to parent domain on the cookie (see #20)
