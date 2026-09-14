#!/usr/bin/env bash
# Tests for ansible/roles/nginx/files/ensure-cert-renewal.sh (sprint 335).
# Run: bash scripts/lib/ensure-cert-renewal.test.sh
#
# The script under test shells out to `certbot` directly (it runs standalone
# on a provisioned server, copied there by the nginx role — there's no
# sourceable -lib.sh companion the way other scripts/lib/*.sh suites have).
# So it's exercised as a subprocess here, with RENEWAL_DIR/WEBROOT_PATH
# pointed at a fixture directory and a fake `certbot` prepended onto PATH.
# The fake logs every invocation to CALL_LOG and, on `reconfigure`, rewrites
# the fixture's authenticator line the way real certbot would — so tests can
# assert on both "what was invoked" and "what the config now says".
set -uo pipefail

SCRIPT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/ansible/roles/nginx/files/ensure-cert-renewal.sh"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

BIN="$WORK/bin"
mkdir -p "$BIN"
CALL_LOG="$WORK/certbot-calls.log"

cat > "$BIN/certbot" <<'FAKE'
#!/usr/bin/env bash
set -uo pipefail
echo "$*" >> "$CALL_LOG"

case "$1" in
  --version)
    echo "certbot ${FAKE_CERTBOT_VERSION:-2.9.0}"
    exit 0
    ;;
  reconfigure)
    [[ "${FAKE_RECONFIGURE_RC:-0}" -eq 0 ]] || exit "${FAKE_RECONFIGURE_RC}"
    name=""
    prev=""
    for arg in "$@"; do
      [[ "$prev" == "--cert-name" ]] && name="$arg"
      prev="$arg"
    done
    if [[ -n "$name" && -f "$RENEWAL_DIR/$name.conf" ]]; then
      sed -i.bak 's/^authenticator = .*/authenticator = webroot/' "$RENEWAL_DIR/$name.conf"
      rm -f "$RENEWAL_DIR/$name.conf.bak"
    fi
    exit 0
    ;;
  renew)
    exit "${FAKE_RENEW_RC:-0}"
    ;;
  *)
    exit 1
    ;;
esac
FAKE
chmod +x "$BIN/certbot"

write_conf() {
  local dir="$1" name="$2" authenticator="$3"
  cat > "$dir/$name.conf" <<CONF
# renew_before_expiry = 30 days
version = 2.9.0
archive_dir = /etc/letsencrypt/archive/$name
cert = /etc/letsencrypt/live/$name/cert.pem

[renewalparams]
account = deadbeef
authenticator = $authenticator
installer = None
CONF
}

run_script() {
  local renewal_dir="$1"
  CALL_LOG="$CALL_LOG" RENEWAL_DIR="$renewal_dir" WEBROOT_PATH="/var/www/certbot" \
    FAKE_CERTBOT_VERSION="${FAKE_CERTBOT_VERSION:-}" \
    FAKE_RECONFIGURE_RC="${FAKE_RECONFIGURE_RC:-}" \
    FAKE_RENEW_RC="${FAKE_RENEW_RC:-}" \
    PATH="$BIN:$PATH" \
    bash "$SCRIPT"
}

authenticator_in() { grep -m1 '^authenticator = ' "$1" | sed 's/^authenticator = //'; }

# ── standalone converted via reconfigure, never forced renewal ──────────────
echo "standalone -> webroot"

CASE1="$WORK/case1"
mkdir -p "$CASE1"
write_conf "$CASE1" "example-com" "standalone"
> "$CALL_LOG"
FAKE_CERTBOT_VERSION="2.9.0" FAKE_RECONFIGURE_RC="" FAKE_RENEW_RC="" out=$(run_script "$CASE1")
rc=$?
check "exits 0 when conversion and dry-run both succeed" "$rc" "0"
check "authenticator rewritten to webroot" "$(authenticator_in "$CASE1/example-com.conf")" "webroot"
check "reconfigure invoked with --cert-name and --webroot" \
  "$(grep -c 'reconfigure --cert-name example-com --webroot --webroot-path /var/www/certbot' "$CALL_LOG")" "1"
check "forced renewal never used" "$(grep -c 'force-renewal' "$CALL_LOG")" "0"
check "stdout reports the conversion" "$(echo "$out" | grep -c 'example-com: converted to webroot')" "1"

# ── webroot, nginx, dns-cloudflare left byte-for-byte unchanged ─────────────
echo "non-standalone authenticators untouched"

CASE2="$WORK/case2"
mkdir -p "$CASE2"
write_conf "$CASE2" "webroot-site" "webroot"
write_conf "$CASE2" "nginx-site" "nginx"
write_conf "$CASE2" "dns-site" "dns-cloudflare"
before=$(cd "$CASE2" && shasum webroot-site.conf nginx-site.conf dns-site.conf)
> "$CALL_LOG"
FAKE_CERTBOT_VERSION="2.9.0" FAKE_RECONFIGURE_RC="" FAKE_RENEW_RC="" out=$(run_script "$CASE2")
rc=$?
after=$(cd "$CASE2" && shasum webroot-site.conf nginx-site.conf dns-site.conf)
check "exits 0, nothing to convert" "$rc" "0"
check "configs are byte-for-byte unchanged" "$after" "$before"
check "reconfigure never called for any of them" "$(grep -c 'reconfigure' "$CALL_LOG")" "0"
check "each authenticator reported as left untouched" \
  "$(echo "$out" | grep -c 'left untouched')" "3"

# ── certbot older than 2.3 refuses with manual instructions ─────────────────
echo "old certbot refused"

CASE3="$WORK/case3"
mkdir -p "$CASE3"
write_conf "$CASE3" "old-site" "standalone"
> "$CALL_LOG"
FAKE_CERTBOT_VERSION="2.2.0" FAKE_RECONFIGURE_RC="" FAKE_RENEW_RC="" out=$(run_script "$CASE3" 2>&1)
rc=$?
check "exits non-zero" "$rc" "1"
check "never attempts reconfigure on the old version" "$(grep -c 'reconfigure' "$CALL_LOG")" "0"
check "prints manual instructions naming certbot reconfigure" \
  "$(echo "$out" | grep -c 'Manually run: certbot reconfigure')" "1"
check "config left unconverted" "$(authenticator_in "$CASE3/old-site.conf")" "standalone"

# ── failing dry-run fails the script ─────────────────────────────────────────
echo "dry-run failure fails the script"

CASE4="$WORK/case4"
mkdir -p "$CASE4"
write_conf "$CASE4" "healthy-site" "webroot"
> "$CALL_LOG"
FAKE_CERTBOT_VERSION="2.9.0" FAKE_RECONFIGURE_RC="" FAKE_RENEW_RC="1" out=$(run_script "$CASE4" 2>&1)
rc=$?
check "exits non-zero when dry-run fails" "$rc" "1"
check "dry-run was actually invoked" "$(grep -c '^renew --dry-run$' "$CALL_LOG")" "1"
check "stderr explains the dry-run failure" \
  "$(echo "$out" | grep -c 'dry-run failed')" "1"

echo
echo "== $PASS passed, $FAIL failed =="
[[ $FAIL -eq 0 ]]
