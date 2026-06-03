import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)',
        elev: 'var(--bg-elev)',
        card: 'var(--card)',
        'card-2': 'var(--card-2)',
        'card-hover': 'var(--card-hover)',
        border: 'var(--border)',
        strong: 'var(--border-strong)',
        fg: 'var(--fg)',
        muted: 'var(--fg-muted)',
        subtle: 'var(--fg-subtle)',
        faint: 'var(--fg-faint)',
        accent: 'var(--accent)',
        'accent-bright': 'var(--accent-bright)',
        'accent-fg': 'var(--accent-fg)',
        'accent-soft': 'var(--accent-soft)',
        'accent-line': 'var(--accent-line)',
        ok: 'var(--ok)',
        'ok-soft': 'var(--ok-soft)',
        warn: 'var(--warn)',
        'warn-soft': 'var(--warn-soft)',
        err: 'var(--err)',
        'err-soft': 'var(--err-soft)',
        'err-line': 'var(--err-line)',
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        mono: ['var(--font-mono)'],
      },
      boxShadow: {
        card: 'var(--shadow)',
        'card-lg': 'var(--shadow-lg)',
      },
    },
  },
  plugins: [],
}

export default config
