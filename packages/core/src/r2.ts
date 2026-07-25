import { createHash } from 'node:crypto'

const CF_API = 'https://api.cloudflare.com/client/v4'

/**
 * R2 bucket-scoped permission groups. Verified live against
 * `GET /accounts/{id}/tokens/permission_groups` on 2026-07-24 — re-check there
 * if token creation starts failing, since these are opaque Cloudflare IDs.
 */
export const R2_ITEM_WRITE_PERMISSION_GROUP = '2efd5506f9c8494dacb1fa10a3e7d5b6'
export const R2_ITEM_READ_PERMISSION_GROUP = '6a018a9f2fc74eb6b293b0c548f38b39'

/**
 * Resource string identifying a single R2 bucket in a token policy. The
 * `_default_` segment is the jurisdiction and is required — omitting it yields a
 * policy Cloudflare accepts but that grants nothing usable.
 */
export function r2BucketResource(accountId: string, bucketName: string): string {
  return `com.cloudflare.edge.r2.bucket.${accountId}_default_${bucketName}`
}

/**
 * S3-compatible credentials are derived from an account-owned API token, not
 * returned directly: the access key id is the token id, and the secret is the
 * SHA-256 of the token's `value` (which Cloudflare returns only at creation).
 */
export function deriveR2Credentials(
  tokenId: string,
  tokenValue: string,
): { accessKeyId: string; secretAccessKey: string } {
  return {
    accessKeyId: tokenId,
    secretAccessKey: createHash('sha256').update(tokenValue).digest('hex'),
  }
}

export function buildR2TokenPayload(accountId: string, bucketName: string): Record<string, unknown> {
  return {
    name: `emit-infra-${bucketName}`,
    policies: [
      {
        effect: 'allow',
        resources: { [r2BucketResource(accountId, bucketName)]: '*' },
        permission_groups: [
          { id: R2_ITEM_WRITE_PERMISSION_GROUP },
          { id: R2_ITEM_READ_PERMISSION_GROUP },
        ],
      },
    ],
  }
}

interface CfResponse<T> {
  result: T
  success: boolean
  errors: { code: number; message: string }[]
}

async function cfFetch<T>(path: string, apiToken: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${CF_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  })

  const body = (await res.json()) as CfResponse<T>

  if (!res.ok && res.status !== 409) {
    const msgs = body.errors?.map((e) => `${e.code}: ${e.message}`).join(', ') ?? res.statusText
    throw new Error(`Cloudflare API error ${res.status} — ${msgs}`)
  }

  return body.result
}

export async function resolveAccountId(apiToken: string): Promise<string> {
  const accounts = await cfFetch<{ id: string }[]>('/accounts?per_page=1', apiToken)
  const id = accounts?.[0]?.id
  if (!id) throw new Error('No Cloudflare accounts found for this API token')
  return id
}

export async function resolveZoneId(domain: string, apiToken: string): Promise<string> {
  const zones = await cfFetch<{ id: string; name: string }[]>(`/zones?name=${encodeURIComponent(domain)}&per_page=1`, apiToken)
  const id = zones?.[0]?.id
  if (!id) throw new Error(`No Cloudflare zone found for domain "${domain}" — check the domain is in your account`)
  return id
}

export async function ensureR2Bucket(accountId: string, bucketName: string, apiToken: string): Promise<void> {
  const checkRes = await fetch(`${CF_API}/accounts/${accountId}/r2/buckets/${bucketName}`, {
    headers: { Authorization: `Bearer ${apiToken}` },
  })

  if (checkRes.ok) return

  if (checkRes.status !== 404) {
    const body = (await checkRes.json()) as CfResponse<unknown>
    const msgs = body.errors?.map((e) => `${e.code}: ${e.message}`).join(', ') ?? checkRes.statusText
    throw new Error(`Cloudflare API error ${checkRes.status} checking bucket — ${msgs}`)
  }

  const createRes = await fetch(`${CF_API}/accounts/${accountId}/r2/buckets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: bucketName }),
  })

  if (!createRes.ok && createRes.status !== 409) {
    const body = (await createRes.json()) as CfResponse<unknown>
    const msgs = body.errors?.map((e) => `${e.code}: ${e.message}`).join(', ') ?? createRes.statusText
    throw new Error(`Cloudflare API error ${createRes.status} creating bucket — ${msgs}`)
  }
}

export async function createR2Token(
  accountId: string,
  bucketName: string,
  apiToken: string,
): Promise<{ tokenId: string; accessKeyId: string; secretAccessKey: string }> {
  // Account-owned tokens, NOT /r2/tokens — that route does not exist and
  // returns 404 "no route matches this url".
  const result = await cfFetch<{ id: string; value: string }>(
    `/accounts/${accountId}/tokens`,
    apiToken,
    { method: 'POST', body: JSON.stringify(buildR2TokenPayload(accountId, bucketName)) },
  )

  if (!result?.id || !result?.value) {
    throw new Error('R2 token creation succeeded but response missing id or value')
  }

  return { tokenId: result.id, ...deriveR2Credentials(result.id, result.value) }
}

/**
 * Tokens minted by `createR2Token` are account-owned, so they must be deleted
 * under /accounts/{id}/tokens — /user/tokens silently fails for them, which
 * meant rotation never actually revoked the credential it replaced.
 */
export async function revokeR2Token(
  accountId: string,
  apiToken: string,
  tokenId: string,
  logger?: (msg: string) => void,
): Promise<boolean> {
  try {
    const res = await fetch(`${CF_API}/accounts/${accountId}/tokens/${tokenId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!res.ok) {
      const body = (await res.json()) as CfResponse<unknown>
      const msgs = body.errors?.map((e) => `${e.code}: ${e.message}`).join(', ') ?? res.statusText
      logger?.(`Warning: failed to revoke R2 token ${tokenId}: ${msgs}`)
      return false
    }

    return true
  } catch (err) {
    logger?.(`Warning: failed to revoke R2 token ${tokenId}: ${err instanceof Error ? err.message : String(err)}`)
    return false
  }
}
