import tseslint from '@typescript-eslint/eslint-plugin'
import tsparser from '@typescript-eslint/parser'
import nextPlugin from '@next/eslint-plugin-next'

const { flatConfig: nextFlatConfig } = nextPlugin

export default [
  {
    files: ['**/*.ts', '**/*.tsx'],
    plugins: { '@typescript-eslint': tseslint },
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: true,
        ecmaVersion: 2022,
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-module-boundary-types': 'off',
    },
  },
  {
    // Registers the plugin with NO `files` scoping and NO rules turned on.
    // Next's own build-time lint check (runLintCheck.js) decides whether
    // "the Next.js plugin was detected" by calling calculateConfigForFile()
    // against the eslint.config.js path itself and the nearest package.json —
    // neither of which is a .ts/.tsx file, so a `files`-scoped block (however
    // correct for actually linting dashboard code) is invisible to that
    // check and the warning persists regardless (sprint 306). Plugin
    // registration alone is inert for every other file — only the rules
    // block below, scoped to dashboard, turns anything on.
    plugins: { '@next/next': nextPlugin },
  },
  {
    files: ['apps/dashboard/**/*.ts', 'apps/dashboard/**/*.tsx'],
    rules: {
      ...nextFlatConfig.recommended.rules,
      // Dashboard is App Router only — there's no pages/ directory anywhere
      // in this repo, so this rule's one-time "Pages directory cannot be
      // found" console.warn is itself noise, not a finding.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    ignores: ['dist/**', '**/dist/**', 'node_modules/**', '.nx/**', '**/.next/**', '**/next-env.d.ts'],
  },
]
