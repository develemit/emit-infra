import { stat, readFile, writeFile } from 'node:fs/promises'

const PRUNE_THRESHOLD_BYTES = 100 * 1024
const RETENTION_DAYS = 90

export function filterAlertEntries(lines: string[], cutoffSec: number): string[] {
  return lines.filter(line => {
    if (!line.trim()) return false
    try {
      const entry = JSON.parse(line) as { firedAt?: number }
      return typeof entry.firedAt === 'number' && entry.firedAt >= cutoffSec
    } catch {
      return false
    }
  })
}

export async function pruneAlertJsonl(
  filePath: string,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<void> {
  let size: number
  try {
    size = (await stat(filePath)).size
  } catch {
    return
  }
  if (size <= PRUNE_THRESHOLD_BYTES) return

  let raw: string
  try {
    raw = await readFile(filePath, 'utf8')
  } catch {
    return
  }

  const cutoff = nowSec - RETENTION_DAYS * 86400
  const retained = filterAlertEntries(raw.split('\n'), cutoff)
  await writeFile(filePath, retained.length > 0 ? retained.join('\n') + '\n' : '')
}
