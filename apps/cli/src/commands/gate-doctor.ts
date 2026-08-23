import { Command } from 'commander'
import { homedir } from 'node:os'
import { join } from 'node:path'
import chalk from 'chalk'
import { scanGateFleet, findGateProject, type GateProject } from '../lib/gate-doctor-scan.js'
import { scanCiScriptForEnvPrefixes } from '../lib/gate-doctor-static.js'
import { runGateTarget, type TargetResult } from '../lib/gate-doctor-run.js'
import {
  printConfigIssue,
  printStaticFindings,
  printDynamicResults,
  printSummary,
  reportHasIssues,
  type ProjectGateReport,
} from '../lib/gate-doctor-report.js'

interface GateDoctorOpts {
  roots: string
  project?: string
  dynamic: boolean
  timeout: string
}

// Targets run sequentially, one project at a time — mirrors run_ci's own
// `for target in $CI_TARGETS` loop and avoids the same concurrent-build
// resource contention documented for docker builds in the hook itself.
export async function buildGateReport(
  project: GateProject,
  dynamic: boolean,
  timeoutMs: number,
): Promise<ProjectGateReport> {
  const staticFindings = project.ciScriptPath ? scanCiScriptForEnvPrefixes(project.ciScriptPath) : []

  const targetResults: TargetResult[] = []
  if (dynamic) {
    for (const target of project.targets) {
      targetResults.push(await runGateTarget(project.repoPath, target, timeoutMs))
    }
  }

  return { repo: project.repo, staticFindings, targetResults, ...(project.configIssue ? { configIssue: project.configIssue } : {}) }
}

export function registerGateDoctor(program: Command): void {
  program
    .command('gate-doctor')
    .description(
      "Prove a project's push gate is actually runnable: a static scan for env vars ci.sh " +
        'prefixes onto CI commands (the hook sets none), plus an opt-in --dynamic run of every ' +
        'declared ci.prePush target in a scrubbed environment.',
    )
    .option('--roots <dir>', 'Roots directory to scan (each immediate subdirectory is a repo)', join(homedir(), 'projects'))
    .option('--project <name>', 'Check a single repo by name instead of the whole fleet')
    .option('--dynamic', 'Also run each declared target for real — slow, builds and tests included', false)
    .option('--timeout <seconds>', 'Per-target timeout for --dynamic', '600')
    .action(async (opts: GateDoctorOpts) => {
      const projects = opts.project
        ? [findGateProject(opts.roots, opts.project)].filter((p): p is GateProject => p !== null)
        : scanGateFleet(opts.roots)

      if (projects.length === 0) {
        const where = opts.project ? `for ${opts.project} in ${opts.roots}` : `in ${opts.roots}`
        console.log(chalk.yellow(`No .emit-infra.json found ${where}`))
        return
      }

      const mode = opts.dynamic ? 'static + dynamic' : 'static only — pass --dynamic to actually run targets'
      console.log(chalk.cyan(`\nChecking push gate for ${projects.length} project${projects.length === 1 ? '' : 's'} (${mode})...\n`))

      const timeoutMs = Number(opts.timeout) * 1000
      const reports: ProjectGateReport[] = []
      for (const project of projects) {
        const report = await buildGateReport(project, opts.dynamic, timeoutMs)
        printConfigIssue(report.repo, report.configIssue)
        printStaticFindings(report.repo, report.staticFindings)
        printDynamicResults(report.repo, report.targetResults)
        reports.push(report)
      }

      printSummary(reports)
      if (reportHasIssues(reports)) process.exit(1)
    })
}
