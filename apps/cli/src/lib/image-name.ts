export interface ImageNameConfig {
  ci?: { ghcrOrg?: string | undefined; ghcrRepo?: string | undefined; imagePrefix?: string | undefined } | undefined
  github?: { repo?: string | undefined } | undefined
}

// Duplicates image_name() in scripts/lib/docker-build.sh (and the GHCR_REPO
// fallback in scripts/lib/pre-push-config.sh). Bash builds and pushes the
// images, this TS copy only reads them back, and sharing one implementation
// across the two isn't practical — change both together.
export function resolveImageName(config: ImageNameConfig, service: string): string {
  const org = config.ci?.ghcrOrg ?? ''
  const prefix = config.ci?.imagePrefix ?? ''
  const repo = config.ci?.ghcrRepo ?? config.github?.repo?.split('/').pop() ?? ''

  if (prefix) return `ghcr.io/${org}/${prefix}${service}`
  if (repo) return `ghcr.io/${org}/${repo}/${service}`
  return `ghcr.io/${org}/${service}`
}
