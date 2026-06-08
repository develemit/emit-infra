import { execa } from 'execa'
import { createInterface } from 'node:readline'
import { join } from 'node:path'

const ANSIBLE_DIR = new URL('../../../ansible', import.meta.url).pathname

export async function runAnsible(
  playbook: 'provision' | 'deploy',
  inventory: string,
  extraVars?: Record<string, unknown>,
  onLine?: (stream: 'stdout' | 'stderr', text: string) => void,
): Promise<void> {
  const args = [join(ANSIBLE_DIR, 'playbooks', `${playbook}.yml`), '-i', inventory]

  if (extraVars) {
    args.push('--extra-vars', JSON.stringify(extraVars))
  }

  if (!onLine) {
    await execa('ansible-playbook', args, { stdio: 'inherit' })
    return
  }

  const proc = execa('ansible-playbook', args, { stdout: 'pipe', stderr: 'pipe', reject: false })
  const rlOut = createInterface({ input: proc.stdout! })
  const rlErr = createInterface({ input: proc.stderr! })
  rlOut.on('line', (text) => onLine('stdout', text))
  rlErr.on('line', (text) => onLine('stderr', text))
  const result = await proc
  if ((result.exitCode ?? 1) !== 0) {
    throw new Error(`ansible-playbook exited with code ${result.exitCode}`)
  }
}
