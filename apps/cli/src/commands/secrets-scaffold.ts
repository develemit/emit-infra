import { Command } from 'commander'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import chalk from 'chalk'
import { loadConfig, setConfigField, sshExec } from '@emit-infra/core'

const EXCLUDED_KEYS = new Set(['BUILD_NUMBER'])

export function registerSecretsScaffold(secretsCmd: Command): void {
  secretsCmd
    .command('scaffold-required-keys [name]')
    .description("Scaffold a project's requiredEnvKeys from its live server .env")
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--dry-run', 'Print discovered keys without writing')
    .option('--force', 'Overwrite an existing requiredEnvKeys value')
    .action(async (_name: string | undefined, opts: { config?: string; dryRun?: boolean; force?: boolean }) => {
      const config = loadConfig(opts.config)
      const host = config.serverIp ?? config.domain
      const key = join(homedir(), '.ssh', config.sshKeyName)

      console.log(chalk.cyan(`Reading required keys for ${chalk.bold(config.name)} from ${host}...`))

      let raw: string
      try {
        raw = await sshExec(
          host,
          `grep -v '^#' /opt/${config.name}/.env 2>/dev/null | grep '=' | cut -d= -f1 | tr -d ' '`,
          key,
        )
      } catch {
        console.error(chalk.red(`Could not read /opt/${config.name}/.env on ${host} — is the host reachable and the file present?`))
        process.exit(1)
      }

      const discovered = filterExcludedKeys(parseKeyList(raw))
      if (discovered.length === 0) {
        console.error(chalk.red(`No keys found in /opt/${config.name}/.env on the server — nothing to scaffold.`))
        process.exit(1)
      }

      const sorted = [...discovered].sort()

      if (opts.dryRun) {
        console.log(chalk.cyan(`Would write ${sorted.length} keys to requiredEnvKeys:`))
        sorted.forEach((k) => console.log(`  ${k}`))
        return
      }

      const configPath = resolveConfigPath(opts.config)
      const fileConfig = JSON.parse(readFileSync(configPath, 'utf-8'))
      const existing: string[] | undefined = fileConfig.requiredEnvKeys

      if (existing && existing.length > 0 && !opts.force) {
        const { added, removed } = diffKeys(existing, sorted)
        console.log(chalk.yellow(`requiredEnvKeys is already set (${existing.length} keys). Refusing to overwrite without --force.`))
        if (added.length > 0) console.log(chalk.green(`  + ${added.join(', ')}`))
        if (removed.length > 0) console.log(chalk.red(`  - ${removed.join(', ')}`))
        if (added.length === 0 && removed.length === 0) console.log(chalk.dim('  (no changes)'))
        process.exit(1)
      }

      setConfigField(configPath, ['requiredEnvKeys'], sorted)
      console.log(chalk.green(`Wrote ${sorted.length} keys to requiredEnvKeys in ${configPath}`))
    })
}

export function parseKeyList(raw: string): string[] {
  return raw
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

export function filterExcludedKeys(keys: string[]): string[] {
  return keys.filter((k) => !EXCLUDED_KEYS.has(k))
}

export function diffKeys(existing: string[], proposed: string[]): { added: string[]; removed: string[] } {
  const existingSet = new Set(existing)
  const proposedSet = new Set(proposed)
  return {
    added: proposed.filter((k) => !existingSet.has(k)).sort(),
    removed: existing.filter((k) => !proposedSet.has(k)).sort(),
  }
}

export function resolveConfigPath(configPath?: string): string {
  if (configPath) return configPath

  let dir = process.cwd()
  while (true) {
    const candidate = join(dir, '.emit-infra.json')
    if (existsSync(candidate)) return candidate
    const parent = dirname(dir)
    if (parent === dir) {
      throw new Error('Could not find .emit-infra.json. Run "emit-infra init <name>" to create one, or pass --config.')
    }
    dir = parent
  }
}
