export interface PaletteItem {
  id: string
  label: string
  icon: string
  href: string
}

export const STATIC_ITEMS: PaletteItem[] = [
  { id: 'home', label: 'Home', icon: 'overview', href: '/' },
  { id: 'health', label: 'Fleet Health', icon: 'layers', href: '/health' },
  { id: 'ops', label: 'Ops', icon: 'ops', href: '/ops' },
  { id: 'ci', label: 'CI', icon: 'activity', href: '/ci' },
  { id: 'logs', label: 'Logs', icon: 'logs', href: '/logs' },
  { id: 'provision', label: 'Provision', icon: 'server', href: '/provision' },
]

const PROJECT_PAGES = [
  { slug: '', label: 'Overview', icon: 'projects' },
  { slug: 'networking', label: 'Networking', icon: 'globe' },
  { slug: 'storage', label: 'Storage', icon: 'database' },
  { slug: 'pipelines', label: 'Pipelines', icon: 'zap' },
  { slug: 'reliability', label: 'Reliability', icon: 'shield' },
  { slug: 'data', label: 'Data & Secrets', icon: 'lock' },
  { slug: 'admin', label: 'Administration', icon: 'settings' },
]

export function buildProjectItems(names: string[]): PaletteItem[] {
  return names.flatMap(name => {
    const base = `/projects/${encodeURIComponent(name)}`
    return PROJECT_PAGES.map(page => ({
      id: `${name}:${page.slug || 'overview'}`,
      label: page.slug ? `${name} → ${page.label}` : name,
      icon: page.icon,
      href: page.slug ? `${base}/${page.slug}` : base,
    }))
  })
}

function isSubsequence(query: string, target: string): boolean {
  let i = 0
  for (const ch of target) {
    if (ch === query[i]) i++
    if (i === query.length) return true
  }
  return i === query.length
}

export function filterItems(items: PaletteItem[], query: string): PaletteItem[] {
  const q = query.trim().toLowerCase()
  if (!q) return items
  const substring: PaletteItem[] = []
  const subsequence: PaletteItem[] = []
  for (const item of items) {
    const label = item.label.toLowerCase()
    if (label.includes(q)) substring.push(item)
    else if (isSubsequence(q, label)) subsequence.push(item)
  }
  return [...substring, ...subsequence]
}
