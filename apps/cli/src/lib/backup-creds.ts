import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { parseEnvEntries } from './env-file.js'

export interface BackupCreds {
  bucket: string
  endpoint: string
  accessKeyId: string
  secretAccessKey: string
  source: string
}

/** emit-vision keeps its R2 vars unprefixed; every other project uses BACKUP_S3_*. */
const ENV_FILE_PREFIXES = ['BACKUP_S3_', 'R2_']

export function credsFromTokenFile(content: string, source: string): BackupCreds | null {
  const e = Object.fromEntries(parseEnvEntries(content))
  const { bucket, endpoint, access_key_id: id, secret_access_key: secret } = e
  if (!bucket || !endpoint || !id || !secret) return null
  return { bucket, endpoint, accessKeyId: id, secretAccessKey: secret, source }
}

export function credsFromEnvFile(content: string, source: string): BackupCreds | null {
  const e = Object.fromEntries(parseEnvEntries(content))
  for (const p of ENV_FILE_PREFIXES) {
    const bucket = e[`${p}BUCKET`]
    const endpoint = e[`${p}ENDPOINT`]
    const id = e[`${p}ACCESS_KEY_ID`]
    const secret = e[`${p}SECRET_ACCESS_KEY`]
    if (bucket && endpoint && id && secret) {
      return { bucket, endpoint, accessKeyId: id, secretAccessKey: secret, source }
    }
  }
  return null
}

export function loadBackupCreds(name: string, projectDir: string, envFile?: string): BackupCreds | null {
  const tokenPath = join(homedir(), '.emit-infra', name, 'r2-backup-token.env')
  if (existsSync(tokenPath)) {
    const creds = credsFromTokenFile(readFileSync(tokenPath, 'utf-8'), tokenPath)
    if (creds) return creds
  }
  if (!envFile) return null
  const envPath = join(projectDir, envFile)
  if (!existsSync(envPath)) return null
  return credsFromEnvFile(readFileSync(envPath, 'utf-8'), envPath)
}
