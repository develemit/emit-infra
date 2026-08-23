import chalk from 'chalk'
import type { StaticFinding } from './gate-doctor-static.js'
import type { TargetResult } from './gate-doctor-run.js'
import type { ConfigIssue } from './gate-doctor-scan.js'

export interface ProjectGateReport {
  repo: string
  staticFindings: StaticFinding[]
  targetResults: TargetResult[]
  configIssue?: ConfigIssue
}

// A malformed/unparseable .emit-infra.json counts toward the doctor's exit
// code, same as a static finding or a failed target: gate-doctor's whole job
// is proving the push gate is runnable, and either case means the config the
// real hook reads is not what the doctor just checked.
function reportFailing(report: ProjectGateReport): boolean {
  return Boolean(report.configIssue) || report.staticFindings.length > 0 || report.targetResults.some((t) => !t.passed)
}

export function reportHasIssues(reports: ProjectGateReport[]): boolean {
  return reports.some(reportFailing)
}

export function printConfigIssue(repo: string, configIssue: ConfigIssue | undefined): void {
  if (!configIssue) return
  console.log(chalk.red(`\n✖ ${repo}: ${configIssue.message}`))
}

export function printStaticFindings(repo: string, findings: StaticFinding[]): void {
  if (findings.length === 0) return
  const file = findings[0]?.file ?? 'ci.sh'
  console.log(chalk.yellow(`\n⚠ ${repo}: env vars prefixed onto a CI command in ${file}`))
  console.log(chalk.dim('  the hook sets no environment before running these — these mask what will actually run:'))
  for (const f of findings) {
    console.log(chalk.yellow(`  line ${f.line}: ${f.envVars.join(', ')} — ${f.text}`))
  }
}

export function printDynamicResults(repo: string, results: TargetResult[]): void {
  if (results.length === 0) return
  console.log(`\n${chalk.bold(repo)}`)
  for (const r of results) {
    if (r.passed) {
      console.log(chalk.green(`  ✓ ${r.target}`))
    } else if (r.timedOut) {
      console.log(chalk.red(`  ✖ ${r.target} — timed out`))
    } else {
      console.log(chalk.red(`  ✖ ${r.target}${r.errorLine ? ` — ${r.errorLine}` : ''}`))
    }
  }
}

export function printSummary(reports: ProjectGateReport[]): void {
  console.log()
  console.log(chalk.dim('─'.repeat(50)))
  const failing = reports.filter(reportFailing).map((r) => r.repo)
  if (failing.length === 0) {
    console.log(chalk.green('No gate issues found.'))
  } else {
    console.log(chalk.red(`Gate issues found in: ${failing.join(', ')}`))
  }
}
