import { execa } from 'execa'

export async function sshExec(
  host: string,
  command: string,
  keyPath: string,
): Promise<string> {
  const result = await execa('ssh', [
    '-i', keyPath,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    `root@${host}`,
    command,
  ])
  return result.stdout
}
