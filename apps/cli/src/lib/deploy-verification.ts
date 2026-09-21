import { execa } from 'execa'
import { sshExec } from '@emit-infra/core'

export type VerificationResult =
  | { status: 'verified' }
  | { status: 'mismatch'; mismatched: string[] }
  | { status: 'unverified'; reason: string }

export interface RunningImage {
  image: string
  digests: string[]
}

// Registry manifest digest of a ref, or null when it can't be resolved.
export type RegistryDigestProbe = (ref: string) => Promise<string | null>

// Re-tagged images keep the build number they were built in, so a per-image
// build label can't be compared to the deploy's build number. Instead, prove
// each running container is the image pushed for this sha: the registry digest
// of `<image>:<sha>` must be among the digests the server pulled the image by.
export const registryDigestProbe: RegistryDigestProbe = async (ref) => {
  try {
    const { stdout } = await execa('docker', ['buildx', 'imagetools', 'inspect', ref, '--format', '{{.Manifest.Digest}}'], { timeout: 30_000 })
    return /^sha256:[0-9a-f]{64}$/.test(stdout.trim()) ? stdout.trim() : null
  } catch {
    return null
  }
}

export function stripImageTag(ref: string): string {
  const noDigest = ref.split('@')[0]!
  const lastColon = noDigest.lastIndexOf(':')
  return lastColon > noDigest.lastIndexOf('/') ? noDigest.slice(0, lastColon) : noDigest
}

export function parseRunningImages(output: string): RunningImage[] {
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.includes('|'))
    .map((line) => {
      const [ref = '', digestList = ''] = line.split('|')
      const digests = digestList.split(',').map((d) => d.split('@')[1] ?? '').filter(Boolean)
      return { image: stripImageTag(ref), digests }
    })
}

export async function readRunningImages(
  host: string,
  sshKey: string,
  projectName: string,
  composeDest: string,
): Promise<RunningImage[]> {
  const cmd = `for c in $(docker compose -f /opt/${projectName}/${composeDest} ps -q 2>/dev/null); do ` +
    `ref=$(docker inspect --format '{{.Config.Image}}' $c); ` +
    `id=$(docker inspect --format '{{.Image}}' $c); ` +
    `echo "$ref|$(docker image inspect --format '{{join .RepoDigests ","}}' $id 2>/dev/null)"; done`
  return parseRunningImages(await sshExec(host, cmd, sshKey))
}

export async function verifyRunningImages(
  running: RunningImage[],
  sha: string,
  registryPrefix: string,
  probe: RegistryDigestProbe = registryDigestProbe,
): Promise<VerificationResult> {
  const ours = running.filter((r) => r.image.startsWith(registryPrefix))
  if (ours.length === 0) {
    return { status: 'unverified', reason: `no running container uses an image under ${registryPrefix}` }
  }

  const expected = new Map<string, string | null>()
  await Promise.all(
    [...new Set(ours.map((r) => r.image))].map(async (image) => {
      expected.set(image, await probe(`${image}:${sha}`))
    }),
  )

  const mismatched = new Set<string>()
  const unresolved = new Set<string>()
  for (const { image, digests } of ours) {
    const want = expected.get(image)
    if (!want || digests.length === 0) unresolved.add(image)
    else if (!digests.includes(want)) mismatched.add(image)
  }

  if (mismatched.size > 0) return { status: 'mismatch', mismatched: [...mismatched] }
  if (unresolved.size > 0) {
    return { status: 'unverified', reason: `could not resolve a digest for ${[...unresolved].join(', ')}` }
  }
  return { status: 'verified' }
}
