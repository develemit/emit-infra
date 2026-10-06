/** Registered top-level `emit-infra` commands that remediation steps may reference. */
export const EMIT_INFRA_COMMANDS = [
  'setup', 'init', 'provision', 'configure', 'deploy', 'status', 'logs', 'secrets',
  'destroy', 'audit', 'rollback', 'versions', 'hooks', 'terraform-init', 'r2:rotate-token',
] as const
