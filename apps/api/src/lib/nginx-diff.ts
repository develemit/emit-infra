export function normalizeConfig(raw: string): string[] {
  const lines = raw.split('\n').map(line => line.replace(/[ \t]+$/, ''))
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function diffConfigLines(local: string[], server: string[], maxLines = 200): string[] {
  if (local.length === server.length && local.every((line, i) => line === server[i])) return []

  const max = Math.max(local.length, server.length)
  const lines: string[] = []

  for (let i = 0; i < max; i++) {
    const localLine = local[i]
    const serverLine = server[i]

    if (localLine === serverLine) {
      if (localLine !== undefined) lines.push(`  ${localLine}`)
      continue
    }
    if (serverLine !== undefined) lines.push(`- ${serverLine}`)
    if (localLine !== undefined) lines.push(`+ ${localLine}`)
  }

  if (lines.length > maxLines) {
    const clipped = lines.slice(0, maxLines)
    clipped.push(`... (${lines.length - maxLines} more lines)`)
    return clipped
  }
  return lines
}
