import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'

export async function readJsonl<T>(
  filePath: string,
  filterFn?: (item: T) => boolean,
  opts?: { tail?: number },
): Promise<T[]> {
  if (!existsSync(filePath)) return []
  const raw = await readFile(filePath, 'utf8')
  const items: T[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as T
      if (!filterFn || filterFn(parsed)) items.push(parsed)
    } catch {
      // skip malformed lines
    }
  }
  if (opts?.tail !== undefined) return items.slice(-opts.tail)
  return items
}

export function downsample<T>(points: T[], maxPoints: number): T[] {
  if (points.length <= maxPoints) return points
  const bucketSize = points.length / maxPoints
  const result: T[] = []
  for (let i = 0; i < maxPoints; i++) {
    const start = Math.floor(i * bucketSize)
    const end = Math.floor((i + 1) * bucketSize)
    const bucket = points.slice(start, end)
    if (bucket.length === 0) continue
    result.push(averageBucket(bucket))
  }
  return result
}

function averageBucket<T>(bucket: T[]): T {
  if (bucket.length === 1) return bucket[0]!
  const first = bucket[0] as Record<string, unknown>
  const result: Record<string, unknown> = {}

  for (const key of Object.keys(first)) {
    const val = first[key]
    if (typeof val === 'number') {
      const sum = bucket.reduce((acc, item) => {
        const v = (item as Record<string, unknown>)[key]
        return acc + (typeof v === 'number' ? v : 0)
      }, 0)
      result[key] = Math.round((sum / bucket.length) * 100) / 100
    } else {
      // non-numeric: take the last value in the bucket (most recent)
      result[key] = (bucket[bucket.length - 1] as Record<string, unknown>)[key]
    }
  }
  return result as T
}
