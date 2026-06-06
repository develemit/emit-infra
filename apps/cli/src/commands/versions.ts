import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { loadConfig, sshExec } from '@emit-infra/core'

async function getGhToken(): Promise<string> {
  if (process.env['GITHUB_TOKEN']) return process.env['GITHUB_TOKEN']
  try {
    const { execSync } = await import('node:child_process')
    return execSync('gh auth token', { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('No GITHUB_TOKEN env var and `gh auth token` failed. Authenticate with `gh auth login` or set GITHUB_TOKEN.')
  }
}

async function listRegistryTags(owner: string, imageName: string, token: string): Promise<string[]> {
  const url = `https://ghcr.io/v2/${owner}/${imageName}/tags/list`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(10000),
  })

  if (res.status === 401) {
    const authHeader = res.headers.get('www-authenticate') ?? ''
    const realmMatch = authHeader.match(/realm="([^"]+)"/)
    const serviceMatch = authHeader.match(/service="([^"]+)"/)
    const scopeMatch = authHeader.match(/scope="([^"]+)"/)
    if (realmMatch) {
      const tokenUrl = `${realmMatch[1]}?service=${serviceMatch?.[1] ?? ''}&scope=${scopeMatch?.[1] ?? ''}`
      const tokenRes = await fetch(tokenUrl, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!tokenRes.ok) throw new Error(`Registry auth failed: ${tokenRes.status}`)
      const tokenData = (await tokenRes.json()) as { token: string }
      const retryRes = await fetch(url, {
        headers: { Authorization: `Bearer ${tokenData.token}` },
        signal: AbortSignal.timeout(10000),
      })
      if (!retryRes.ok) throw new Error(`Registry request failed: ${retryRes.status}`)
      const data = (await retryRes.json()) as { tags: string[] }
      return data.tags ?? []
    }
    throw new Error('Registry authentication failed')
  }

  if (!res.ok) throw new Error(`Registry request failed: ${res.status}`)
  const data = (await res.json()) as { tags: string[] }
  return data.tags ?? []
}

export function registerVersions(program: Command): void {
  program
    .command('versions [name]')
    .description('List available build versions for a project')
    .option('--config <path>', 'Path to .emit-infra.json')
    .action(async (_name: string | undefined, opts: { config?: string }) => {
      const config = loadConfig(opts.config)
      const host = config.serverIp ?? config.domain
      const key = join(homedir(), '.ssh', config.sshKeyName)
      const appDir = config.deploy?.appDir ?? '/app'
      const composeFile = config.deploy?.composeDest ?? 'docker-compose.yml'
      const owner = config.github.repo.split('/')[0] ?? ''

      console.log(chalk.cyan(`Fetching versions for ${chalk.bold(config.name)}...\n`))

      const images = await sshExec(
        host,
        `cd ${appDir} && docker compose -f ${composeFile} config --images`,
        key,
      )
      const imageList = images.split('\n').map(l => l.trim()).filter(Boolean)

      if (imageList.length === 0) {
        console.error(chalk.red('No images found in compose config.'))
        process.exit(1)
      }

      let deployed: string | null = null
      try {
        deployed = (await sshExec(host, `cat ${appDir}/.deployed-version 2>/dev/null || echo ""`, key)).trim() || null
      } catch { /* ignore */ }

      const token = await getGhToken()

      for (const fullImage of imageList) {
        const imageName = fullImage.replace(/^ghcr\.io\//, '').split(':')[0] ?? ''
        const shortName = imageName.split('/').pop() ?? imageName

        console.log(chalk.bold(shortName))

        try {
          const tags = await listRegistryTags(owner, shortName, token)
          const buildNumbers = tags
            .filter(t => /^\d+$/.test(t))
            .map(Number)
            .sort((a, b) => b - a)

          if (buildNumbers.length === 0) {
            console.log(chalk.dim('  No build-number tags found\n'))
            continue
          }

          for (const num of buildNumbers) {
            const marker = deployed && String(num) === deployed ? chalk.green(' ← deployed') : ''
            console.log(`  ${chalk.bold(String(num))}${marker}`)
          }
        } catch (err) {
          console.log(chalk.red(`  Failed to fetch tags: ${err instanceof Error ? err.message : String(err)}`))
        }
        console.log()
      }
    })
}
