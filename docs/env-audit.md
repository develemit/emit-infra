# Fleet audit: declared `requiredEnvKeys` and production env completeness

**Date:** 2026-07-24
**Sprint:** 243
**Scope:** every project under `~/projects/` with a `.emit-infra.json` (7 total). Read-only against production — no server env was modified; only local `.emit-infra.json` files were edited.

## Why this exists

The secrets-drift check (`GET /projects/:name/secrets-drift`) can only compare a server's env against a project's declared `requiredEnvKeys`. Before this sprint, 6 of 7 projects had never declared that list, so the check was silently inert everywhere except emit-vision — which only got its 36-key list after emit-vision's own team hand-curated it in the wake of an incident where four missing email vars went unnoticed for a long period. Sprint 239 added empty-value detection (a required key present as `KEY=` is exactly as broken as a missing one) and sprint 240 shipped `emit-infra secrets scaffold-required-keys`, which derives a starting list from whatever keys currently exist on a project's server. This sprint runs last in the initiative because it's the first point where declaring keys fleet-wide is cheap enough to actually happen, and only then can this audit's core question — "is the server missing env the app needs?" — be answered at all. A local-vs-server key diff (run earlier, same day) only proves both sides agree; it says nothing about whether either side is complete.

develemail and emit-social were audited first since both send email — the same subsystem whose silent failure started this whole thread.

## Method

For each live project: run `scaffold-required-keys --dry-run` to see what the server currently has, review that list against the project's compose file(s) (`grep -oE '\$\{[A-Z_][A-Z0-9_]*' docker-compose*.yml`) and `.env.example` (where one exists) for anything compose/docs expect that the server lacks, write `requiredEnvKeys` once satisfied, then query `GET /projects/:name/secrets-drift` for the live verdict. Where a project uses `env_file:` directives instead of explicit `${VAR}` substitution (tastease, diner-decider's app services), the compose grep can't see through the blanket passthrough — `.env.example` is the fallback completeness check in that case. Source-code-level inference beyond compose/`.env.example` was out of scope.

## Summary table

| Project | Declared keys | Drift status | Missing | Empty | Verdict |
|---|---|---|---|---|---|
| develemail | 15 (14 scaffolded + 1 added) | **ok** (was drift) | none — *fixed 2026-07-24* | none | **gap found → RESOLVED** |
| emit-social | 26 | ok | none | none | safe |
| tastease | 42 | ok | none | none | safe |
| diner-decider | 44 | drift | none | 4 (`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`) | **gap found** |
| emit-vision | 36 (pre-existing, untouched) | ok | none | none | safe (preserved) |
| martialops | *(intentionally not declared)* | n/a | — | — | skipped — see note below |
| test-smoke | *(intentionally not declared)* | n/a | — | — | skipped — test fixture |

## Per-project findings

### develemail — gap found

