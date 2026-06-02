# emit-vision — Production Deployment Pitfalls

Hard-won lessons from the first production deployment. Each entry is a real failure we hit. Companion to `SETUP.md`.

---

## 1. Hetzner floating IP must be configured in netplan

**Symptom:** Cloudflare 522 (TCP timeout) even though the server is running and the floating IP is assigned in the Hetzner dashboard.

**Cause:** Hetzner assigns the floating IP in their control panel, but the OS never adds it to the network interface. Traffic to that IP is silently dropped at the kernel level.

**Fix:** Create `/etc/netplan/60-floating-ip.yaml`:

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    eth0:
      addresses:
        - <floating_ip>/32
```

Then run `netplan apply`. This persists across reboots. The bootstrap script in `ansible/` handles this automatically when `FLOATING_IP` is set.

---

## 2. Caddy in Docker must use service names, not `localhost`

**Symptom:** Caddy returns 502 with `dial tcp [::1]:4301: connect: connection refused`.

**Cause:** Caddy runs in its own container. Inside that container, `localhost` resolves to `[::1]` (the container's own loopback), not the host. Other services' ports published on the host's `127.0.0.1` are not reachable this way.

**Fix:** Use Docker Compose service names in the Caddyfile:

```
# Wrong
reverse_proxy localhost:4301

# Right
reverse_proxy api:4301
```

All services in the same Compose file share a network and resolve each other by name.

---

## 3. Caddy ACME challenges fail behind Cloudflare proxy — use `tls internal`

**Symptom:** Caddy fails to obtain a Let's Encrypt certificate; ACME HTTP-01 or TLS-ALPN-01 challenge errors in logs.

**Cause:** When Cloudflare proxies a domain (orange cloud), it intercepts port 80 and 443. Let's Encrypt's challenge responses never reach the origin.

**Fix:** Add `tls internal` to any Caddyfile block for a proxied domain. Caddy issues a self-signed cert; Cloudflare terminates TLS for the client and forwards to the origin using the self-signed cert (which it accepts under "Full" SSL mode).

```
app.{$DOMAIN} {
  tls internal
  reverse_proxy web:4300
}
```

Cloudflare SSL mode must be **Full** (not Full Strict). Full Strict rejects self-signed certs.

Domains that are **DNS-only** (gray cloud) can use normal ACME — Cloudflare doesn't intercept them.

---

## 4. Every service needs every env var required by shared packages

**Symptom:** One service crash-loops with `Missing required production env var: CORS_ORIGIN` even though another service has it.

**Cause:** A shared config package validates all required production env vars at startup. Both services import it. The var was only in one service's `environment` block in `docker-compose.prod.yml`.

**Fix:** When a shared library enforces required env vars in production, every service that imports it needs every var — even if that service doesn't directly use it. Audit `docker-compose.prod.yml` against the config package's required var list when adding a new service.

---

## 5. tsup: use CJS format with `noExternal` to avoid ESM/CJS interop failures

**Symptom:** `Dynamic require of "events" is not supported` or `ERR_AMBIGUOUS_MODULE_SYNTAX` at runtime.

**Cause:** ESM output + CommonJS npm packages (pg, geoip-lite, etc.) cause dynamic-require failures. The packages assume a CJS environment.

**Fix:**

```typescript
// tsup.config.ts
export default defineConfig({
  format: ["cjs"],
  noExternal: [/.+/],   // bundle everything into one CJS file
  external: ["pg-native"], // native addon — can't be bundled
});
```

CJS top-level await is not supported — wrap entry point in an async IIFE:

```typescript
(async () => {
  await start();
})().catch((err) => { console.error(err); process.exit(1); });
```

---

## 6. Bundled packages lose their data files — copy separately in Dockerfile

**Symptom:** `geoip-lite` (or similar) throws a missing file error at runtime despite the JS bundle loading fine.

**Cause:** tsup bundles JS files only. Packages that load binary/data files at runtime find those files missing when running from the bundle output directory.

**Fix:** Explicitly copy data files in the Dockerfile's runner stage:

```dockerfile
COPY --from=builder --chown=appuser:nodejs \
  /app/node_modules/.pnpm/geoip-lite@2.0.2/node_modules/geoip-lite/data/ \
  /data/
```

Update the path if the package version changes.

---

## 7. `.npmrc` must be in the Docker build context

**Symptom:** `pnpm install --frozen-lockfile` fails inside Docker with a lockfile mismatch, even though the local install works.

**Cause:** pnpm v10 encodes `.npmrc` settings (e.g. `inject-workspace-packages=true`) into the lockfile. If `.npmrc` isn't present when Docker runs `pnpm install`, the effective settings differ and the lockfile is considered mismatched.

**Fix:** Add `.npmrc` to the `COPY` line in every Dockerfile before `pnpm install`:

```dockerfile
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc tsconfig.base.json ./
```

---

## Debugging checklist for a new deployment

When a container is crash-looping, check in this order:

1. `docker logs --tail 30 <container>` — read the actual error before guessing
2. Missing env var? → Add it to the service's `environment` block in the Compose file
3. Missing data file at runtime? → Add a separate `COPY` for it in the Dockerfile runner stage
4. Caddy returning 502? → Verify `reverse_proxy` uses service names, not `localhost`
5. Cloudflare 522? → Check that the floating IP is configured in netplan on the host
6. Caddy TLS/cert error? → Check if the domain is Cloudflare-proxied; if so, add `tls internal`
