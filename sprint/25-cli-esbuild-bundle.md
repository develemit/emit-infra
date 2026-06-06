# Bundle CLI with esbuild for direct invocation

**Difficulty:** 2

## Goal
Replace the `@nx/js:tsc` build with an esbuild bundle so `emit-infra` can be
run directly as `node dist/index.js` (or via a global `npm link`) without
needing `tsx` or a workspace `node_modules` on the PATH.

## Reason
The current build uses `moduleResolution: "bundler"` in tsconfig, which
means bare specifiers like `commander` are resolved by a bundler at build
time — but `@nx/js:tsc` just transpiles; it doesn't bundle. Running the dist
file directly with Node fails:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'commander'
```

The only working invocation today is `tsx apps/cli/src/index.ts` from the
emit-infra repo root, which is not a viable UX for other projects wanting to
call `emit-infra hooks`. The fix is to bundle everything into a single
self-contained JS file.

## Context
- `apps/cli/project.json` — swap the `build` target's executor from
  `@nx/js:tsc` to `@nx/esbuild:esbuild` (or plain `nx:run-commands` calling
  `esbuild` directly).
- `apps/cli/package.json` — `bin.emit-infra` currently points to
  `./dist/index.js`; the bundle output path should match.
- `apps/cli/tsconfig.json` — change `moduleResolution` from `"bundler"` to
  `"node"` (or remove it) so tsc typecheck still works cleanly without esbuild.
- The bundle must target `node` platform, `esm` format, and bundle all
  `dependencies` (commander, chalk, execa, ora, `@emit-infra/core`).
- `@emit-infra/core` is a workspace package — esbuild will inline it from
  source. That's fine; the CLI is the only consumer.

### Recommended esbuild invocation

```
esbuild apps/cli/src/index.ts \
  --bundle \
  --platform=node \
  --format=esm \
  --outfile=dist/apps/cli/index.js \
  --external:node:* \
  --sourcemap
```

Keep `node:*` external (built-ins are always available at runtime). Bundle
everything else.

### project.json build target after change

```json
{
  "build": {
    "executor": "nx:run-commands",
    "outputs": ["{workspaceRoot}/dist/apps/cli"],
    "options": {
      "command": "esbuild apps/cli/src/index.ts --bundle --platform=node --format=esm --outfile=dist/apps/cli/index.js --external:node:* --sourcemap"
    },
    "dependsOn": ["^build"]
  }
}
```

Remove the `^build` dependency on `core:build` since esbuild inlines it from
TS source directly — no pre-build step needed.

## Tasks

1. Add `esbuild` as a dev dependency in the workspace root:
   ```
   pnpm add -D esbuild -w
   ```

2. Update `apps/cli/project.json` — replace the `build` target as shown above.

3. Update `apps/cli/tsconfig.json` — change `moduleResolution` from
   `"bundler"` to `"node16"` (keeps ESM imports valid for tsc without needing
   a bundler to resolve them).

4. Update `apps/cli/package.json` — verify `bin.emit-infra` points to
   `./dist/apps/cli/index.js` (relative to the package root, so the path
   resolves correctly after `npm link` or global install). Actually since
   the bin is declared in the package, adjust to `"./../../dist/apps/cli/index.js"`
   or, more cleanly, copy the bundle into `apps/cli/dist/index.js` via the
   outfile path. Use `--outfile=dist/apps/cli/index.js` from workspace root,
   which means `apps/cli/package.json`'s bin should be `../../dist/apps/cli/index.js`.
   Alternatively, move outfile to `apps/cli/dist/index.js` and update the
   Nx outputs accordingly — whichever makes the bin path simpler.

5. Build and verify:
   ```
   pnpm nx run cli:build
   node dist/apps/cli/index.js --help
   node dist/apps/cli/index.js hooks --help
   ```

6. Run `pnpm tsc --noEmit -p apps/cli/tsconfig.json` — confirm clean.

## Files involved

- `apps/cli/project.json` — swap build executor
- `apps/cli/tsconfig.json` — fix moduleResolution
- `apps/cli/package.json` — verify bin path
- `package.json` (root) — add esbuild devDependency

## Acceptance criteria

- [x] `pnpm nx run cli:build` succeeds and emits a single `index.js`
- [x] `node <path-to-dist>/index.js --help` prints the CLI help without errors
- [x] `node <path-to-dist>/index.js hooks --help` works
- [x] `pnpm tsc --noEmit -p apps/cli/tsconfig.json` is clean
- [x] No other project's build is broken (run `pnpm nx run-many -t build`)

## Completed

**Date:** 2026-06-06

### Summary
Replaced the `@nx/js:tsc` executor with an esbuild build script (`apps/cli/esbuild.mjs`)
invoked via `nx:run-commands`. The build script bundles all npm dependencies into a
single 592kb self-contained ESM file at `apps/cli/dist/index.js`, matching the existing
`bin: "./dist/index.js"` entry in `package.json` without any path changes. The bundle
outputs to `apps/cli/dist/` (using `{projectRoot}/dist` as the Nx output) so `npm link`
from `apps/cli/` works correctly.

Two issues were caught and corrected post-Haiku: (1) the agent marked all npm deps as
external, defeating the self-contained bundle goal — corrected to only externalize
`node:*`; (2) `commander` uses CJS `require('node:events')` internally, which breaks in
an ESM bundle when node built-ins are external. Fixed by adding a `createRequire` banner
to the esbuild config so the CJS→ESM shim has a `require()` available for node built-ins.

The `dashboard:build` failure seen in `run-many` is a pre-existing Next.js `<Html>` import
error unrelated to this sprint.

### Files changed
- `apps/cli/project.json` — replaced `@nx/js:tsc` executor with `nx:run-commands` calling `node apps/cli/esbuild.mjs`; outputs updated to `{projectRoot}/dist`; removed `dependsOn`
- `apps/cli/tsconfig.json` — changed `moduleResolution` and `module` to `Node16`; removed `outDir`
- (new) `apps/cli/esbuild.mjs` — esbuild config: bundle, platform=node, format=esm, createRequire banner for CJS interop
- `package.json` (root) — added `esbuild ^0.28.0` devDependency

### Verification
- `pnpm nx run cli:build`: succeeds, emits `apps/cli/dist/index.js` (592kb) + sourcemap
- `node apps/cli/dist/index.js --help`: prints full command list
- `node apps/cli/dist/index.js hooks --help`: prints hooks command help
- `pnpm tsc --noEmit -p apps/cli/tsconfig.json`: exit 0, clean
- `pnpm nx run-many -t build`: core/api/cli all pass; dashboard pre-existing failure unrelated to this sprint

### Follow-ups
- `[defer]` dashboard:build has a pre-existing `<Html> should not be imported outside of pages/_document` failure — worth investigating separately
- `[defer]` bundle size is 592kb; if startup latency becomes noticeable, `--minify` can be added to the esbuild config