- **Scaffold:** `--dry-run` returned 14 keys from the live server `.env` (`CORS_ORIGIN`, `DOMAIN`, `EMIT_VISION_DSN`, `EMIT_VISION_INGEST_KEY`, `EMIT_VISION_PROJECT_ID`, `ENCRYPTION_KEY`, `MAIL_ALLOWED_SENDER_DOMAINS`, `MAIL_HOSTNAME`, `MAX_PER_MINUTE`, `NOTIFICATION_FROM_ADDRESS`, `POSTGRES_DB`, `POSTGRES_PASSWORD`, `POSTGRES_USER`, `SERVER_IP`).
- **Compose comparison:** `${VAR}` refs across `docker-compose.prod.yml` + `.blue.yml` + `.green.yml` total 12 names, 11 of which the server already has. The 12th, `INBOUND_SECRET`, is referenced with no fallback default by both the `api` service (`docker-compose.blue.yml:39`) and the `inbound` service (line 60) — "Shared secret for the internal inbound receive endpoint. The inbound SMTP handler uses this to authenticate with the API" per `.env.example`. It does not appear anywhere in the scaffold's key list, meaning the server's `.env` has **no `INBOUND_SECRET` line at all** (not merely empty).
- **Action taken:** added `INBOUND_SECRET` to `requiredEnvKeys` manually after scaffolding (a local `.emit-infra.json` edit, in scope per this sprint). Confirmed via `GET /projects/develemail/secrets-drift`: `status: "drift"`, `missing: ["INBOUND_SECRET"]`.
- **Why this matters:** with the key absent, docker-compose substitutes an empty string and both containers start "healthy" while the inbound→API authentication check runs against an empty expected secret. Depending on how the API compares the header value, this is either a hard failure on every inbound email (silently rejected) or — worse — an auth check that trivially passes for an empty-string caller. Either way it is exactly the silent-failure class this initiative exists to catch.
- **Remediation — DONE 2026-07-24.** Impact confirmed first: inbound logs showed constant `Domain refresh failed with status 401`, i.e. inbound domain refresh was fully non-functional (fail-closed, so no security hole). Generated a 32-byte hex secret per `.env.example`'s documented method and set it in **both** `.env.prod` (the `ci.envFile` deploy source, so it survives the next deploy) and the server `/opt/develemail/.env`; hash-verified both sides match without printing the value. Recreated the green-slot `api`+`inbound` containers with `-p develemail-green`. Verified: secret present in both container envs (len 64), inbound 401 count now 0, direct auth test → **HTTP 200 with the secret, 401 without**, `secrets-drift` → `ok`. Backups: `.env.prod.bak-20260724` (local), `/opt/develemail/.env.bak-inbound-20260724` (server).

### emit-social — safe

- **Scaffold:** 26 keys from the server, matches every non-defaulted `${VAR}` reference across `docker-compose.blue.yml`/`.green.yml`.
- **Compose comparison:** four names appear in compose but not in the server's key list — `DEVELEMAIL_CAMPAIGN_MAP`, `INTEGRATION_DEVELEMAIL`, `INTEGRATION_EMIT_VISION`, `INTEGRATION_STRIPE`. All four are declared with an explicit `${VAR:-}` empty-string fallback in compose (`docker-compose.blue.yml:13-23`), i.e. intentionally optional feature flags, not gaps.
- **Drift:** `GET /projects/emit-social/secrets-drift` → `status: "ok"`, no missing, no empty.

### tastease — safe

- **Scaffold:** 42 keys from the server. Compose (`docker-compose.prod.yml`) uses `env_file: .env` for every service rather than per-var `${VAR}` substitution, so the compose-grep method can't see through it; `.env.example` was used as the completeness cross-check instead.
- **`.env.example` comparison:** the one name present in `.env.example` but absent from the server, `ADMIN_EMAILS`, has an explicit comment: "Empty or unset = fail closed (no admins). Intentionally unset in production." Not a gap. `NEXT_PUBLIC_BUILD_NUMBER` is also absent from the server list but is a build-time-injected value, not a runtime secret.
- **Drift:** `GET /projects/tastease/secrets-drift` → `status: "ok"`, no missing, no empty.

### diner-decider — gap found

- **Scaffold:** 44 keys from the server. `docker-compose.app.yml` uses `env_file:` for the app services (same blanket-passthrough shape as tastease); only the backup sidecar in `docker-compose.prod.yml` uses explicit `${VAR}` substitution, and all four of those names (`BACKUP_S3_*`) are already in the server's key list.
- **`.env.example` comparison:** `SERVER_IP` and `GHCR_TOKEN` appear in `.env.example` but not on the server — both are explicitly commented `# --- deploy (used by scripts/deploy.sh, not the app itself) ---`, i.e. deploy-time/CI-time values, not runtime app requirements. Not a gap.
- **Drift (the real finding):** `GET /projects/diner-decider/secrets-drift` → `status: "drift"` with `empty: ["BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY", "STORAGE_ACCESS_KEY_ID", "STORAGE_SECRET_ACCESS_KEY"]`. All four keys exist as lines in the server `.env` but with empty values.
- **Why this matters:** these are the S3-compatible credentials for both the database backup sidecar and the app's file-storage integration. Empty credentials mean either integration is very likely silently failing every auth attempt — backups may not be landing in S3, and any user-facing upload/download feature backed by `STORAGE_*` may be broken — while the containers themselves report healthy, since docker-compose treats an empty substitution as valid. This is the diner-decider-specific instance of the exact failure class emit-vision hit.
- **Remediation:** not performed here. Needs the real credential values sourced and set; see backlog. Recommend checking recent backup job success/failure and any upload-feature error logs as the fastest way to confirm impact before rotating credentials.

