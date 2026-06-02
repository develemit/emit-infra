import { execa } from 'execa'

export async function runTerraform(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await execa('terraform', [cmd, ...args], { cwd, stdio: 'inherit' })
}

export async function getTerraformOutput(key: string, cwd: string): Promise<string> {
  const result = await execa('terraform', ['output', '-raw', key], { cwd })
  return result.stdout.trim()
}
