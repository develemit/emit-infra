#!/usr/bin/env node
import { Command } from 'commander'
import { registerInit } from './commands/init.js'
import { registerProvision } from './commands/provision.js'
import { registerConfigure } from './commands/configure.js'
import { registerDeploy } from './commands/deploy.js'
import { registerStatus } from './commands/status.js'
import { registerSecretsSync } from './commands/secrets-sync.js'
import { registerDestroy } from './commands/destroy.js'

const program = new Command()

program
  .name('emit-infra')
  .description('Infrastructure CLI for the emit project stack')
  .version('0.0.1')

registerInit(program)
registerProvision(program)
registerConfigure(program)
registerDeploy(program)
registerStatus(program)
registerSecretsSync(program)
registerDestroy(program)

program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
