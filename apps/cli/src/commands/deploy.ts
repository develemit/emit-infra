import { Command } from 'commander'
import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import chalk from 'chalk'
import { loadConfig, runAnsible, type ProjectConfig } from '@emit-infra/core'
import { resolveInventoryPath } from './configure.js'

const BACKUP_ENV_KEYS = ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const

function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {}
  return Object.fromEntries(
    readFileSync(path, 'utf8')
      .split('\n')
      .filter(line => /^\s*[A-Z_]+=/.test(line))
      .map(line => {
        const idx = line.indexOf('=')
        return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string]
      }),
  )
}

function checkBackupEnv(config: ProjectConfig): void {
  if (!config.postgres?.backupBucket) return

  const envCandidates = ['.env.prod', '.env'].map(f => join(process.cwd(), f))
  const envPath = envCandidates.find(p => existsSync(p)) ?? join(process.cwd(), '.env')
  const env = parseEnvFile(envPath)
  const missing = BACKUP_ENV_KEYS.filter(k => !env[k])

  if (missing.length === 0) return

  console.error(chalk.red('\nPostgres backup is configured but required R2 credentials are missing from .env:\n'))
  missing.forEach(k => console.error(chalk.red(`  missing: ${chalk.bold(k)}`)))
  console.error(chalk.yellow(`\nAdd these to ${envPath} before deploying:`))
  console.error(chalk.dim('  CF_ACCOUNT_ID         — your Cloudflare account ID'))
  console.error(chalk.dim('  R2_ACCESS_KEY_ID      — R2 API token access key ID'))
  console.error(chalk.dim('  R2_SECRET_ACCESS_KEY  — R2 API token secret access key'))
  process.exit(1)
}

export function registerDeploy(program: Command): void {
  program
    .command('deploy [name]')
    .description('Pull latest images and restart the app (Ansible deploy playbook)')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--inventory <path>', 'Path to Ansible inventory file')
    .action(async (_name: string | undefined, opts: { config?: string; inventory?: string }) => {
      const config = loadConfig(opts.config)

      checkBackupEnv(config)

      console.log(chalk.cyan(`Deploying ${chalk.bold(config.name)}...`))

      const inventory = opts.inventory ?? (await resolveInventoryPath(config.name, config))

      const extraVars: Record<string, unknown> = { project_name: config.name }

      if (config.deploy) {
        const cwd = process.cwd()
        extraVars.compose_src = join(cwd, config.deploy.composeSrc)
        extraVars.compose_dest = config.deploy.composeDest
        if (config.deploy.extraFiles.length > 0) {
          extraVars.extra_files = config.deploy.extraFiles.map((f) => ({
            src: join(cwd, f.src),
            dest: f.dest,
          }))
        }
        if (config.deploy.postDeployExec && config.deploy.postDeployExec.length > 0) {
          extraVars.post_deploy_exec = config.deploy.postDeployExec
        }
      }

      if (config.postgres) {
        extraVars.postgres_version = config.postgres.version ?? '16'
        if (config.postgres.backupBucket) {
          extraVars.postgres_backup_bucket = config.postgres.backupBucket
        }
      }

      const envCandidates = ['.env.prod', '.env'].map(f => join(process.cwd(), f))
      const envPath = envCandidates.find(p => existsSync(p))
      if (envPath) {
        extraVars.copy_env = true
        extraVars.env_src = envPath
      }

      await runAnsible('deploy', inventory, extraVars)

      console.log(chalk.green(`\nDeployed successfully.`))
    })
}
