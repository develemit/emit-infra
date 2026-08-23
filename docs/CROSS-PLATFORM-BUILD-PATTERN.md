# Cross-platform build pattern

↩ back to [the shared pre-push hook overview](PRE-PUSH-HOOK.md). Related:
[Build internals](DEPLOY-BUILD-INTERNALS.md).

On an Apple Silicon build host, `docker buildx build --platform linux/amd64`
runs every stage under QEMU emulation by default — expensive for anything
CPU-bound (`pnpm install` postinstall scripts, `nx build`/esbuild bundling,
tsc). Node output itself is architecture-independent, so only the stage that
actually ships needs to resolve to the target platform; everything upstream
of it can run natively on the build host.

**The technique:** pin the stages that only produce JS artifacts to
`$BUILDPLATFORM` (BuildKit resolves this to the host's real platform — e.g.
`linux/arm64` on an Apple Silicon Docker Desktop VM, run natively, no
emulation). Leave the stage that's actually shipped (and any stage — like a
migration runner — that executes compiled output) on a plain `FROM`, which
resolves to whatever `--platform` was requested on the CLI (`linux/amd64` for
the Hetzner fleet):

```dockerfile
# deps/builder only produce arch-independent JS artifacts, so they run
# natively on the build host. runner stays on the requested --platform
# since that's what actually ships.
FROM --platform=$BUILDPLATFORM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@10.30.2 --activate
WORKDIR /app

FROM base AS deps
# ... COPY package.json files, pnpm install --frozen-lockfile ...

FROM base AS builder
# ... COPY --from=deps node_modules, COPY . ., nx build ...

# plain FROM, not `base` — this stage ships and must resolve to the
# requested target platform, not the native build host's.
FROM node:22-alpine AS runner
WORKDIR /app
COPY --from=builder /app/dist/apps/<svc> ./
CMD ["node", "main.cjs"]
```

Reference implementation: develemail's `apps/api/Dockerfile` (also has a
`migrate` variant target that exercises the native-module case below).

**The native-module trap.** Anything with a platform-specific compiled
binary — `sharp`, `@next/swc-*`, `esbuild`, `@parcel/watcher`, `@swc/core` are
common ones in a Next.js/Nx workspace — gets installed for the *build host's*
architecture in a `$BUILDPLATFORM` stage. If that stage's `node_modules` (or
anything traced from it, like a Next.js standalone output) ends up in the
shipped image, you get arm64 binaries in an amd64 container: a crash at
startup, not a build-time failure. Two sub-cases:

- **Ships to runtime** (e.g. `sharp`, bundled into Next's `.next/standalone`
  output): needs the *target* platform's binary in the stage that gets
  copied forward.
- **Only executes during the build or a build-adjacent step** (e.g.
  `esbuild`/`@swc/core` compiling, or `drizzle-kit` — which depends on
  `esbuild` directly — running in a `migrate` stage that reuses `deps`'
  `node_modules` on the target platform): needs the *build host's* binary to
  run at all, and separately needs the *target* binary wherever that
  `node_modules` gets copied onto a target-platform stage.

Fix with pnpm's `supportedArchitectures` (in the root `package.json`'s `pnpm`
field — not `.npmrc`; pnpm resolves this per-package.json, not as a flat
config key, as of pnpm 10.x):

```jsonc
"pnpm": {
  "supportedArchitectures": {
    "os": ["linux", "darwin", "current"],
    "cpu": ["x64", "arm64"],
    "libc": ["musl", "glibc"]
  }
}
```

This installs both arch's optional platform binaries wherever pnpm resolves
them, so the `$BUILDPLATFORM` stage can execute its own build tools *and*
whatever gets copied into a target-platform stage resolves the correct
binary at runtime (packages like `sharp`/`@next/swc-*` pick their binary via
`process.platform`/`process.arch` at require time, so having both installed
is sufficient — no per-stage filtering needed). `os`/`libc` stay broad
(`darwin` alongside `linux`, `glibc` alongside `musl`) so this doesn't break
local development on macOS.

This is a workspace-wide setting — it applies to every Dockerfile's
`pnpm install`, not just the one that needs it, so services with zero native
runtime dependencies (nothing shipped past a fully-bundled `main.cjs`, no
`migrate`-style stage) pay a small, measurable tax in `pnpm install` and
inter-stage `COPY node_modules` time for binaries they'll never use. Confirm
whether a service actually needs it (grep its shipped output for native
`require`s / check whether any stage reuses `deps`' full `node_modules` on a
different platform than it was installed on) before assuming the workspace
default is free.

**The untaxed path, confirmed in practice (sprint 266):** emit-vision's four
services (`web`, `api`, `worker`, `marketing`) converted with zero
`supportedArchitectures` — a full workspace-wide grep across every
`package.json` (including transitively-copied `packages/*`) turned up no
`sharp`/`@next/swc-*`/`esbuild`/`@parcel/watcher`/`@swc/core`-class package
anywhere in the four services' shipped surface: `api`/`worker` ship a single
`tsup --bundle` `.cjs` with zero `node_modules` in the runner (aside from a
data-only asset directory, not code), and `web`/`marketing`'s Next.js
standalone output traced no native binding either. Result: 200s → 119s
build phase (-40%) with no install tax paid anywhere. Don't reach for
`supportedArchitectures` by default — grep first; plenty of workspaces have
nothing that needs it.

**Both sub-cases confirmed in practice.** diner-decider (sprint 267) hit the
**ships-to-runtime** sub-case: its `api` shipped `sharp` for the R2 photo
pipeline, so the runner stage needed the target platform's `sharp` binary
traced forward from `node_modules`. tastease (sprint 268) hit the
**build-adjacent** sub-case, and it's worth walking through because no prior
sprint (255/266/267) had actually triggered it: `apps/api`'s `migrate` target
was `FROM builder AS migrate` — an empty stage that just inherits `builder`
wholesale. Once `builder` moved to `$BUILDPLATFORM`, `migrate` would have
silently inherited that native platform too (`FROM <alias>` doesn't
re-resolve against the CLI's requested `--platform`). `migrate` runs `npx tsx
packages/db/src/migrate.ts` on the server at container *start*, and `tsx`
shells out to esbuild's native binary at that point — not at build time — so
a native-host `migrate` image would have crashed on the amd64 server with an
exec-format error the first time someone ran a migration, well after the
image had already built and pushed successfully. Fixed by giving `migrate`
its own plain `FROM node:22-alpine` stage (matching develemail's reference
`migrate` pattern) instead of inheriting `builder`, plus
`pnpm.supportedArchitectures` in tastease's root `package.json` so both
platforms' esbuild binaries are available for `tsx` to pick the right one
from at runtime.

**Verify before shipping**, every time this pattern touches a service with
native dependencies: `docker buildx build --platform linux/amd64 ... --load`,
then `docker run --platform linux/amd64 <image>` and confirm it fails (or
succeeds) on something *other* than an exec-format or "wrong ELF class"
error — a missing env var or a refused DB connection is a clean pass; a
native-module crash is not. A real deploy with server-side log verification
is the definitive check.
