import { describe, it, expect, vi } from 'vitest'
import { parseRunningImages, stripImageTag, verifyRunningImages, type RunningImage } from './deploy-verification.js'

vi.mock('@emit-infra/core', () => ({ sshExec: vi.fn() }))

const PREFIX = 'ghcr.io/develemit/'
const sha = 'abc1234'

// emit-vision after build 1528: web was built, api/worker/marketing were
// re-tagged and keep older build numbers — but every one has a sha tag whose
// digest is what the server pulled.
const digestFor = (image: string) => `sha256:${image.length.toString(16).padStart(64, '0')}`
const services = ['web', 'api', 'worker', 'marketing'].map((s) => `ghcr.io/develemit/vision-${s}`)
const running = (): RunningImage[] => services.map((image) => ({ image, digests: [digestFor(image)] }))
const registry = async (ref: string) => digestFor(ref.replace(`:${sha}`, ''))

describe('verifyRunningImages', () => {
  it('verifies 1 built + 3 re-tagged services regardless of their older build numbers', async () => {
    expect(await verifyRunningImages(running(), sha, PREFIX, registry)).toEqual({ status: 'verified' })
  })

  it('detects a container running a stale image, not the one pushed for the sha', async () => {
    const stale = running()
    stale[1] = { image: services[1]!, digests: ['sha256:' + 'f'.repeat(64)] }

    expect(await verifyRunningImages(stale, sha, PREFIX, registry)).toEqual({
      status: 'mismatch',
      mismatched: [services[1]],
    })
  })

  it('reports a mismatch even when another image is unresolvable', async () => {
    const probe = async (ref: string) => (ref.includes('worker') ? null : 'sha256:' + 'e'.repeat(64))
    const result = await verifyRunningImages(running(), sha, PREFIX, probe)
    expect(result.status).toBe('mismatch')
  })

  it('is unverified, not failed, when the registry digest cannot be resolved', async () => {
    const result = await verifyRunningImages(running(), sha, PREFIX, async () => null)
    expect(result.status).toBe('unverified')
  })

  it('is unverified when the server reports no repo digests for an image', async () => {
    const result = await verifyRunningImages([{ image: services[0]!, digests: [] }], sha, PREFIX, registry)
    expect(result.status).toBe('unverified')
  })

  it('is unverified when no running container uses an image from the registry', async () => {
    const result = await verifyRunningImages([{ image: 'postgres', digests: ['sha256:x'] }], sha, PREFIX, registry)
    expect(result.status).toBe('unverified')
  })

  it('ignores third-party images such as postgres alongside our own', async () => {
    const mixed = [...running(), { image: 'postgres', digests: ['sha256:' + '1'.repeat(64)] }]
    expect(await verifyRunningImages(mixed, sha, PREFIX, registry)).toEqual({ status: 'verified' })
  })
})

describe('parseRunningImages', () => {
  it('strips the tag and extracts digests from repo-digest lists', () => {
    const out = 'ghcr.io/develemit/vision-web:latest|ghcr.io/develemit/vision-web@sha256:aaa,ghcr.io/x/y@sha256:bbb\n'
    expect(parseRunningImages(out)).toEqual([{ image: 'ghcr.io/develemit/vision-web', digests: ['sha256:aaa', 'sha256:bbb'] }])
  })

  it('keeps an empty digest list when the image has no repo digests', () => {
    expect(parseRunningImages('ghcr.io/develemit/x:latest|\n')).toEqual([{ image: 'ghcr.io/develemit/x', digests: [] }])
  })
})

describe('stripImageTag', () => {
  it('leaves a registry port alone', () => {
    expect(stripImageTag('localhost:5000/app')).toBe('localhost:5000/app')
    expect(stripImageTag('localhost:5000/app:v1')).toBe('localhost:5000/app')
  })
})
