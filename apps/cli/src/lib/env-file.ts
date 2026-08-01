// Digits must be allowed after the first character: keys like R2_BUCKET and
// S3_REGION are real and were silently dropped by an earlier [A-Z_]+ pattern,
// which made the env-removal guard report phantom removals (sprint 244).
// Mirrors the shape used by the SSH-side reads and apps/api/src/routes/secrets.ts.
const ENV_LINE_PATTERN = /^\s*[A-Za-z_][A-Za-z0-9_]*=/

export function parseEnvEntries(content: string): [string, string][] {
  return content
    .split('\n')
    .filter(line => ENV_LINE_PATTERN.test(line))
    .map(line => {
      const idx = line.indexOf('=')
      return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()] as [string, string]
    })
}
