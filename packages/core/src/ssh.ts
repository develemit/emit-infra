import { execa } from 'execa'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { mkdirSync } from 'node:fs'

// Multiplex repeated SSH calls to the same host over a single TCP connection.
// Without this, every status poll spawns a fresh ssh process — a new :22
// connection that lingers in TIME_WAIT. At dashboard-poll frequency across many
// projects that churn exhausts the machine's ephemeral port pool and takes down
// ALL outbound networking (not just emit-infra). ControlPersist keeps the master
// alive between polls so subsequent calls reuse it instead of reconnecting.
const CONTROL_DIR = join(homedir(), '.ssh', 'emit-infra-cm')
try {
  mkdirSync(CONTROL_DIR, { recursive: true, mode: 0o700 })
} catch {
  // best-effort — if unwritable, ssh falls back to one connection per call
}

/** Shared connection-multiplexing options for every ssh invocation. */
export function sshMuxArgs(): string[] {
  return [
    '-o', 'ControlMaster=auto',
    // %C = hash of (localhost, remotehost, port, user) — a fixed-length,
    // collision-safe control-socket filename per destination.
    '-o', `ControlPath=${join(CONTROL_DIR, '%C')}`,
    '-o', 'ControlPersist=60',
  ]
}

export async function sshExec(
  host: string,
  command: string,
  keyPath: string,
): Promise<string> {
  const result = await execa('ssh', [
    '-i', keyPath,
    '-o', 'StrictHostKeyChecking=no',
    '-o', 'ConnectTimeout=10',
    '-o', 'BatchMode=yes',
    ...sshMuxArgs(),
    `root@${host}`,
    command,
  ])
  return result.stdout
}
