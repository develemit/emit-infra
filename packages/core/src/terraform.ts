import { execa } from 'execa'

export async function runTerraform(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<void> {
  await execa('terraform', [cmd, ...args], {
    cwd,
    stdio: 'inherit',
  })
}
