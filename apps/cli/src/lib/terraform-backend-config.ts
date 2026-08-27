/**
 * Keys `terraform/backend.tf` already hardcodes (see `setup.ts`'s
 * `backendTf` template) — passing these again via `-backend-config` is at
 * best redundant and at worst a duplicate-argument error.
 */
const BACKEND_TF_MANAGED_KEYS = new Set([
  'bucket',
  'key',
  'region',
  'endpoint',
  'skip_credentials_validation',
  'skip_metadata_api_check',
  'skip_region_validation',
  'skip_requesting_account_id',
  'force_path_style',
])

/** emit-infra's own bookkeeping in the cred file — not a Terraform S3-backend argument. */
const BOOKKEEPING_KEYS = new Set(['token_id'])

const REQUIRED_KEYS = ['access_key', 'secret_key']

/**
 * Parses `terraform-backend.env`'s `key=value` lines. The file is not HCL —
 * feeding it straight to `-backend-config=<path>` (the pre-sprint-318 bug)
 * makes Terraform parse it as HCL and choke on the unquoted endpoint URL.
 */
export function parseTerraformBackendCredFile(content: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = content.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)

  for (const line of lines) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!match) {
      throw new Error(
        `Malformed line in terraform-backend.env: "${line}" (expected key=value)`,
      )
    }
    result[match[1]!] = match[2]!
  }

  return result
}

/**
 * Builds discrete `-backend-config=k=v` args from a stored credential file,
 * excluding bookkeeping (`token_id`) and anything `backend.tf` already sets.
 * Matches how `setup.ts` invokes `terraform init` so the two paths can't
 * drift apart again.
 */
export function buildBackendConfigArgs(content: string): string[] {
  const parsed = parseTerraformBackendCredFile(content)

  const missing = REQUIRED_KEYS.filter((key) => !parsed[key])
  if (missing.length > 0) {
    throw new Error(
      `terraform-backend.env is missing required key(s): ${missing.join(', ')}`,
    )
  }

  return Object.entries(parsed)
    .filter(([key]) => !BOOKKEEPING_KEYS.has(key) && !BACKEND_TF_MANAGED_KEYS.has(key))
    .map(([key, value]) => `-backend-config=${key}=${value}`)
}
