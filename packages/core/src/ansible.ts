import { execa } from 'execa'
import { join } from 'node:path'

const ANSIBLE_DIR = new URL('../../../ansible', import.meta.url).pathname

export async function runAnsible(
  playbook: 'provision' | 'deploy',
  inventory: string,
  extraVars?: Record<string, string>,
): Promise<void> {
  const args = [join(ANSIBLE_DIR, 'playbooks', `${playbook}.yml`), '-i', inventory]

  if (extraVars) {
    const vars = Object.entries(extraVars)
      .map(([k, v]) => `${k}=${v}`)
      .join(' ')
    args.push('--extra-vars', vars)
  }

  await execa('ansible-playbook', args, { stdio: 'inherit' })
}
