import { execa } from 'execa'

export type ProbeResult = 'exists' | 'missing' | 'unknown'

export type PreflightResult =
  | { status: 'ok' }
  | { status: 'missing'; missing: string[] }
  | { status: 'skipped'; reason: string }

export type ImageProbe = (ref: string) => Promise<ProbeResult>

const MISSING_PATTERN = /no such manifest|manifest unknown|not found/i

// Only a registry "no such manifest" answer counts as missing. Auth failures,
// a missing docker binary and network errors are all 'unknown' — an auth quirk
// on a dev machine must not block a deploy the post-hoc check still backstops.
export const dockerManifestProbe: ImageProbe = async (ref) => {
  try {
    await execa('docker', ['manifest', 'inspect', ref], { timeout: 30_000 })
    return 'exists'
  } catch (err) {
    const stderr = (err as { stderr?: string }).stderr ?? ''
    return MISSING_PATTERN.test(stderr) ? 'missing' : 'unknown'
  }
}

export async function checkImagesExist(
  images: string[],
  sha: string,
  probe: ImageProbe = dockerManifestProbe,
): Promise<PreflightResult> {
  const results = await Promise.all(images.map(async (image) => ({ image, result: await probe(`${image}:${sha}`) })))

  const missing = results.filter((r) => r.result === 'missing').map((r) => `${r.image}:${sha}`)
  if (missing.length > 0) return { status: 'missing', missing }

  const unknown = results.filter((r) => r.result === 'unknown')
  if (unknown.length > 0) {
    return {
      status: 'skipped',
      reason: `could not query ghcr.io for ${unknown.length} of ${images.length} image(s) — is docker installed and logged in to ghcr.io?`,
    }
  }
  return { status: 'ok' }
}
