#!/usr/bin/env bash
# Tests for scripts/lib/ghcr-prune-lib.sh. Run: bash scripts/lib/ghcr-prune.test.sh
set -uo pipefail

LIB="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/ghcr-prune-lib.sh"
source "$LIB"

PASS=0
FAIL=0

ok() { PASS=$((PASS + 1)); echo "  ok   $1"; }
no() { FAIL=$((FAIL + 1)); echo "  FAIL $1"; }
check() { if [[ "$2" == "$3" ]]; then ok "$1"; else no "$1 (want '$3', got '$2')"; fi; }

# _ghcrprune_select_prune_ids reads JSONL (one version object per line) to
# match what `gh api --paginate --jq '.[]'` emits; fixtures below are written
# as plain JSON arrays for readability and converted here.
to_jsonl() { jq -c '.[]' <<< "$1"; }

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# ── _ghcrprune_read_deployed_sha ──────────────────────────────────────────────
echo "_ghcrprune_read_deployed_sha"

check "missing file -> empty, no error" \
  "$(_ghcrprune_read_deployed_sha "$WORK/nope.json"; echo "rc=$?")" "rc=0"

printf '{"status":"deployed","sha":"abc111"}\n' > "$WORK/deployed.json"
check "status deployed -> its sha" "$(_ghcrprune_read_deployed_sha "$WORK/deployed.json")" "abc111"

printf '{"status":"deploying","sha":"bbb222"}\n' > "$WORK/deploying.json"
check "status deploying -> empty" "$(_ghcrprune_read_deployed_sha "$WORK/deploying.json")" ""

echo 'not json' > "$WORK/bad.json"
_ghcrprune_read_deployed_sha "$WORK/bad.json" >/dev/null 2>&1
[[ $? -eq 2 ]] && ok "malformed JSON -> rc 2" || no "malformed JSON -> rc 2"

# ── _ghcrprune_collect_deployed_shas ──────────────────────────────────────────
echo "_ghcrprune_collect_deployed_shas"

PROJ="$WORK/projects"
mkdir -p "$PROJ/never-deployed" "$PROJ/proj-a" "$PROJ/proj-b"
printf '{"status":"deployed","sha":"sha-a"}\n' > "$PROJ/proj-a/.deploy-status.json"
printf '{"status":"deployed","sha":"sha-b"}\n' > "$PROJ/proj-b/.deploy-status.json"

got=$(_ghcrprune_collect_deployed_shas "$PROJ" | sort)
check "collects shas from every project, skips never-deployed" "$got" "$(printf 'sha-a\nsha-b')"

EMPTY_PROJ="$WORK/empty-projects"
mkdir -p "$EMPTY_PROJ/never-deployed"
check "no deploy-status files anywhere -> empty, not a failure" \
  "$(_ghcrprune_collect_deployed_shas "$EMPTY_PROJ"; echo "rc=$?")" "rc=0"

mkdir -p "$PROJ/proj-c"
echo 'not json' > "$PROJ/proj-c/.deploy-status.json"
_ghcrprune_collect_deployed_shas "$PROJ" >/dev/null 2>&1
[[ $? -eq 1 ]] && ok "one malformed status file fails the whole collection" \
  || no "one malformed status file fails the whole collection"

# ── _ghcrprune_select_prune_ids ───────────────────────────────────────────────
echo "_ghcrprune_select_prune_ids"

