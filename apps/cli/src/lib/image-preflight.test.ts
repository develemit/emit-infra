import { describe, it, expect, vi } from 'vitest'
import { checkImagesExist, type ImageProbe } from './image-preflight.js'

const images = ['ghcr.io/o/p-web', 'ghcr.io/o/p-api']

describe('checkImagesExist', () => {
  it('probes <image>:<sha> for every image and returns ok when all exist', async () => {
    const probe = vi.fn<ImageProbe>().mockResolvedValue('exists')
    expect(await checkImagesExist(images, 'abc', probe)).toEqual({ status: 'ok' })
    expect(probe).toHaveBeenCalledWith('ghcr.io/o/p-web:abc')
    expect(probe).toHaveBeenCalledWith('ghcr.io/o/p-api:abc')
  })

  it('names every missing image', async () => {
    const probe: ImageProbe = async (ref) => (ref.includes('p-api') ? 'missing' : 'exists')
    expect(await checkImagesExist(images, 'abc', probe)).toEqual({ status: 'missing', missing: ['ghcr.io/o/p-api:abc'] })
  })

  it('skips with a reason when the registry cannot be queried', async () => {
    const result = await checkImagesExist(images, 'abc', async () => 'unknown')
    expect(result).toMatchObject({ status: 'skipped' })
  })

  it('reports missing even when another probe was inconclusive', async () => {
    const probe: ImageProbe = async (ref) => (ref.includes('p-web') ? 'unknown' : 'missing')
    expect(await checkImagesExist(images, 'abc', probe)).toEqual({ status: 'missing', missing: ['ghcr.io/o/p-api:abc'] })
  })
})
