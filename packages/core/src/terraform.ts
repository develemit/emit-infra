import { execa } from 'execa'
import { createInterface } from 'node:readline'

export async function runTerraform(
  cmd: string,
  args: string[],
  cwd: string,
  onLine?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<void> {
  if (!onLine) {
    await execa('terraform', [cmd, ...args], { cwd, stdio: 'inherit' })
    return
  }

  const proc = execa('terraform', [cmd, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', reject: false })
  const rlOut = createInterface({ input: proc.stdout! })
  const rlErr = createInterface({ input: proc.stderr! })
  rlOut.on('line', (text) => onLine('stdout', text))
  rlErr.on('line', (text) => onLine('stderr', text))
  const result = await proc
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(`terraform exited with code ${result.exitCode}`)
  }
}

export async function getTerraformOutput(key: string, cwd: string): Promise<string> {
  const result = await execa('terraform', ['output', '-raw', key], { cwd })
  return result.stdout.trim()
}