# 11 non-protected tagged releases (id2..id12, newest first — id12 is the
# 11th and falls past the keep-10 budget), plus a "latest"-tagged version,
# a deployed-sha-tagged old version, a "latest-migrate"-tagged old version,
# and two untagged manifests straddling the retained cutoff (id11 @ 09-02).
FIXTURE=$(cat <<'JSON'
[
  {"id": 1,  "created_at": "2026-09-12T00:00:00Z", "metadata": {"container": {"tags": ["112", "latest"]}}},
  {"id": 2,  "created_at": "2026-09-11T00:00:00Z", "metadata": {"container": {"tags": ["111"]}}},
  {"id": 3,  "created_at": "2026-09-10T00:00:00Z", "metadata": {"container": {"tags": ["110"]}}},
  {"id": 4,  "created_at": "2026-09-09T00:00:00Z", "metadata": {"container": {"tags": ["109"]}}},
  {"id": 5,  "created_at": "2026-09-08T00:00:00Z", "metadata": {"container": {"tags": ["108"]}}},
  {"id": 6,  "created_at": "2026-09-07T00:00:00Z", "metadata": {"container": {"tags": ["107"]}}},
  {"id": 7,  "created_at": "2026-09-06T00:00:00Z", "metadata": {"container": {"tags": ["106"]}}},
  {"id": 8,  "created_at": "2026-09-05T00:00:00Z", "metadata": {"container": {"tags": ["105"]}}},
  {"id": 9,  "created_at": "2026-09-04T00:00:00Z", "metadata": {"container": {"tags": ["104"]}}},
  {"id": 10, "created_at": "2026-09-03T00:00:00Z", "metadata": {"container": {"tags": ["103"]}}},
  {"id": 11, "created_at": "2026-09-02T00:00:00Z", "metadata": {"container": {"tags": ["102"]}}},
  {"id": 12, "created_at": "2026-08-25T00:00:00Z", "metadata": {"container": {"tags": ["101"]}}},
  {"id": 20, "created_at": "2026-08-20T00:00:00Z", "metadata": {"container": {"tags": ["deployed-sha-value"]}}},
  {"id": 21, "created_at": "2026-08-19T00:00:00Z", "metadata": {"container": {"tags": ["1248-migrate", "latest-migrate"]}}},
  {"id": 30, "created_at": "2026-09-05T12:00:00Z", "metadata": {"container": {"tags": []}}},
  {"id": 31, "created_at": "2026-08-01T00:00:00Z", "metadata": {"container": {"tags": []}}}
]
JSON
)

got=$(to_jsonl "$FIXTURE" | _ghcrprune_select_prune_ids 10 "deployed-sha-value" | sort -n | tr '\n' ',')
check "keeps 10 newest tagged, protects latest/latest-migrate/deployed sha, never touches untagged" \
  "$got" "12,"

got=$(to_jsonl "$FIXTURE" | _ghcrprune_select_prune_ids 10 "deployed-sha-value" | grep -c '^20$' || true)
check "deployed-sha-tagged version is never selected" "$got" "0"

got=$(to_jsonl "$FIXTURE" | _ghcrprune_select_prune_ids 10 "deployed-sha-value" | grep -c '^21$' || true)
check "latest-migrate-tagged version is never selected" "$got" "0"

got=$(to_jsonl "$FIXTURE" | _ghcrprune_select_prune_ids 10 "deployed-sha-value" | grep -c '^30$' || true)
check "untagged version newer than the retained cutoff is kept" "$got" "0"

got=$(to_jsonl "$FIXTURE" | _ghcrprune_select_prune_ids 10 "deployed-sha-value" | grep -c '^31$' || true)
check "untagged version older than the retained cutoff is also kept (never deleted)" "$got" "0"

# Regression for the resume-diagnosis bug: a retained tagged version (578,
# kept because it's within the keep-10 budget) has a referenced untagged
# platform manifest (id 578000) created a moment earlier, landing below what
# would have been the old time-based cutoff. It must never be selected —
# proving "unreferenced" isn't attempted, so untagged is left alone entirely.
REFERENCED_SIBLING=$(cat <<'JSON'
[
  {"id": 578, "created_at": "2026-08-01T21:50:20Z", "metadata": {"container": {"tags": ["578"]}}},
  {"id": 578001, "created_at": "2026-08-01T21:50:19Z", "metadata": {"container": {"tags": ["578-migrate"]}}},
  {"id": 578000, "created_at": "2026-08-01T21:50:18Z", "metadata": {"container": {"tags": []}}}
]
JSON
)
got=$(to_jsonl "$REFERENCED_SIBLING" | _ghcrprune_select_prune_ids 10)
check "referenced untagged sibling of a retained tagged version is never selected" "$got" ""

