import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: {
      '@emit-infra/core': resolve(__dirname, '../../packages/core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
  },
})
