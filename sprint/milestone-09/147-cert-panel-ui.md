# Sprint 147 — Certificate details panel

**Difficulty:** 2

## Goal

Add a dashboard panel replacing the existing SSL expiry chip with a full certificate details card showing issuer, SANs, serial, validity window, and certbot renewal timer status.

## Reason

Sprint 146 exposes detailed cert data. This sprint promotes the existing one-liner SSL chip into a proper card, giving operators everything they need to diagnose cert issues: wrong SANs, unexpected issuer, or a broken renewal timer — all visible at a glance.

## Context

- Builds on sprint 146: `GET /projects/:name/cert-details` returns `CertDetails`.
- Add `getCertDetails(name)` to `apps/dashboard/src/lib/api.ts`.
- Component: `apps/dashboard/src/components/detail/cert-panel.tsx`. Card with title "SSL Certificate" and `lock` icon.
  - Stat grid (2 columns):
    - Expires: formatted as `${daysUntilExpiry}d` with color (< 7d → err, < 30d → warn, else ok)
    - Issued: `notBefore` formatted as short date (e.g. `2024-01-15`)
    - Serial: first 12 chars of serial in mono, truncated
    - Issuer: show just the `O=` or `CN=` part, not the full string
  - SANs: a row of mono chips, one per SAN domain.
  - Renewal timer: "Last renewed: X days ago" or "Never / unavailable" in subtle text.
- Replace the existing inline SSL chip in `apps/dashboard/app/projects/[name]/page.tsx` (the `{backupStatus !== null && ...}` block pattern — look for the ssl-related chip if one exists, otherwise just add the panel after HealthCard). Actually the SSL expiry is shown in HealthCard's StatTile — do NOT remove it from HealthCard. Mount `CertPanel` as an additional card after the response time panel, guarded by `status?.sslExpiry != null`.
- No refresh button — loads once on mount.

## Tasks

1. Read `apps/dashboard/src/lib/api.ts` (last 20 lines) to confirm fetch pattern.
2. Add `CertDetails` type and `getCertDetails(name: string)` to `apps/dashboard/src/lib/api.ts`.
3. Create `apps/dashboard/src/components/detail/cert-panel.tsx`.
4. Mount `<CertPanel name={name} />` in `apps/dashboard/app/projects/[name]/page.tsx` after the `ResponseTimePanel` block, guarded by `status?.sslExpiry != null`.
5. Run `pnpm nx typecheck dashboard --skip-nx-cache`. Fix any errors.

## Files involved

- `apps/dashboard/src/lib/api.ts` — add `CertDetails` type and `getCertDetails`
- new file: `apps/dashboard/src/components/detail/cert-panel.tsx` — cert details card
- `apps/dashboard/app/projects/[name]/page.tsx` — mount panel

## Acceptance criteria

- [x] Panel shows expiry days (colored), issued date, serial (truncated), and issuer (extracted from full string)
- [x] SANs displayed as a row of mono chips
- [x] Renewal timer last-ran shown; if null, shows "unavailable"
- [x] Panel only rendered when `status?.sslExpiry != null`
- [x] `pnpm nx typecheck dashboard --skip-nx-cache` passes clean

## Completed

**Date:** 2026-07-01

### Summary
Added `CertDetails` type and `getCertDetails()` to `api.ts`. Created `CertPanel` with lock icon, 2-column stat grid (expiry with color coding, issued date, truncated serial, extracted O=/CN= issuer), SAN mono chips row, and renewal timer relative date. Mounted after ResponseTimePanel, guarded by `status?.sslExpiry != null`.

### Files changed
- `apps/dashboard/src/lib/api.ts` — added `CertDetails` type and `getCertDetails`
- (new) `apps/dashboard/src/components/detail/cert-panel.tsx` — SSL certificate details card
- `apps/dashboard/app/projects/[name]/page.tsx` — mounted `CertPanel`

### Verification
- `pnpm nx typecheck dashboard --skip-nx-cache`: clean

### Follow-ups
none

## Out of scope

- Removing the SSL tile from HealthCard (keep both — the card gives context, the tile gives quick status)
- OCSP or chain details
- One-click renewal trigger