# All tagged versions protected -> no untagged version deleted either.
NO_RELEASES=$(cat <<'JSON'
[
  {"id": 1, "created_at": "2026-09-12T00:00:00Z", "metadata": {"container": {"tags": ["latest"]}}},
  {"id": 2, "created_at": "2026-01-01T00:00:00Z", "metadata": {"container": {"tags": []}}}
]
JSON
)
got=$(to_jsonl "$NO_RELEASES" | _ghcrprune_select_prune_ids 10)
check "no retained tagged release -> untagged left untouched" "$got" ""

# Untagged versions never counted toward the keep budget: 10 tagged releases
# plus one untagged manifest newer than all of them still keeps every release.
UNTAGGED_BUDGET=$(python3 -c '
import json
versions = [{"id": 100, "created_at": "2026-09-13T00:00:00Z", "metadata": {"container": {"tags": []}}}]
for i in range(10):
    versions.append({"id": i, "created_at": f"2026-09-{i+1:02d}T00:00:00Z", "metadata": {"container": {"tags": [str(i)]}}})
print(json.dumps(versions))
')
got=$(to_jsonl "$UNTAGGED_BUDGET" | _ghcrprune_select_prune_ids 10)
check "untagged manifest does not consume the keep budget" "$got" ""

# Empty/failed protection set: caller passes no protected shas at all — the
# "latest"/"latest-*" exemption still holds on its own (protection absence
# doesn't change ordinary keep-N behaviour; the ghcr-prune.sh wrapper is what
# refuses to run at all when the lookup itself fails or comes back empty).
got=$(to_jsonl "$FIXTURE" | _ghcrprune_select_prune_ids 10)
check "no protected shas -> latest kept" "$(echo "$got" | grep -c '^1$' || true)" "0"
check "no protected shas -> latest-migrate kept" "$(echo "$got" | grep -c '^21$' || true)" "0"

# ── _ghcrprune_has_delete_scope ───────────────────────────────────────────────
echo "_ghcrprune_has_delete_scope"

REAL_TOKEN_SCOPES="  - Token scopes: 'gist', 'read:org', 'repo', 'user', 'workflow', 'write:packages'"
if _ghcrprune_has_delete_scope "$REAL_TOKEN_SCOPES"; then
  no "today's real token text (no delete:packages) -> false"
else
  ok "today's real token text (no delete:packages) -> false"
fi

WITH_SCOPE="  - Token scopes: 'delete:packages', 'repo', 'write:packages'"
if _ghcrprune_has_delete_scope "$WITH_SCOPE"; then
  ok "token text with delete:packages -> true"
else
  no "token text with delete:packages -> true"
fi

# ── _ghcrprune_delete_one / _ghcrprune_delete_ids ─────────────────────────────
echo "_ghcrprune_delete_ids"

# Fakes stand in for _ghcrprune_delete_one so no live `gh api` call is ever
# made here — see the doc comment on _ghcrprune_delete_one in the lib.
_ghcrprune_delete_one() { return 0; }
got=$(_ghcrprune_delete_ids base pkg 1 2 3)
check "all succeed -> 3 deleted, 0 failed, not auth-stopped" "$got" "3 0 0"

_ghcrprune_delete_one() {
  local id="$3"
  [[ "$id" == "2" ]] && return 1
  return 0
}
got=$(_ghcrprune_delete_ids base pkg 1 2 3)
check "one ordinary failure -> counted as failed, not deleted" "$got" "2 1 0"

_ghcrprune_delete_one() {
  local id="$3"
  [[ "$id" == "1" ]] && return 0
  [[ "$id" == "2" ]] && return 2
  return 0
}
got=$(_ghcrprune_delete_ids base pkg 1 2 3)
check "auth failure stops the run: 1 deleted before it, 1 failed, auth-stopped" \
  "$got" "1 1 1"

_ghcrprune_delete_one() {
  local id="$3"
  [[ "$id" == "1" ]] && return 2
  CALLS=$((CALLS + 1))
  return 0
}
CALLS=0
_ghcrprune_delete_ids base pkg 1 2 3 >/dev/null
check "auth failure on the first id never touches the remaining ids" "$CALLS" "0"

# ── _ghcrprune_discover_packages ──────────────────────────────────────────────
echo "_ghcrprune_discover_packages"

FLEET="$WORK/fleet"
mkdir -p "$FLEET/prefix-style" "$FLEET/repo-style" "$FLEET/repo-fallback" \
  "$FLEET/no-services" "$FLEET/unparseable" "$FLEET/has-variants"

# prefix-style naming: ci.imagePrefix wins even though ghcrRepo would also resolve.
cat > "$FLEET/prefix-style/.emit-infra.json" <<'JSON'
{"ci": {"ghcrOrg": "develemit", "imagePrefix": "widget-"},
 "github": {"repo": "develemit/widget"},
 "blueGreen": {"services": [{"name": "web"}, {"name": "api"}]}}
JSON

# repo-style naming (tastease's shape): no imagePrefix, explicit ghcrRepo.
cat > "$FLEET/repo-style/.emit-infra.json" <<'JSON'
{"ci": {"ghcrOrg": "develemit", "ghcrRepo": "gadget"},
 "github": {"repo": "develemit/gadget-monorepo"},
 "blueGreen": {"services": [{"name": "api"}, {"name": "web"}]}}
JSON

# ghcrRepo omitted entirely -> falls back to the last segment of github.repo.
cat > "$FLEET/repo-fallback/.emit-infra.json" <<'JSON'
{"ci": {"ghcrOrg": "develemit"},
 "github": {"repo": "develemit/gizmo"},
 "blueGreen": {"services": [{"name": "api"}]}}
JSON

# No blueGreen.services declared at all -> skipped, not treated as "nothing to keep".
cat > "$FLEET/no-services/.emit-infra.json" <<'JSON'
{"ci": {"ghcrOrg": "develemit"}, "github": {"repo": "develemit/no-services"}}
JSON

# Unparseable config -> skipped with a warning, rest of the fleet still discovered.
echo 'not json' > "$FLEET/unparseable/.emit-infra.json"

# Build variants are a tag suffix on an existing service, never an extra package.
cat > "$FLEET/has-variants/.emit-infra.json" <<'JSON'
{"ci": {"ghcrOrg": "develemit", "imagePrefix": "thing-",
        "buildVariants": {"api": [{"target": "migrate", "tagSuffix": "-migrate"}]}},
 "github": {"repo": "develemit/thing"},
 "blueGreen": {"services": [{"name": "api"}]}}
JSON

got=$(_ghcrprune_discover_packages "$FLEET" 2>/dev/null | sort)
want=$(printf 'develemit\tgadget/api\ndevelemit\tgadget/web\ndevelemit\tgizmo/api\ndevelemit\tthing-api\ndevelemit\twidget-api\ndevelemit\twidget-web' | sort)
check "prefix-style, repo-style, repo-fallback, and variant-bearing projects all resolve correctly" "$got" "$want"

check "prefix-style naming wins over ghcrRepo fallback" \
  "$(_ghcrprune_discover_packages "$FLEET" 2>/dev/null | grep -c 'widget-api\|widget-web')" "2"

check "repo-style naming produces <ghcrRepo>/<service>, not a prefix" \
  "$(_ghcrprune_discover_packages "$FLEET" 2>/dev/null | grep -c 'gadget/api\|gadget/web')" "2"

check "ghcrRepo falls back to the last segment of github.repo" \
  "$(_ghcrprune_discover_packages "$FLEET" 2>/dev/null | grep -c 'gizmo/api')" "1"

check "build variants add no extra package (only 'thing-api', never 'thing-api-migrate')" \
  "$(_ghcrprune_discover_packages "$FLEET" 2>/dev/null | grep -c '^develemit\tthing-api$')" "1"

warnings=$(_ghcrprune_discover_packages "$FLEET" 2>&1 >/dev/null)
check "a project with no services declared is skipped with a warning" \
  "$(echo "$warnings" | grep -c 'no-services.*no blueGreen.services')" "1"
check "an unparseable config is skipped with a warning" \
  "$(echo "$warnings" | grep -c 'unparseable.*could not be parsed')" "1"

check "unparseable/no-services projects never appear in discovery output" \
  "$(_ghcrprune_discover_packages "$FLEET" 2>/dev/null | grep -c 'no-services\|unparseable')" "0"

echo
echo "== $PASS passed, $FAIL failed =="
[[ $FAIL -eq 0 ]]
