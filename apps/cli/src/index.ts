#!/usr/bin/env node
import { Command } from 'commander'
import { registerSetup } from './commands/setup.js'
import { registerInit } from './commands/init.js'
import { registerProvision } from './commands/provision.js'
import { registerConfigure } from './commands/configure.js'
import { registerDeploy } from './commands/deploy.js'
import { registerStatus } from './commands/status.js'
import { registerLogs } from './commands/logs.js'
import { registerSecretsSync } from './commands/secrets-sync.js'
import { registerDestroy } from './commands/destroy.js'
import { registerAudit } from './commands/audit.js'
import { registerRollback } from './commands/rollback.js'
import { registerVersions } from './commands/versions.js'
import { registerHooks } from './commands/hooks.js'
import { registerTerraformInit } from './commands/terraform-init.js'
import { registerR2RotateToken } from './commands/r2-rotate-token.js'
import { registerInitDeploy } from './commands/init-deploy.js'

const program = new Command()

program
  .name('emit-infra')
  .description('Infrastructure CLI for the emit project stack')
  .version('0.0.1')

registerSetup(program)
registerInit(program)
registerProvision(program)
registerConfigure(program)
registerDeploy(program)
registerStatus(program)
registerLogs(program)
registerSecretsSync(program)
registerDestroy(program)
registerAudit(program)
registerRollback(program)
registerVersions(program)
registerHooks(program)
registerTerraformInit(program)
registerR2RotateToken(program)
registerInitDeploy(program)

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
