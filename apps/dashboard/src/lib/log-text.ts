const ANSI_PATTERN = /\x1b\[[0-9;]*[a-zA-Z]/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, '')
}

export function filterLines(lines: string[], query: string): number[] {
  const q = query.trim().toLowerCase()
  if (!q) return lines.map((_, i) => i)
  const indexes: number[] = []
  lines.forEach((line, i) => {
    if (line.toLowerCase().includes(q)) indexes.push(i)
  })
  return indexes
}

export function logFilename(project: string, type: 'ci' | 'deploy', sha: string): string {
  return `${project}-${type}-${sha.slice(0, 7)}.log`
}

export interface TextSegment {
  text: string
  match: boolean
}

export function splitByMatch(line: string, query: string): TextSegment[] {
  const q = query.trim()
  if (!q) return [{ text: line, match: false }]

  const lower = line.toLowerCase()
  const qLower = q.toLowerCase()
  const segments: TextSegment[] = []
  let i = 0
  while (i < line.length) {
    const idx = lower.indexOf(qLower, i)
    if (idx === -1) {
      segments.push({ text: line.slice(i), match: false })
      break
    }
    if (idx > i) segments.push({ text: line.slice(i, idx), match: false })
    segments.push({ text: line.slice(idx, idx + q.length), match: true })
    i = idx + q.length
  }
  return segments
}
