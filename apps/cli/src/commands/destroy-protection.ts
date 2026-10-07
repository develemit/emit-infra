const PROTECTED_PATTERN = /protected|delete_protection/i

export function isProtectionError(output: string): boolean {
  return PROTECTED_PATTERN.test(output)
}

export function protectionMessage(name: string): string {
  return [
    `Destroy blocked: the server for ${name} has delete protection enabled.`,
    'To remove protection, either:',
    '  - set delete_protection = false and rebuild_protection = false on the hetzner-server module, run `emit-infra provision`, then destroy again; or',
    `  - run \`hcloud server disable-protection ${name} delete rebuild\`, then destroy again.`,
  ].join('\n')
}
