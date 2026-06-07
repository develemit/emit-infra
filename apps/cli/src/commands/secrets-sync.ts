import { Command } from 'commander'
import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import chalk from 'chalk'
import { execa } from 'execa'
import { loadConfig } from '@emit-infra/core'

export function registerSecretsSync(program: Command): void {
  program
    .command('secrets sync [name]')
    .description('Push .env secrets to GitHub repo secrets via gh CLI')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--env-file <path>', 'Path to .env file (default: .env.prod, falls back to .env)')
    .option('--dry-run', 'Print secrets that would be synced without setting them')
    .action(async (_name: string | undefined, opts: { config?: string; envFile?: string; dryRun?: boolean }) => {
      const config = loadConfig(opts.config)

      const resolvedFile = opts.envFile ?? resolveEnvFile(process.cwd())
      const envPath = join(process.cwd(), resolvedFile)

      if (!existsSync(envPath)) {
        console.error(chalk.red(`No env file found at ${envPath}`))
        console.error(chalk.gray(`  Create .env.prod with your production secrets, or pass --env-file <path>`))
        process.exit(1)
      }

      console.log(chalk.dim(`Reading from ${resolvedFile}`))

      const entries = parseEnvFile(readFileSync(envPath, 'utf-8'))

      if (opts.dryRun) {
        console.log(chalk.cyan(`Would sync ${entries.length} secrets to ${config.github.repo}:`))
        entries.forEach(([k]) => console.log(`  ${k}`))
        return
      }

      console.log(chalk.cyan(`Syncing ${entries.length} secrets to ${config.github.repo}...`))

      for (const [key, value] of entries) {
        await execa('gh', ['secret', 'set', key, '--repo', config.github.repo, '--body', value])
        console.log(chalk.gray(`  set ${key}`))
      }

      console.log(chalk.green(`Done.`))
    })
}

function resolveEnvFile(cwd: string): string {
  return existsSync(join(cwd, '.env.prod')) ? '.env.prod' : '.env'
}

function parseEnvFile(content: string): [string, string][] {
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const idx = line.indexOf('=')
      if (idx === -1) return null
      const key = line.slice(0, idx).trim()
      const value = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '')
      return [key, value] as [string, string]
    })
    .filter((entry): entry is [string, string] => entry !== null)
}
