const CF_API = 'https://api.cloudflare.com/client/v4'

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
): Promise<{ accessKeyId: string; secretAccessKey: string }> {
  const result = await cfFetch<{ accessKeyId: string; secretAccessKey: string }>(
    `/accounts/${accountId}/r2/tokens`,
    apiToken,
    {
      method: 'POST',
      body: JSON.stringify({
        name: `emit-infra-${bucketName}`,
        policies: [
          {
            effect: 'allow',
            resources: {
              [`com.cloudflare.edge.r2.bucket.${accountId}_${bucketName}`]: '*',
            },
            permission_groups: [
              { id: '2efd5506f9c8494dacb1fa10a3e7d5b8', name: 'Workers R2 Storage Bucket Item Write' },
              { id: '6a018a9f2fc74eb6b293b0c548f08ef1', name: 'Workers R2 Storage Bucket Item Read' },
            ],
          },
        ],
      }),
    },
  )

  if (!result?.accessKeyId || !result?.secretAccessKey) {
    throw new Error('R2 token creation succeeded but response missing accessKeyId or secretAccessKey')
  }

  return { accessKeyId: result.accessKeyId, secretAccessKey: result.secretAccessKey }
}
