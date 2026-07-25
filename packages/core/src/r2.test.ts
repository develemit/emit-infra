import { describe, it, expect, vi, afterEach } from 'vitest'
import { createHash } from 'node:crypto'
import {
  r2BucketResource,
  deriveR2Credentials,
  buildR2TokenPayload,
  createR2Token,
  revokeR2Token,
  R2_ITEM_READ_PERMISSION_GROUP,
  R2_ITEM_WRITE_PERMISSION_GROUP,
} from './r2.js'

const ACCT = '7e4b2450c19be910c9edb8b06fee5172'
const BUCKET = 'diner-decider-photos'

afterEach(() => vi.unstubAllGlobals())

describe('r2BucketResource', () => {
  it('includes the _default_ jurisdiction segment', () => {
    expect(r2BucketResource(ACCT, BUCKET)).toBe(
      `com.cloudflare.edge.r2.bucket.${ACCT}_default_${BUCKET}`,
    )
  })

  it('does not produce the legacy jurisdiction-less form', () => {
    // The old form was accepted by the API but granted nothing usable.
    expect(r2BucketResource(ACCT, BUCKET)).not.toBe(
      `com.cloudflare.edge.r2.bucket.${ACCT}_${BUCKET}`,
    )
  })
})

describe('deriveR2Credentials', () => {
  it('uses the token id as the access key id', () => {
    expect(deriveR2Credentials('tok-id', 'tok-value').accessKeyId).toBe('tok-id')
  })

  it('derives the secret as sha256 hex of the token value', () => {
    const expected = createHash('sha256').update('tok-value').digest('hex')
    const { secretAccessKey } = deriveR2Credentials('tok-id', 'tok-value')
    expect(secretAccessKey).toBe(expected)
    expect(secretAccessKey).toHaveLength(64)
  })

  it('is deterministic for the same value', () => {
    expect(deriveR2Credentials('a', 'v').secretAccessKey).toBe(deriveR2Credentials('b', 'v').secretAccessKey)
  })
})

describe('buildR2TokenPayload', () => {
  it('scopes the policy to exactly one bucket, never the whole account', () => {
    const payload = buildR2TokenPayload(ACCT, BUCKET) as {
      policies: { resources: Record<string, string>; permission_groups: { id: string }[] }[]
    }
    const resources = Object.keys(payload.policies[0]!.resources)
    expect(resources).toEqual([r2BucketResource(ACCT, BUCKET)])
    expect(resources.some(r => r.includes('com.cloudflare.api.account'))).toBe(false)
  })

  it('grants only R2 bucket item read + write', () => {
    const payload = buildR2TokenPayload(ACCT, BUCKET) as {
      policies: { permission_groups: { id: string }[] }[]
    }
    const ids = payload.policies[0]!.permission_groups.map(g => g.id).sort()
    expect(ids).toEqual([R2_ITEM_WRITE_PERMISSION_GROUP, R2_ITEM_READ_PERMISSION_GROUP].sort())
  })
})

describe('createR2Token', () => {
  it('POSTs to the account-owned tokens endpoint, not /r2/tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, errors: [], result: { id: 'tid', value: 'tval' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await createR2Token(ACCT, BUCKET, 'cf-token')

    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/tokens`)
    expect(url).not.toContain('/r2/tokens')
  })

  it('returns credentials derived from the {id, value} response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, errors: [], result: { id: 'tid', value: 'tval' } }),
    }))

    const res = await createR2Token(ACCT, BUCKET, 'cf-token')

    expect(res.tokenId).toBe('tid')
    expect(res.accessKeyId).toBe('tid')
    expect(res.secretAccessKey).toBe(createHash('sha256').update('tval').digest('hex'))
  })

  it('throws when the response lacks a token value', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ success: true, errors: [], result: { id: 'tid' } }),
    }))

    await expect(createR2Token(ACCT, BUCKET, 'cf-token')).rejects.toThrow(/missing id or value/)
  })
})

describe('revokeR2Token', () => {
  it('DELETEs under /accounts/{id}/tokens, not /user/tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)

    const ok = await revokeR2Token(ACCT, 'cf-token', 'tid')

    expect(ok).toBe(true)
    const url = fetchMock.mock.calls[0]![0] as string
    expect(url).toBe(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/tokens/tid`)
    expect(url).not.toContain('/user/tokens')
    expect((fetchMock.mock.calls[0]![1] as { method: string }).method).toBe('DELETE')
  })

  it('returns false and logs rather than throwing when revocation fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({ success: false, errors: [{ code: 1000, message: 'nope' }] }),
    }))
    const logs: string[] = []

    expect(await revokeR2Token(ACCT, 'cf-token', 'tid', m => logs.push(m))).toBe(false)
    expect(logs.join()).toMatch(/failed to revoke/i)
  })
})
