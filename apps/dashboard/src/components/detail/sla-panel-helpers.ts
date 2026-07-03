export function slaColor(value: number): string {
  if (value >= 99.9) return 'var(--ok)'
  if (value >= 99) return 'var(--warn)'
  return 'var(--err)'
}
