const REDACTED = '<redacted>'

// Matches token/secret/password/credential/key-shaped keys. "key" alone is
// too broad — it also matches reference/name fields like ssh_key_name and
// sshKeyName that hold a *name*, not a secret value — so any key that also
// contains "name" is treated as a reference and left alone even if it
// contains "key" too.
const SECRET_KEY_PATTERN = /token|secret|password|credential|key/i
const NAME_EXCEPTION_PATTERN = /name/i

function isSecretKey(key: string): boolean {
  return SECRET_KEY_PATTERN.test(key) && !NAME_EXCEPTION_PATTERN.test(key)
}

// Deep-clones a value, replacing secret-shaped values with a fixed marker so
// it can be printed for operator inspection (e.g. deploy --dry-run) without
// leaking credentials. Never mutates the input — the unredacted original
// still needs to reach the actual playbook.
//
// Whether a value gets redacted is decided by its *own* key, not its
// container's — e.g. r2_credentials itself matches "credential" but holds a
// mix of secret (R2_SECRET_ACCESS_KEY) and non-secret (CF_ACCOUNT_ID) leaves,
// so it is always recursed into rather than collapsed wholesale. That keeps
// non-secret values inside a secret-shaped container visible.
export function redactSecrets<T>(value: T): T {
  return redactValue(value, undefined) as T
}

function redactValue(value: unknown, key: string | undefined): unknown {
  if (Array.isArray(value)) {
    return value.map(v => redactValue(v, key))
  }

  if (value !== null && typeof value === 'object') {
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      result[k] = redactValue(v, k)
    }
    return result
  }

  if (key !== undefined && isSecretKey(key)) {
    return REDACTED
  }

  return value
}
