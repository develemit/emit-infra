import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readJsonl } from './jsonl.js'

interface Row {
  i: number
  pad: string
}

// ~120 bytes per line so 1000 lines (~120KB) exceeds the 64KB tail window.
function makeLine(i: number): string {
  return JSON.stringify({ i, pad: 'x'.repeat(100) })
}

let dir: string
let file: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jsonl-test-'))
  file = join(dir, 'data.jsonl')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeRows(count: number, extraLines: string[] = []): Promise<void> {
  const lines = Array.from({ length: count }, (_, i) => makeLine(i))
  await writeFile(file, [...lines, ...extraLines].join('\n') + '\n')
}

describe('readJsonl tail reads', () => {
  it('returns the last N items when the file fits in one window', async () => {
    await writeRows(10)

    const items = await readJsonl<Row>(file, undefined, { tail: 3 })

    expect(items.map((r) => r.i)).toEqual([7, 8, 9])
  })

  it('grows the window when the tail spans the byte-window boundary', async () => {
    await writeRows(1000)

    const items = await readJsonl<Row>(file, undefined, { tail: 900 })

    expect(items).toHaveLength(900)
    expect(items[0]?.i).toBe(100)
    expect(items[899]?.i).toBe(999)
  })

  it('grows the window until enough filtered items are found', async () => {
    await writeRows(1000)

    const items = await readJsonl<Row>(file, (r) => r.i % 10 === 0, { tail: 80 })

    expect(items).toHaveLength(80)
    expect(items[0]?.i).toBe(200)
    expect(items[79]?.i).toBe(990)
  })

  it('returns all items when tail exceeds the line count', async () => {
    await writeRows(5)

    const items = await readJsonl<Row>(file, undefined, { tail: 50 })

    expect(items.map((r) => r.i)).toEqual([0, 1, 2, 3, 4])
  })

  it('skips malformed lines inside the tail window', async () => {
    await writeRows(5, ['NOT JSON {{{'])

    const items = await readJsonl<Row>(file, undefined, { tail: 3 })

    expect(items.map((r) => r.i)).toEqual([2, 3, 4])
  })

  it('returns [] for a missing file', async () => {
    const items = await readJsonl<Row>(join(dir, 'nope.jsonl'), undefined, { tail: 3 })

    expect(items).toEqual([])
  })

  it('full read (no tail) parses every line and skips malformed ones', async () => {
    await writeRows(5, ['garbage'])

    const items = await readJsonl<Row>(file)

    expect(items.map((r) => r.i)).toEqual([0, 1, 2, 3, 4])
  })
})
