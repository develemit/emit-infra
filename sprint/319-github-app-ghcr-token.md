# Mint short-lived GHCR tokens from a GitHub App instead of the operator's `gh` session
**Difficulty:** 4

> _Has a one-time manual prerequisite: creating and installing the GitHub App
> is a browser step that cannot be automated. See "Manual prerequisite" below —
> the sprint builds and tests the tooling; end-to-end proof against a real App
> may have to wait on the user._

## Goal
`emit-infra ghcr:token` mints a short-lived, narrowly-scoped GitHub App
installation token, and the pre-push hook uses it instead of the operator's
personal `gh` OAuth session.

## Reason
Today emit-infra's only GitHub credential is one line
(`scripts/hooks/pre-push:191`):
```bash
TOKEN="${GHCR_TOKEN:-$(gh auth token 2>/dev/null || true)}"
```
Verified 2026-08-26: grep across `apps/cli/src`, `scripts/`, and `packages/`
finds **no** GitHub App, installation-token, JWT, or app-private-key handling
anywhere. So every project's registry credential is the operator's personal
`gh` session, carrying whatever scopes it happens to have — on this
workstation `gist, read:org, repo, user, workflow, write:packages`. A registry
pull needs one of those; **`repo` alone grants full read/write to every private
repository on the account.**

That token also ends up at rest on internet-facing hosts: because the
blue-green path had no login step (sprint 317), the unblock was a persistent
`docker login`, writing base64 of `develemit:gho_<broad-scope-token>` into
`/root/.docker/config.json`. diner-decider's server has the same file, so this
is fleet-wide.

**A PAT is not the fix, and that is GitHub's constraint rather than ours.**
Verified: `GET /user/personal-access-tokens` → `404`; GitHub exposes no REST
endpoint to create a PAT of either kind, and `gh` has no creation command —
only `gh auth token`, which prints the existing one. So `emit-infra
ghcr:rotate-token` cannot be built as a like-for-like of
`emit-infra r2:rotate-token` (which works precisely because Cloudflare *does*
expose token creation).

**Installation tokens are mintable.** `POST
/app/installations/{installation_id}/access_tokens`, authenticated with a JWT
signed by the App's private key. `GET /app` returns `401 "A JSON web token
could not be decoded"` rather than `404` — the route exists and is rejecting a
non-JWT credential. Properties that fit: permissions are declared on the App
(so `packages: read` and nothing else), tokens expire in 1 hour, and minting is
fully automatable after the one-time setup.

## Context

### Manual prerequisite
Creating the App and installing it on the account is a browser flow. The sprint
cannot do it. Handle this by:
- writing the tooling and its tests so they pass against a **stubbed** GitHub
  API (no network),
- documenting the exact one-time setup steps (App name, `packages: read`
  permission, where to download the private key, how to find the installation
  id),
- if the user has already created the App and stored the credentials, running
  the real end-to-end check and recording it; otherwise stating plainly in the
  Completed section that end-to-end verification is pending, and **not**
  ticking a criterion that claims it was proven.

Do not fake this. A sprint that reports success without a real token is worse
than one that reports partial completion.

### Credential storage — follow the existing pattern
R2 credentials already live in `~/.emit-infra/<project>/` (e.g.
`terraform-backend.env`, and `r2-app-token.env` written at 0600).
`setup.ts:289` has `readAppTokenStore`/`writeAppTokenStore` as the local
precedent for reading and writing a credential store there.

The GitHub App is **account-wide, not per-project** — one App serves the whole
fleet. So it belongs at `~/.emit-infra/` top level (alongside
`digest-state.json`), not under a project directory. State the path you choose
and why.

Store: app id, installation id, and the private key (or a path to it). The
private key is the crown jewel — `0600`, never logged, never echoed.

### JWT signing
Node's built-in `crypto` can sign RS256 without a dependency. GitHub requires
`iat`, `exp` (max 10 minutes out), and `iss` (the App id). Clock skew is a
common failure — set `iat` slightly in the past.

### Wiring into the hook
`scripts/hooks/pre-push:191` is bash and runs with **no environment loaded**
(`ENV_FILE` is sourced later, during the deploy phase only) — see
`docs/PRE-PUSH-HOOK.md`. Anything the hook calls must work without project env.
The established pattern for the hook calling emit-infra is **subprocess against
the built CLI**, not import (sprint 276) — and note that a stale
`apps/cli/dist` silently serves old code, so the hook must tolerate or detect
that.

Keep `GHCR_TOKEN` as an explicit override, and keep `gh auth token` as a
documented fallback rather than deleting it outright — a broken App setup
should degrade, not brick every push in the fleet.

### Rotation and revocation
Installation tokens expire on their own in an hour, so there is no rotation
command to build. That is the point: it removes the whole
`r2:rotate-token`-shaped problem rather than duplicating it.

## Tasks
1. Decide and document the credential store location and shape; implement
   read/write at `0600`, following the `readAppTokenStore` precedent.
2. Implement RS256 JWT signing from the App private key using Node `crypto`.
3. Implement `emit-infra ghcr:token` — sign a JWT, call
   `POST /app/installations/{id}/access_tokens`, print the token to stdout.
4. Print **only** the token on stdout so it is pipeable; all human output to
   stderr. Match how `emit-infra db-url` behaves for subprocess consumers.
5. Handle the failure modes explicitly with actionable messages: missing
   credentials, malformed private key, `401` (bad JWT / clock skew), `404`
   (wrong installation id).
6. Wire `scripts/hooks/pre-push:191` to prefer `GHCR_TOKEN`, then
   `emit-infra ghcr:token`, then `gh auth token` as fallback.
7. Document the one-time App setup in `docs/`, including the `packages: read`
   permission and where to find the installation id.
8. Tests against a stubbed GitHub API: JWT claim construction, token
   extraction, and each failure mode.
9. If the App exists, run a real end-to-end mint and a real `docker login` with
   the resulting token; otherwise record that this is pending.

## Files involved
- new file: `apps/cli/src/commands/ghcr-token.ts` — the command
- new file: `apps/cli/src/commands/ghcr-token.test.ts` — stubbed tests
- new file or extension: a GitHub App credential store helper
- `apps/cli/src/index.ts` — register the command
- `scripts/hooks/pre-push` — credential resolution order at ~line 191
- `docs/` — one-time App setup guide

## Acceptance criteria
- [ ] `emit-infra ghcr:token` prints only a token on stdout, with all other
      output on stderr.
- [ ] The private key is stored `0600` and never appears in any log, error, or
      stdout — show the grep.
- [ ] Each failure mode (missing creds, malformed key, 401, 404) produces a
      distinct actionable message.
- [ ] `ghcr-token.test.ts` covers JWT claim construction (including `exp` ≤ 10
      minutes and a past-shifted `iat`), token extraction, and all four failure
      modes, against a stub — no network in tests.
- [ ] The hook's resolution order is `GHCR_TOKEN` → App token → `gh auth
      token`, and a broken App setup still falls back rather than failing the
      push. Prove the fallback with the gate/hook test suite.
- [ ] The one-time setup is documented well enough to follow without this
      sprint's context.
- [ ] End-to-end mint is either performed and recorded, or explicitly reported
      as pending — never claimed without evidence.
- [ ] `pnpm test`, `pnpm test:hooks`, and `pnpm typecheck` clean.

## Out of scope
- Removing `/root/.docker/config.json` from fleet servers — sprint 320.
- The blue-green login task — sprint 317, which this composes with.
- Any GitHub App permission beyond `packages: read`.
- Replacing `gh` for non-registry uses (e.g. `gh` in other scripts).
