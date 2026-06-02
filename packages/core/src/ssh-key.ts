import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { execa } from 'execa'

export interface SshKeyPaths {
  privateKey: string
  publicKey: string
  wasCreated: boolean
}

export async function ensureSshKey(keyName: string): Promise<SshKeyPaths> {
  const home = homedir()
  const named = join(home, '.ssh', keyName)
  const fallback = join(home, '.ssh', 'id_ed25519')

  if (existsSync(named)) {
    return { privateKey: named, publicKey: `${named}.pub`, wasCreated: false }
  }

  if (existsSync(fallback)) {
    return { privateKey: fallback, publicKey: `${fallback}.pub`, wasCreated: false }
  }

  await execa('ssh-keygen', ['-t', 'ed25519', '-f', named, '-N', '', '-C', keyName], {
    stdio: 'inherit',
  })

  return { privateKey: named, publicKey: `${named}.pub`, wasCreated: true }
}

export async function ensureHetznerKey(
  keyName: string,
  publicKeyPath: string,
): Promise<'found' | 'created' | 'fingerprint-exists'> {
  try {
    await execa('hcloud', ['ssh-key', 'describe', keyName])
    return 'found'
  } catch {
    // not found by name — try to create it
  }

  try {
    await execa('hcloud', ['ssh-key', 'create', '--name', keyName, '--public-key-from-file', publicKeyPath])
    return 'created'
  } catch (err) {
    if (String(err).includes('uniqueness_error')) {
      return 'fingerprint-exists'
    }
    throw err
  }
}
