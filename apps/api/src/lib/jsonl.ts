import { readFile, open } from 'node:fs/promises'
import { existsSync } from 'node:fs'

const TAIL_WINDOW_BYTES = 64 * 1024

function parseLines<T>(lines: string[], filterFn?: (item: T) => boolean): T[] {
  const items: T[] = []
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as T
      if (!filterFn || filterFn(parsed)) items.push(parsed)
    } catch {
      // skip malformed lines
    }
  }
  return items
}

// Reads a growing byte window from the end of the file until it holds at
// least `tail` matching items (or the whole file), so tailing a large JSONL
// file doesn't load it all into memory.
async function readJsonlTail<T>(
  filePath: string,
  tail: number,
  filterFn?: (item: T) => boolean,
): Promise<T[]> {
  const fh = await open(filePath, 'r')
  try {
    const { size } = await fh.stat()
    let window = Math.min(size, TAIL_WINDOW_BYTES)
    for (;;) {
      const start = size - window
      const buf = Buffer.alloc(window)
      await fh.read(buf, 0, window, start)
      const lines = buf.toString('utf8').split('\n')
      // The first line of a mid-file window is almost certainly partial.
      const usable = start === 0 ? lines : lines.slice(1)
      const items = parseLines(usable, filterFn)
      if (items.length >= tail || start === 0) return items.slice(-tail)
      window = Math.min(size, window * 2)
    }
  } finally {
    await fh.close()
  }
}

export async function readJsonl<T>(
  filePath: string,
  filterFn?: (item: T) => boolean,
  opts?: { tail?: number },
): Promise<T[]> {
  if (!existsSync(filePath)) return []
  if (opts?.tail !== undefined) return readJsonlTail(filePath, opts.tail, filterFn)
  const raw = await readFile(filePath, 'utf8')
  return parseLines(raw.split('\n'), filterFn)
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
