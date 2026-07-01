# Sprint 146 — Certificate details API

**Difficulty:** 3

## Goal

Add a `GET /projects/:name/cert-details` route that SSHes into the server, reads the Let's Encrypt certificate from `/etc/letsencrypt/live/{domain}/`, extracts issuer, SANs, serial, validity window, and checks whether the certbot auto-renew timer ran recently.

## Reason

The HealthCard already shows SSL expiry days, but provides no detail about what's actually in the cert. SANs reveal misconfigured certificate scope (a wildcard that doesn't cover all needed subdomains, or a cert that was issued for the wrong domain). Renewal timer status catches broken certbot setups before certs expire.

## Context

- Create `apps/api/src/routes/cert.ts`. Register in `apps/api/src/index.ts`.
- Domain: `project.config.domain`. Cert path: `/etc/letsencrypt/live/${domain}/cert.pem`.
- SSH command (single round-trip):
  ```bash
  openssl x509 -noout -issuer -subject -serial -startdate -enddate -ext subjectAltName -in /etc/letsencrypt/live/${domain}/cert.pem 2>/dev/null && systemctl show certbot.timer --property=LastTriggerUSec 2>/dev/null || echo "timer-unavailable"
  ```
  Parse `openssl x509` output fields:
  - `issuer=` → issuer string
  - `subject=` → subject string
  - `serial=` → serial hex string
  - `notBefore=` → validity start (date string)
  - `notAfter=` → validity end (date string, same format as status route already uses)
  - `DNS:foo.com, DNS:bar.com` → SANs (the `subjectAltName` extension line)
  - `LastTriggerUSec=<usec_epoch>` → parse to seconds; if `1970-01-01` or unavailable, treat as never run.
- Return type:
  ```ts
  interface CertDetails {
    issuer: string
    subject: string
    serial: string
    notBefore: string      // ISO string
    notAfter: string       // ISO string
    sans: string[]
    renewTimerLastRan: string | null  // ISO string or null
    daysUntilExpiry: number
  }
  ```
- TTL cache 3_600_000ms (1 hour — cert details don't change until renewal).
- If cert file not found (output is empty), return 404. On SSH failure return 503.

## Tasks

1. Read `apps/api/src/routes/projects.ts` lines 1–15 for import pattern.
2. Read `apps/api/src/index.ts` for registration pattern.
3. Create `apps/api/src/routes/cert.ts` with the route and a `parseOpenSslOutput(raw: string): CertDetails` helper. Parse each named field from `openssl x509` output with regex or line scanning. The `systemctl show` output is on the last line.
4. Parse the `LastTriggerUSec` value: it's microseconds since epoch. Divide by 1000 for milliseconds. If the value is `"0"` or `"timer-unavailable"`, set `renewTimerLastRan: null`.
5. Register `certRoutes` in `apps/api/src/index.ts`.
6. Run `pnpm nx typecheck api --skip-nx-cache`. Fix any errors.

## Files involved

- new file: `apps/api/src/routes/cert.ts` — cert-details route and parser
- `apps/api/src/index.ts` — register cert routes

## Acceptance criteria

- [x] Returns `CertDetails` with all fields populated when cert exists
- [x] `sans` is a `string[]` of bare domain names (e.g. `["foo.com", "*.foo.com"]`)
- [x] `daysUntilExpiry` is computed from `notAfter` relative to `Date.now()`
- [x] Returns 404 when cert file not found on server
- [x] Returns 503 on SSH failure
- [x] `pnpm nx typecheck api --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Created `apps/api/src/routes/cert.ts` with `GET /projects/:name/cert-details`. Single SSH round-trip runs `openssl x509` to read all fields plus `systemctl show certbot.timer` for renewal history. `parseOpenSslOutput()` scans lines for `issuer=`, `subject=`, `serial=`, `notBefore=`, `notAfter=`, extracts SANs via `/DNS:([^,\s]+)/g` regex, and parses `LastTriggerUSec` (microseconds) to ISO string. `daysUntilExpiry` computed from `notAfter`. Returns 404 if output is empty/unparseable (cert not found), 503 on SSH failure. 1-hour TTL cache.

### Files changed
- (new) `apps/api/src/routes/cert.ts` — cert-details route and openssl parser
- `apps/api/src/index.ts` — registered `certRoutes`

### Verification
- `pnpm nx typecheck api --skip-nx-cache`: clean

### Follow-ups
- `[defer]` `LastTriggerUSec` uses microseconds; if systemctl on older Ubuntu versions returns a different unit format, `renewTimerLastRan` may be wrong — verify on target servers

## Out of scope

- Dashboard UI (sprint 147)
- OCSP stapling status
- Certificate chain validation
- Non-Let's Encrypt certificate paths