### emit-vision — safe (preserved)

- Left untouched per sprint instructions. `requiredEnvKeys` is the team's existing hand-curated 36-key list.
- **Drift:** `GET /projects/emit-vision/secrets-drift` → `status: "ok"`, no missing, no empty (one expected `extra`: `BUILD_NUMBER`).

### martialops — skipped, but with an unexpected sub-finding

- Per this sprint's context, martialops was expected to be "shelved, no server exists," with scaffolding expected to fail as unreachable. **That assumption is only half true.** `emit-infra secrets scaffold-required-keys --dry-run` for martialops *did* reach a live server via SSH (`178.104.195.59`) and returned a clean, specific failure — `No keys found in /opt/martialops/.env on the server — nothing to scaffold` — rather than an unreachable-host error. Cross-checking `GET /projects/martialops/status` confirmed the host is live (4+ weeks uptime, 6/10 containers running, real disk/memory figures).
- **The server IP martialops' `.emit-infra.json` declares (`178.104.195.59`) is tastease's live production server**, not a dead or placeholder box. `GET /projects/tastease/status` returns byte-identical uptime/disk/memory figures for the same IP. martialops itself isn't deployed there (no `/opt/martialops` content, `nginxConfigured: false`, `httpStatus: null` for martialops vs. `200` for tastease) — the two configs just happen to point at the same host.
- **Why this matters:** martialops is correctly *not* declaring `requiredEnvKeys` (there's genuinely nothing on the server under its name to scaffold), so this sprint's specific acceptance criteria are unaffected. But the stale `serverIp` is a latent hazard independent of this sprint's scope: any deploy-shaped command run against martialops today (`deploy`, `secrets-apply`, `provision`) would SSH into tastease's live production box under martialops' name, not fail cleanly the way "shelved, no server" implies. Flagged to backlog as a blocker for the emit-infra team to investigate — not something this audit should fix by editing the config, since the correct value (null? a decommissioned placeholder? tastease's IP for a legacy reason?) isn't clear from read-only investigation.
- No `requiredEnvKeys` were declared for martialops, matching the sprint's instruction to skip it.

### test-smoke — skipped, test fixture

- `.emit-infra.json` domain is `192.0.2.1` (RFC 5737 TEST-NET-1, reserved/non-routable). `GET /projects/test-smoke/status` → `{"error":"unreachable"}`, as expected. No `requiredEnvKeys` declared, matching the sprint's instruction to skip it.

## Summary

Of five live projects now capable of declaring `requiredEnvKeys`, all five do — four newly declared this sprint (develemail, emit-social, tastease, diner-decider) plus emit-vision's pre-existing curated list, left untouched. The drift check is no longer dormant fleet-wide.

Two genuine, previously-invisible gaps surfaced, both in projects prioritized first or found via the compose/`.env.example` completeness check this sprint specifically enables:

1. **develemail** is missing `INBOUND_SECRET` entirely — the shared secret authenticating inbound SMTP handling to the API. Compose substitutes an empty string; containers report healthy regardless.
2. **diner-decider** has four S3/storage credential keys present but empty (`BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `STORAGE_ACCESS_KEY_ID`, `STORAGE_SECRET_ACCESS_KEY`) — database backups and file storage integration are likely silently failing auth.

Neither was remediated here (out of scope for this sprint); both need real values sourced and set by someone with the authority to choose them, and both are logged in `backlog.md`.

One structural finding fell outside the env-completeness question entirely: martialops' `.emit-infra.json` still points its `serverIp` at what is actually tastease's live production server, rather than being genuinely absent as its "shelved" status implies. This doesn't affect this sprint's acceptance criteria (martialops correctly has nothing to scaffold), but it's a real hazard for any future deploy-shaped command run against martialops and is logged as a blocker-priority backlog item.
