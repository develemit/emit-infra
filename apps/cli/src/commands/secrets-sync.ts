import { Command } from 'commander'
import { readFileSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createInterface } from 'node:readline'
import chalk from 'chalk'
import { execa } from 'execa'
import { loadConfig, type ProjectConfig } from '@emit-infra/core'
import { registerSecretsScaffold } from './secrets-scaffold.js'
import { parseEnvEntries } from '../lib/env-file.js'

export function registerSecretsSync(program: Command): void {
  const secretsCmd = program.command('secrets')
    .description(
      'Manage production secrets. NOTE: `secrets sync` pushes to GitHub repo secrets — it does NOT put secrets on the server. ' +
      '`emit-infra deploy` copies its own env file (config.ci.envFile, falling back to .env.prod/.env) to the server. ' +
      'These can be different files; see README.md for the full split.',
    )
  registerSecretsScaffold(secretsCmd)
  secretsCmd
    .command('sync [name]')
    .description(
      'Push .env secrets to GitHub repo secrets via gh CLI. ' +
      'This does not affect the server: `deploy` reads a separately-resolved file (config.ci.envFile first) to populate /opt/<name>/.env.',
    )
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--env-file <path>', 'Path to .env file (default: .env.prod, falls back to .env). deploy resolves its own file independently — see README.md')
    .option('--dry-run', 'Print secrets that would be synced without setting them')
    .option('-y, --yes', 'Skip confirmation prompt')
    .action(async (_name: string | undefined, opts: { config?: string; envFile?: string; dryRun?: boolean; yes?: boolean }) => {
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

      warnIfDeploySourceDiverges(process.cwd(), config, envPath, entries)

      if (opts.dryRun) {
        console.log(chalk.cyan(`Would sync ${entries.length} secrets to ${config.github.repo}:`))
        entries.forEach(([k]) => console.log(`  ${k}`))
        return
      }

      if (!opts.yes) {
        const confirmed = await confirmSync(entries.length, config.github.repo)
        if (!confirmed) {
          console.log('Aborted.')
          return
        }
      }

      console.log(chalk.cyan(`Syncing ${entries.length} secrets to ${config.github.repo}...`))

      for (const [key, value] of entries) {
        await execa('gh', ['secret', 'set', key, '--repo', config.github.repo], { input: value })
        console.log(chalk.gray(`  set ${key}`))
      }

      console.log(chalk.green(`Done.`))
    })
}

function resolveEnvFile(cwd: string): string {
  return existsSync(join(cwd, '.env.prod')) ? '.env.prod' : '.env'
}

// Mirrors deploy.ts's copy_env resolution: config.ci.envFile wins if set, else
// .env.prod, else .env — first existing file wins. Kept in sync deliberately;
// this is the precedence `secrets sync` needs to compare itself against.
function resolveDeployEnvSource(cwd: string, config: ProjectConfig): string | undefined {
  const candidates = [config.ci?.envFile, '.env.prod', '.env']
    .filter((f): f is string => Boolean(f))
    .map((f) => join(cwd, f))
  return candidates.find((p) => existsSync(p))
}

export interface EnvSourceDiff {
  onlyInSync: string[]
  onlyInDeploy: string[]
  differing: string[]
}

// Pure and unit-tested in isolation: compares two already-parsed env files by
// key name and value. Never returns or logs values — callers must only print
// the key lists this returns.
export function diffEnvSources(
  syncEntries: [string, string][],
  deployEntries: [string, string][],
): EnvSourceDiff {
  const syncMap = new Map(syncEntries)
  const deployMap = new Map(deployEntries)

  const onlyInSync = [...syncMap.keys()].filter((k) => !deployMap.has(k)).sort()
  const onlyInDeploy = [...deployMap.keys()].filter((k) => !syncMap.has(k)).sort()
  const differing = [...syncMap.keys()]
    .filter((k) => deployMap.has(k) && syncMap.get(k) !== deployMap.get(k))
    .sort()

  return { onlyInSync, onlyInDeploy, differing }
}

function warnIfDeploySourceDiverges(
  cwd: string,
  config: ProjectConfig,
  syncEnvPath: string,
  syncEntries: [string, string][],
): void {
  const deployEnvPath = resolveDeployEnvSource(cwd, config)
  if (!deployEnvPath || deployEnvPath === syncEnvPath) return

  const deployEntries = parseEnvFile(readFileSync(deployEnvPath, 'utf-8'))
  const diff = diffEnvSources(syncEntries, deployEntries)
  if (diff.onlyInSync.length === 0 && diff.onlyInDeploy.length === 0 && diff.differing.length === 0) return

  const deployFileLabel = relative(cwd, deployEnvPath)
  console.log(chalk.yellow(`⚠ deploy reads a different env file than sync: ${deployFileLabel}`))
  console.log(chalk.gray(`  \`emit-infra deploy\` copies ${deployFileLabel} to the server, not the file you're syncing.`))
  if (diff.onlyInSync.length > 0) {
    console.log(chalk.yellow(`  Only in the synced file (pushed to GitHub, but will never reach the server): ${diff.onlyInSync.join(', ')}`))
  }
  if (diff.onlyInDeploy.length > 0) {
    console.log(chalk.yellow(`  Only in ${deployFileLabel} (on the server once deployed, not synced to GitHub): ${diff.onlyInDeploy.join(', ')}`))
  }
  if (diff.differing.length > 0) {
    console.log(chalk.yellow(`  Values differ between the two files (names only, not printing values): ${diff.differing.join(', ')}`))
  }
  console.log(chalk.gray(`  Add missing keys to both files to keep GitHub secrets and the server in sync.`))
}

function parseEnvFile(content: string): [string, string][] {
  return parseEnvEntries(content).map(
    ([key, value]) => [key, value.replace(/^["']|["']$/g, '')] as [string, string],
  )
}

function confirmSync(count: number, repo: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout })
    rl.question(
      `Sync ${count} secrets to ${repo}? (y/N) `,
      (answer) => {
        rl.close()
        resolve(answer.trim().toLowerCase() === 'y')
      },
    )
  })
}
