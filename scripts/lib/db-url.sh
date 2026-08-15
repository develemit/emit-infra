# db-url.sh — shell wrapper around `emit-infra db-url`.
#
# For consumers that can't do a TypeScript import (drizzle-kit's CJS-bundled
# config loader, an nx plugin's project-graph loader, a Makefile, a git hook)
# but can shell out. See sprint 276 for why a subprocess and not a shared
# module.
#
#   source "$HOME/projects/emit-infra/scripts/lib/db-url.sh"
#   DATABASE_URL=$(emit_db_url) || exit 1
#   emit_db_url_assert_identity --service db || exit 1

[[ -n "${_EMIT_DB_URL_LOADED:-}" ]] && return 0
_EMIT_DB_URL_LOADED=1

_emit_db_url_bin() {
  local dir="${EMIT_INFRA_DIR:-$HOME/projects/emit-infra}"
  echo "$dir/apps/cli/dist/index.js"
}

# Prints the resolved URL on stdout, nothing else; diagnostics go to stderr.
# Non-zero exit and empty stdout if the container isn't running.
emit_db_url() {
  node "$(_emit_db_url_bin)" db-url "$@"
}

# Same as emit_db_url but also connects and verifies the URL points at the
# expected database (per the compose file's POSTGRES_DB) before printing it.
emit_db_url_assert_identity() {
  node "$(_emit_db_url_bin)" db-url --assert-identity "$@"
}
