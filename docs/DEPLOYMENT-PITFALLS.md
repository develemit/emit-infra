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

**See also:** #22 below — a related but distinct trap where `secrets sync` and `deploy` read two different *production* files, not a dev-vs-prod mixup.

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

**Fix:** There must be exactly **one** vhost per project, and its canonical name is the extensionless `/etc/nginx/sites-available/<project>`, symlinked to `/etc/nginx/sites-enabled/<project>`. Fix the *content* (make it blue-green aware) rather than the filename.

That extensionless path is what every code path in this repo assumes:

| Consumer | Path |
|---|---|
| `ansible/roles/nginx/tasks/main.yml` (provision copy + enable symlink) | `sites-available/<project>` |
| `ansible/roles/app-deploy/tasks/deploy-zero-downtime.yml` (backup / port swap / restore) | `sites-available/<project>` |
| `apps/api/src/routes/nginx-config.ts` (drift detection) | `sites-available/<project>` |
| `apps/api/src/routes/project-status.ts` (nginx "configured" check) | `sites-enabled/<project>` |

The vhost the project owns in its repo (`nginx.customConfigSrc`) must handle HTTPS (port 443) itself and use **named upstreams** from the blue-green slot include (`include /etc/nginx/blue-green/<project>.conf;`) rather than hardcoded slot ports. That is what makes it survive a slot swap; a `.conf`-suffixed second file never was.

> ⚠️ **Superseded advice.** An earlier version of this entry told you to `rm` the extensionless config and enable a `<project>.conf` alongside it. Don't. That produces exactly the conflicting-server-name state described above, just with the winner reversed, and it hides the project from drift detection and the dashboard's nginx check. If you find a server still on the `.conf` layout, migrate it back — content unchanged, filename only:
>
> ```bash
> mv /etc/nginx/sites-available/<project>.conf /etc/nginx/sites-available/<project>
> rm -f /etc/nginx/sites-enabled/<project>.conf
> ln -sfn /etc/nginx/sites-available/<project> /etc/nginx/sites-enabled/<project>
> nginx -t && nginx -s reload
> ```
>
> nginx does not re-read vhost files until reload, so the `mv`/`ln` window carries no traffic risk, and `nginx -t` gates the reload.

---

## 17. Blue-green nginx config `include` requires slot file to exist before first reload

**Symptom:** First deploy to a freshly provisioned server fails at the "Deploy nginx config" step with `nginx: [emerg] open() "/etc/nginx/blue-green/<project>.conf" failed (2: No such file or directory)`.

**Cause:** The project's nginx config includes `/etc/nginx/blue-green/<project>.conf` to load named upstreams (e.g. `upstream <project>_web { server 127.0.0.1:4400; }`). This file is written by `blue-green-deploy.sh` on each deploy — but on the very first deploy it doesn't exist yet. nginx refuses to reload with a missing include.

The Ansible `nginx` role's final task does write an initial blue-slot config to `/etc/nginx/blue-green/<project>.conf` using `blue-green-slot.conf.j2`, gated on the `blue_green` variable — but until sprint 316, no CLI command ever set that variable, so the task never ran on any real provision. `emit-infra configure` and `emit-infra setup` now read `blueGreen` from `.emit-infra.json` and pass `blue_green` (plus the blue-slot ports, mapped from `blueGreen.services`) to the `provision` playbook automatically.

**Fix:** Run `emit-infra configure <project>` (or `emit-infra setup`, which calls it) before the first deploy. This is a hard prerequisite for blue-green projects; CI cannot substitute for it. As long as the project's `.emit-infra.json` declares `blueGreen`, the CLI takes care of the rest.

