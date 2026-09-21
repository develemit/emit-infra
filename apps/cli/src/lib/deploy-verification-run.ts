import type { ProjectConfig } from '@emit-infra/core'
import { readRunningImages, verifyRunningImages, type VerificationResult } from './deploy-verification.js'

// SSH or registry trouble degrades to 'unverified' rather than throwing: a
// deploy that already succeeded shouldn't fail because the check couldn't run.
export async function verifyDeployedImages(
  config: ProjectConfig,
  host: string,
  sshKey: string,
  composeDest: string,
  sha: string,
): Promise<VerificationResult> {
  const org = config.ci?.ghcrOrg
  if (!org) return { status: 'unverified', reason: 'ci.ghcrOrg is not set, so the registry to compare against is unknown' }
  try {
    const running = await readRunningImages(host, sshKey, config.name, composeDest)
    return await verifyRunningImages(running, sha, `ghcr.io/${org}/`)
  } catch {
    return { status: 'unverified', reason: 'could not read the running images over SSH' }
  }
}
