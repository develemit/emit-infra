// Allowlist, not a denylist. scripts/hooks/pre-push's `run_ci` adds nothing
// to the environment before running CI targets — so replicating "what the
// hook leaves it as" means starting from nothing and keeping only what a
// shell needs to locate and run node/pnpm/nx. Unsetting a hand-picked list
// of known-bad vars (CLAUDECODE, TURBOPACK, DATABASE_URL, ...) only catches
// leaks someone already knows about — sprint 295's dashboard build broke on
// exactly that gap (TURBOPACK was missed by the first pass's `env -u
// TURBOPACK` fix because the fix's own verification ran under `env -u
// TURBOPACK`, hiding the thing it needed to prove immune to). An allowlist
// drops the next unknown leak by construction, not by memory.
const ALLOWED_ENV_KEYS = [
  'PATH',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'TMPDIR',
  'TMP',
  'TEMP',
]

export function scrubbedHookEnv(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const scrubbed: NodeJS.ProcessEnv = {}
  for (const key of ALLOWED_ENV_KEYS) {
    const value = source[key]
    if (value !== undefined) scrubbed[key] = value
  }
  return scrubbed
}
