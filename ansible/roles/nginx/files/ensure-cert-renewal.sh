#!/usr/bin/env bash
# ensure-cert-renewal.sh — sprint 335.
#
# Converts any certbot renewal config using the `standalone` authenticator
# to `webroot`, via `certbot reconfigure` so no certificate is reissued
# (a forced renewal would risk Let's Encrypt's duplicate-certificate rate
# limit — see the sprint's "How to convert without reissuing a certificate").
# `standalone` starts its own listener on port 80, which nginx already
# holds, so every renewal using it silently fails — this is what let
# diner-decider's certificate expire on 2026-09-13. Every other
# authenticator (`webroot`, `nginx`, `dns-cloudflare`) already works
# alongside nginx and is left untouched.
#
# Finishes with `certbot renew --dry-run` so a renewal broken for any
# reason — not just a standalone authenticator — fails this script, and so
# the Ansible play that runs it, rather than failing silently at the next
# cron run.
#
# RENEWAL_DIR and WEBROOT_PATH are overridable via env for
# scripts/lib/ensure-cert-renewal.test.sh, which also stubs `certbot` on
# PATH — see that file for the fake certbot's contract.
set -uo pipefail

RENEWAL_DIR="${RENEWAL_DIR:-/etc/letsencrypt/renewal}"
WEBROOT_PATH="${WEBROOT_PATH:-/var/www/certbot}"
MIN_CERTBOT_VERSION="2.3"

failed=0

version_ge() {
  local version="$1" min="$2"
  [[ "$(printf '%s\n%s\n' "$min" "$version" | sort -V | head -n1)" == "$min" ]]
}

certbot_version() {
  certbot --version 2>&1 | grep -oE '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -n1
}

shopt -s nullglob
for conf in "$RENEWAL_DIR"/*.conf; do
  name="$(basename "$conf" .conf)"
  authenticator="$(grep -m1 '^authenticator *= *' "$conf" | sed 's/^authenticator *= *//' | tr -d '[:space:]')"

  if [[ "$authenticator" != "standalone" ]]; then
    echo "$name: authenticator=$authenticator, left untouched"
    continue
  fi

  version="$(certbot_version)"
  if [[ -z "$version" ]] || ! version_ge "$version" "$MIN_CERTBOT_VERSION"; then
    echo "$name: authenticator=standalone, certbot ${version:-unknown} is older than $MIN_CERTBOT_VERSION — cannot auto-convert." >&2
    echo "  Manually run: certbot reconfigure --cert-name $name --webroot --webroot-path $WEBROOT_PATH (requires certbot >= $MIN_CERTBOT_VERSION), or upgrade certbot first." >&2
    failed=1
    continue
  fi

  echo "$name: authenticator=standalone, converting to webroot via certbot reconfigure"
  if certbot reconfigure --cert-name "$name" --webroot --webroot-path "$WEBROOT_PATH" --non-interactive; then
    echo "$name: converted to webroot"
  else
    echo "$name: certbot reconfigure failed" >&2
    failed=1
  fi
done
shopt -u nullglob

echo "Running certbot renew --dry-run to confirm every renewal config actually works"
if ! certbot renew --dry-run; then
  echo "certbot renew --dry-run failed — at least one renewal is broken" >&2
  failed=1
fi

[[ "$failed" -eq 1 ]] && exit 1
exit 0
