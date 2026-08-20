import { Command } from 'commander'
import chalk from 'chalk'
import { planReconcile, applyReconcile, type ReconcileKind, type ReconcilePlan } from '@emit-infra/core'

const KINDS: ReconcileKind[] = ['deploy', 'ci']

// Runs the detect (+ optional repair) step for both status files in a
// project directory. Exported separately from the commander wiring so it's
// directly testable without driving the CLI process.
export async function reconcileProject(dir: string, write: boolean): Promise<ReconcilePlan[]> {
  const plans: ReconcilePlan[] = []
  for (const kind of KINDS) {
    const plan = await planReconcile(dir, kind)
    if (plan.action === 'reconcile' && write) await applyReconcile(plan)
    plans.push(plan)
  }
  return plans
}

function printPlan(plan: ReconcilePlan, write: boolean): void {
  const label = plan.kind === 'deploy' ? 'Deploy' : 'CI    '
  if (plan.action === 'skip') {
    console.log(`  ${label}: ${chalk.dim(plan.reason)}`)
    return
  }

  const verb = write ? chalk.green('reconciled') : chalk.yellow('would reconcile')
  console.log(`  ${label}: ${verb} — ${plan.reason}`)
  console.log(`    terminal record: ${chalk.dim(JSON.stringify(plan.terminalRecord))}`)
  console.log(`    history line:    ${chalk.dim(JSON.stringify(plan.historyLine))}`)
}

export function registerReconcile(program: Command): void {
  program
    .command('reconcile')
    .description(
      'Detect an orphaned .deploy-status.json / .ci-status.json record and write a correct terminal ' +
        'record for it. Dry-run by default — prints what it would change and touches nothing. ' +
        'Pass --write to actually apply it.',
    )
    .option('--dir <path>', 'Project directory to reconcile (defaults to the current directory)', process.cwd())
    .option('--write', 'Apply the reconcile instead of only reporting it', false)
    .action(async (opts: { dir: string; write: boolean }) => {
      console.log(chalk.cyan(`Reconcile for ${chalk.bold(opts.dir)}${opts.write ? '' : chalk.dim(' (dry-run — pass --write to apply)')}\n`))

      const plans = await reconcileProject(opts.dir, opts.write)
      plans.forEach((plan) => printPlan(plan, opts.write))

      const reconciledAny = plans.some((plan) => plan.action === 'reconcile')
      console.log()
      if (!reconciledAny) {
        console.log(chalk.dim('Nothing to reconcile — no orphaned records found.'))
      } else if (!opts.write) {
        console.log(chalk.dim('Dry-run only. Re-run with --write to apply.'))
      }
    })
}
