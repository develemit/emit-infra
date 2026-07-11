import { Command } from 'commander'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import chalk from 'chalk'
import { loadConfig } from '@emit-infra/core'
import {
  findDockerfiles,
  auditDockerfile,
  auditDockerignore,
  auditRemote,
  type Issue,
  type Severity,
} from '../lib/audit-checks.js'

const SEV_LABEL: Record<Severity, string> = {
  critical: chalk.bgRed.white(' CRIT '),
  warn:     chalk.bgYellow.black(' WARN '),
  info:     chalk.bgCyan.black(' INFO '),
}

function printIssues(issues: Issue[]): void {
  const byFile = new Map<string, Issue[]>()
  for (const issue of issues) {
    const group = byFile.get(issue.file) ?? []
    group.push(issue)
    byFile.set(issue.file, group)
  }
  for (const [file, fileIssues] of byFile) {
    console.log('\n' + chalk.bold.underline(file))
    for (const issue of fileIssues) {
      console.log(`  ${SEV_LABEL[issue.severity]}  ${issue.message}`)
      console.log(chalk.dim(`           → ${issue.fix}`))
    }
  }
}

// ─── command ─────────────────────────────────────────────────────────────────

export function registerAudit(program: Command): void {
  program
    .command('audit [name]')
    .description('Audit Dockerfiles and remote images for size and production-readiness issues')
    .option('--config <path>', 'Path to .emit-infra.json')
    .option('--key <path>', 'SSH private key', join(homedir(), '.ssh', 'id_ed25519'))
    .option('--host <ip>', 'Server host (overrides config domain)')
    .option('--local', 'Skip remote SSH checks')
    .action(async (_name, opts: { config?: string; key: string; host?: string; local?: boolean }) => {
      const config = loadConfig(opts.config)
      const projectDir = process.cwd()

      console.log(chalk.cyan(`\naudit: ${chalk.bold(config.name)}\n`) + chalk.dim('─'.repeat(50)))

      const issues: Issue[] = []

      // Local checks
      const dockerfiles = findDockerfiles(projectDir)
      if (!dockerfiles.length) {
        console.log(chalk.yellow('No Dockerfiles found. Run from the project root.'))
        return
      }
      for (const df of dockerfiles) {
        issues.push(...auditDockerfile(df, readFileSync(df, 'utf8')))
      }
      issues.push(...auditDockerignore(projectDir))

      // Remote checks
      if (!opts.local) {
        const host = opts.host ?? config.serverIp ?? config.domain
        issues.push(...await auditRemote(host, opts.key, config.name))
      }

      printIssues(issues)

      const crits = issues.filter(i => i.severity === 'critical').length
      const warns = issues.filter(i => i.severity === 'warn').length
      const infos = issues.filter(i => i.severity === 'info').length

      console.log('\n' + chalk.dim('─'.repeat(50)))
      const summary = [
        crits && chalk.red(`${crits} critical`),
        warns && chalk.yellow(`${warns} warning${warns !== 1 ? 's' : ''}`),
        infos && chalk.cyan(`${infos} info`),
      ].filter(Boolean).join('  ')
      console.log(summary || chalk.green('No issues found.'))
      console.log()

      if (crits > 0) process.exit(1)
    })
}