If you need to bootstrap manually without the CLI/Ansible:

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
16. OAuth callback 500 with `42P01` (undefined table)? → Migrations never ran in production — copy migrations into the Docker image and remove the `NODE_ENV === 'production'` guard (see #21)
17. New production secret works in CI but not on the server (or vice versa)? → `secrets sync` and `deploy` read different files when `ci.envFile` is set — add the key to both, run `secrets sync --dry-run` to check (see #22)
18. Dashboard shows a deploy/CI run frozen mid-progress and you can't tell if it's still running? → check `.deploy-status.json`/`.ci-status.json`'s `writer.heartbeatAt`, or just run `emit-infra status` — see `docs/DEPLOY-SIGNALS-AND-LIVENESS.md`'s recovery runbook, and #25 below for why this happens

---

## 21. OAuth callback 500 — `42P01` (undefined_table) — migrations never ran in production

**Symptom:** Sign-in with Google (or any OAuth provider) lands on the callback URL and returns `{"error":{"code":"42P01","message":"Internal server error"}}`. The OAuth handshake succeeds (no `redirect_uri_mismatch`), but the API throws a PostgreSQL error when trying to look up or create the user.

**Cause:** Two compounding mistakes:

1. The API's `migrate.ts` had a guard: `if (env.NODE_ENV === 'production') { return; }` — so `runPendingMigrations()` was a no-op in the Docker container, which runs with `NODE_ENV=production`.
2. The Drizzle migrator uses `migrationsFolder: 'packages/db/migrations'` relative to CWD. The API Dockerfile's runner stage only copied the compiled output (`dist/apps/api`), not the migrations folder — so even without the guard, the migrator would have thrown "directory not found".

Result: the production database had **zero tables**. Every API call that touched the DB returned `42P01`.

**Fix (immediate — run migrations manually):**

```bash
# Copy migration SQL files to server
scp -i ~/.ssh/emit-deploy -r packages/db/migrations root@<SERVER_IP>:/tmp/dd-migrations

# Run all migrations in order
ssh -i ~/.ssh/emit-deploy root@<SERVER_IP> "
  DB_USER=\$(grep POSTGRES_USER /opt/<project>/.env | cut -d= -f2)
  DB_NAME=\$(grep POSTGRES_DB /opt/<project>/.env | cut -d= -f2)
  for f in \$(ls /tmp/dd-migrations/*.sql | sort); do
    docker compose -f /opt/<project>/docker-compose.prod.yml exec -T postgres \
      psql -U \$DB_USER -d \$DB_NAME -f /dev/stdin < \$f
  done
"
```

**Fix (permanent — so this never happens again):**

1. Remove the production guard from `migrate.ts`:
```typescript
// Before — skips migrations in production
export async function runPendingMigrations() {
  if (env.NODE_ENV === 'production') { return; }
  // ...
}

// After — Drizzle's migrator is idempotent; safe to run on every startup
export async function runPendingMigrations() {
  const db = getDb();
  await migrate(db, { migrationsFolder: 'packages/db/migrations' });
  await getPool().query('SELECT 1');
}
```

2. Copy migrations into the API Docker runner stage so the folder exists at the expected path:
```dockerfile
COPY --from=builder --chown=appuser:nodejs /app/dist/apps/api ./
COPY --from=builder --chown=appuser:nodejs /app/packages/db/migrations ./packages/db/migrations
```

Drizzle's `migrate()` creates a `__drizzle_migrations` tracking table and only applies SQL files that haven't been recorded yet — it is fully idempotent and safe to run on every container startup.

**What to check in a new project:**
- Is `NODE_ENV=production` set in the Docker runner stage? If yes, any env-based guard will be active.
- Does the production Docker image include the migrations folder? Check the Dockerfile runner stage `COPY` lines.
- Does the deploy workflow include a migration step, or are migrations run only at startup?

---

## 20. `MIGRATE_PRE` must run after the image pull — or migrations come from the old image

**Symptom:** Blue-green deploy fails at the new slot's API health check. Container logs show the API crashing at boot on a query referencing a column its own release's migration should have added (`column does not exist`). The DB shows the migration was never applied, even though the deploy log printed "Running pre-deploy migration..." with no error.

**Cause:** `blue-green-deploy.sh` ran `MIGRATE_PRE` (typically `docker compose run --rm api node migrate.mjs`) **before** `compose pull`. The `run` used the locally-cached `:latest` image — the previous release — whose migrations folder doesn't contain the new migration files. The migration step succeeds (nothing pending from the old image's perspective) and silently applies nothing.

**Fix:** The script now pulls images for the inactive slot first, then runs `MIGRATE_PRE`, so the migration container is the new release. If you hit this on a server with an old copy of the script, run the migrate command manually after a pull, or just redeploy — Ansible re-copies the fixed script on every deploy.

---

## 22. `secrets sync` and `deploy` read different production env files — a secret added to one never reaches the other

**Symptom:** A newly added production environment variable is visible in GitHub Actions (`gh secret list` shows it) but the running container on the server never sees it — the app behaves as if the variable is unset, with no error anywhere. In the worst case the missing variable silently degrades a feature instead of crashing: emit-vision's outgoing verification/reset emails stopped sending for an extended period while `POST /auth/resend` kept returning `200 {"message":"verification_sent_if_found"}`, because the four `DEVELEMAIL_*`/`EMAIL_FROM_ADDRESS` keys had been added to the file `secrets sync` reads, but never to the file `deploy` copies to the server.

**Cause:** `emit-infra secrets sync` and `emit-infra deploy` resolve their env file **independently**, and the two resolvers don't agree:

- `apps/cli/src/commands/secrets-sync.ts` → `resolveEnvFile(cwd)`: `.env.prod` if it exists, else `.env`. It never looks at `ci.envFile`.
- `apps/cli/src/commands/deploy.ts:145` → `[config.ci?.envFile, '.env.prod', '.env']`, first existing file wins.

When a project's `.emit-infra.json` sets `ci.envFile` to something other than `.env.prod` (emit-vision uses `infra/secrets.prod.env`), the two commands are reading **two different files** — one destined for GitHub repo secrets, the other for the server's `/opt/<name>/.env`. Adding a secret to the "obvious" file (`.env.prod`) gets it into CI but not onto the server, or vice versa. Both files can drift indefinitely with nothing to notice.

The residue that proved this happened: emit-vision's `.env.prod` had 9 keys, 4 of which were exactly the email vars — added there, never added to `infra/secrets.prod.env` (36 keys), which `deploy` actually reads.

**Fix (detection, already shipped):** `emit-infra secrets sync` now resolves the deploy-side file the same way `deploy.ts` does and compares it against the file it's about to sync. If they differ, it prints a non-blocking warning naming (by key, never by value) which keys are only in the sync source, only in the deploy source, or present in both with different values. Run `emit-infra secrets sync --dry-run` any time you add a production secret and confirm no warning fires for the key you just added.

**Fix (process):** When adding a new production secret, add it to *both* destinations:
1. The file `secrets sync` reads (`.env.prod`, or check `--env-file`).
2. The file `deploy` reads (`ci.envFile` in `.emit-infra.json` if set, else the same `.env.prod`).

See `README.md`'s "Production secrets: two files, two destinations" section for the full table and a checklist.

**What to check in a new project:** does `.emit-infra.json` set `ci.envFile`? If yes, that project has the split and both files need every production key kept in sync manually — `secrets sync`'s warning is the safety net, not a substitute for adding the key to both files.

---

## 23. `sites-enabled/*` has no `.conf` filter on any fleet server — any staged file there gets parsed as a vhost

**Symptom:** A backup or scratch file dropped into `/etc/nginx/sites-enabled/` on a fleet server gets loaded by nginx like a real vhost, even though it was never symlinked in on purpose. `nginx -t` then fails on whatever the stray file collides with (a duplicate directive, a bad `server_name`), and the failure looks like a live config problem rather than what it actually is — leftover scratch content sitting in the wrong directory. During sprint 237's tastease reconciliation this produced exactly that false alarm: a dated backup file placed inside `sites-enabled/` broke `nginx -t` on a duplicate `real_ip_header` directive, and it took a careful read to confirm the orphan itself (sitting in `sites-available/`, unsymlinked) was inert and the backup was the actual culprit.

**Cause:** `nginx.conf`'s http block ends with `include /etc/nginx/sites-enabled/*;` — no `*.conf` suffix filter. Checked directly on all five fleet servers (sprint 262, 2026-08-01):

| Host | IP | `sites-enabled` include pattern |
| --- | --- | --- |
| tastease | 178.104.195.59 | `sites-enabled/*` (bare) |
| emit-vision | 178.105.227.175 | `sites-enabled/*` (bare) |
| diner-decider | 167.233.43.96 | `sites-enabled/*` (bare) |
| develemail | 178.105.171.1 | `sites-enabled/*` (bare) |
| emit-social | 167.233.169.206 | `sites-enabled/*` (bare) |

This sprint was scoped assuming the hazard was tastease-specific ("other fleet hosts use `sites-enabled/*.conf` and are not affected") — that assumption was wrong. All five hosts share the same base provisioning and the same bare-glob include. `sites-available/` and `/etc/nginx/conf.d/*.conf` are unaffected (not glob-included, or filtered to `.conf`); only `sites-enabled/` on these five hosts loads anything staged in it regardless of name.

**Fix:** Never stage scratch, backup, or half-written config files inside `sites-enabled/` on any fleet server — use `sites-available/` (not glob-included) or a dedicated archive directory (e.g. `/root/nginx-archive-<date>/`, outside any nginx include path) instead. If you need to disable a vhost temporarily, remove the `sites-enabled` symlink rather than renaming the file in place. The real fix — switching every host's include to `sites-enabled/*.conf` — is a behavior change on live boxes and is intentionally out of scope here; it would need its own sprint per host.

---

## 24. `PRUNE_STRATEGY="standard"` never reclaims anything — tagged images accumulate until the disk fills

**Symptom:** A fleet server's disk creeps up deploy after deploy (tastease hit 69% with 179 image tags, only 9 active) even though every deploy runs a prune step. `du -sh /var/lib/docker` makes it look like Docker isn't the culprit — the space is actually in `/var/lib/containerd` (containerd image store).

**Cause:** The "standard" strategy runs `docker image prune -f`, which only removes *dangling* (untagged) images. Every image we ship keeps its `:SHA`, `:BUILD_NUMBER`, and `:latest` tags, so nothing is ever dangling and the prune is a no-op. The zero-downtime and standard deploy paths already pruned aggressively; the blue-green path was the outlier.

**Fix (2026-08-13):** The `.deploy-config` template (`deploy-blue-green.yml`) now defaults to `PRUNE_STRATEGY="aggressive"` — prune containers and images older than 24h during each deploy. Images referenced by any container (running or stopped) are never touched, so the live slot is safe regardless of age. Trade-off: rollback to a build older than 24h re-pulls from GHCR (~1–2 min) instead of starting instantly. Opt a project out with `blueGreen.pruneStrategy: "standard"` in `.emit-infra.json`.

**Diagnosis tip:** With the containerd image store, `docker system df` reports image sizes but the bytes live under `/var/lib/containerd`, not `/var/lib/docker`. Reclaim manually with `docker container prune -f --filter "until=24h" && docker image prune -a -f --filter "until=24h"`.

---

## 25. A killed pre-push hook freezes `.deploy-status.json` forever — and the deploy mechanism itself is invisible from inside the project

**Symptom (2026-08-19, emit-social):** The dashboard showed a deploy stuck at
`deploying` / 66% indefinitely. Diagnosis took longer than the actual repair
because two independent local signals both pointed the wrong way.

**Cause — two misleading signals:**

1. **Nothing in the project said "this pushes to production."** emit-social's
   `.github/` holds only skills and prompts, no `.github/workflows/`, and
   `ls .git/hooks` showed only `.sample` files. Both are the normal signature
   of "no CD here" — except `core.hooksPath` was set to `.githooks`, whose
   `pre-push` is a symlink *out of the repo* into `emit-infra`
   (`scripts/hooks/pre-push`, shared across every wired project). The deploy
   trigger for a push to `main` was real, and invisible from every place a
   reasonable person would look first.
2. **The `deploying` status carried no liveness information.** There was no
   way to tell, from the status file alone, whether it reflected a real
   in-progress deploy or a run that had died. A frozen `deploying` at 66%
   looked identical either way.

**What actually happened:** the process running the pre-push hook was killed
mid-build (a teardown-prone environment — an agent's background shell —
running a push to `main`, which the hook doesn't and can't distinguish from
any other push). `deploy_done` never ran, so `.deploy-status.json` stayed
frozen at `deploying`. `origin/main` never moved and prod was never touched —
this was a stuck local artifact, not a bad deploy or a broken server.

**Fix, across sprints 282–287:**

- **282** — trap `SIGINT`/`SIGTERM`/`SIGHUP` in the hook and write a terminal
  status (`interrupted` for deploy, `failure` for CI) before re-raising the
  signal, so a killed run stops lying about being in progress.
- **283** — add a `writer` block (`pid`/`host`/`heartbeatAt`, refreshed every
  30s) to every in-flight record, closing the `SIGKILL`-can't-be-trapped gap:
  a reader can now infer liveness even when no terminal write ever happens.
- **284** — one shared classifier (`classifyRunState`) turns that metadata
  into `idle`/`running`/`orphaned`/`unknown`, used by the API, the CLI, and
  the dashboard instead of three separate heuristics.
- **285** — the dashboard renders `orphaned`/`unknown` visibly differently
  from a live run (a stalled card with a stale duration, not a frozen
  progress bar) and excludes them from the "N running" count.
- **286** — `emit-infra reconcile [--write]` clears an orphaned record with a
  correct terminal status and history line, so `resolve_last_deployed_sha`
  stops being hidden behind a stuck record.
- **287** — writes down the status vocabulary, the liveness rule, the
  operator warning, the recovery runbook, and the discoverability trap, so
  the next person doesn't have to reverse-engineer the hook under pressure.
  See `docs/DEPLOY-SIGNALS-AND-LIVENESS.md`'s "Status files and liveness" and
  "Recovery runbook" sections, and `docs/PRE-PUSH-HOOK.md`'s "How projects get
  the hook" section for the `core.hooksPath` check.
- **288** — turned the operator warning into an enforced gate: the deploy
  phase now refuses to start (exits 1, no status write) when a
  teardown-prone shell marker (`CLAUDECODE`/`CLAUDE_CODE_ENTRYPOINT`/`CI`) is
  set, closing off the exact incident shell from ever repeating it silently.
  Necessary, but it also blocked every *legitimate* agent-driven deploy —
  the same markers are present whether the shell will survive or not, and
  the gate had no way to tell the difference.
- **289** — rather than loosen the gate (which would have silently
  re-opened this incident for anyone else's agent shell), added
  `scripts/deploy-detached.sh`: it backgrounds the **entire** `git push`
  with `nohup`/`disown` — not just the deploy phase, because the hook
  deploys *before* `git push` itself returns, so detaching only the deploy
  phase would let prod get ahead of `origin/main` — and polls for a
  terminal result. Proven against a real kill: a scratch-repo end-to-end
  test kills the launching process mid-push and confirms the backgrounded
  push still completes and the terminal status record lands correctly.
- **290** — 289's script still had to set 288's gate bypass
  (`EMIT_ALLOW_UNATTENDED_DEPLOY=1`) to get through, which reads as "turn the
  safety check off" rather than "this specific launch is durable." Renamed
  it to `EMIT_DEPLOY_DETACHED=1` — an honest declaration, not a bare
  override — kept the old name working as a deprecated, warned alias, and
  stamped a `"launch":{"mode","marker"}` block onto every deploy-status
  record (in-flight and terminal) so a post-mortem can tell which path a
  deploy actually took. The declaration can't be verified: macOS bash 3.2
  exposes no inherited ignored `SIGHUP`, has no `setsid`, and `nohup`
  doesn't change `pgid` — it's a contract with the caller, not a proof.
- **291** (this doc) — by this point `docs/PRE-PUSH-HOOK.md` actively told
  operators not to do the thing 289/290 now support, which is worse than no
  documentation since it's trusted under pressure. Corrected it and
  documented the detached workflow end to end: launch, resume a deploy
  whose launching session went away, read the launch-mode field in a
  post-mortem, and recover an orphaned record. See
  `docs/DEPLOY-SIGNALS-AND-LIVENESS.md`'s "Detached deploys" and "Recovery
  runbook" sections.
