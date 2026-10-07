import { Command } from 'commander'
import chalk from 'chalk'
import { loadBackupCreds } from '../lib/backup-creds.js'
import { discoverTargets, recordDrill, type DrillTarget } from '../lib/backup-drill-record.js'
import { runDrill } from './backup-verify.js'

interface VerifyOptions {
  all?: boolean
  pgMajor?: string
  prefix?: string[]
}

// Fleet convention is db-backups/; emit-vision's Postgres dumps live under pg/.
const DEFAULT_PREFIXES = ['db-backups/', 'pg/']

function normalisePrefix(p: string): string {
  return p.endsWith('/') ? p : `${p}/`
}

async function verifyOne(target: DrillTarget, opts: VerifyOptions): Promise<boolean | 'skipped'> {
  const { config, dir } = target
  const creds = loadBackupCreds(config.name, dir, config.ci?.envFile)
  if (!creds) {
    console.log(chalk.gray(`- ${config.name}: no R2 backup credentials, skipped`))
    return 'skipped'
  }
  console.log(`> ${config.name}: restoring newest dump from ${creds.bucket} (creds: ${creds.source})`)
  const prefixes = opts.prefix?.length ? opts.prefix.map(normalisePrefix) : DEFAULT_PREFIXES
  const result = await runDrill({
    name: config.name,
    creds,
    prefixes,
    verifyQueries: config.backup?.verifyQueries ?? [],
    ...(opts.pgMajor && { pgMajor: opts.pgMajor }),
  })
  const { topTables, ...record } = result
  recordDrill(config.name, record)
  if (result.ok) {
    console.log(chalk.green(`✓ ${config.name}: ${result.key} (${result.bytes} B) restored in ${result.durationSec}s, ${result.tables} tables`))
    for (const t of topTables) console.log(`    ${t.table.padEnd(40)} ${t.rows}`)
  } else {
    console.log(chalk.red(`✗ ${config.name}: ${result.key || '(no dump found)'} — ${result.error}`))
  }
  return result.ok
}

export function registerBackupVerify(program: Command): void {
  program
    .command('backup')
    .description('Backup tooling')
    .command('verify [name]')
    .description('Restore the newest offsite dump into a throwaway Postgres container and sanity-check it')
    .option('--all', 'verify every project that has R2 backup credentials')
    .option('--pg-major <n>', 'postgres image major version (default: read from the dump header, else 16)')
    .option('--prefix <prefix...>', 'R2 key prefix(es) to search, instead of db-backups/ then pg/')
    .action(async (name: string | undefined, opts: VerifyOptions) => {
      const targets = discoverTargets().filter((t) => (name ? t.config.name === name : opts.all))
      if (targets.length === 0) {
        console.error(chalk.red(name ? `no project named ${name}` : 'pass a project name or --all'))
        process.exit(1)
      }
      const outcomes: Array<boolean | 'skipped'> = []
      for (const target of targets) outcomes.push(await verifyOne(target, opts))
      if (outcomes.includes(false)) process.exit(1)
    })
}
