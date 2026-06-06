import { build } from 'esbuild'

await build({
  entryPoints: ['apps/cli/src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'apps/cli/dist/index.js',
  external: ['node:*'],
  sourcemap: true,
  banner: {
    js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);",
  },
})
