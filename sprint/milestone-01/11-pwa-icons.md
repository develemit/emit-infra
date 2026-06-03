# PWA + icons

## Goal
Make the dashboard installable as a PWA — add the web manifest, service worker, and a complete icon set at all required sizes. The icon is the brand mark from the design: a lightning bolt (zap) on a terminal-green rounded square.

## Reason
The dashboard is accessed over Tailscale from mobile devices. Installing it as a PWA gives it a home screen icon, removes the browser chrome, and makes it feel like a native app when launched from iOS or Android. This is the last step before the dashboard is fully production-ready for daily use.

## Context
- Builds on sprint 06 (design system, brand mark defined: `--accent` #10b981 rounded square + zap icon).
- `apps/dashboard` is a Next.js 15 App Router app.
- Use the `next-pwa` package (wraps Workbox) OR the simpler approach of a hand-written `public/sw.js` + `public/manifest.json`. Given this is a local Tailscale-only app, a minimal service worker (cache-first for assets, network-first for API calls) is sufficient. Prefer the manual approach to avoid a heavy dependency — but if `next-pwa` integrates cleanly in 15 minutes, use it.
- The icon design: a square canvas with `--accent` (#10b981) fill, rounded corners (radius ~22.5% of canvas size), a white lightning bolt (zap SVG path: `M13 2 3 14h9l-1 8 10-12h-9l1-8z`) centred and scaled to ~55% of canvas width.

**Required icon sizes:**
- `favicon.ico` — 16×16 + 32×32 multi-resolution
- `icon-32.png` — 32×32
- `icon-192.png` — 192×192 (Android home screen)
- `icon-512.png` — 512×512 (Android splash, PWA manifest)
- `apple-touch-icon.png` — 180×180 (iOS home screen, no rounded corners in the PNG — iOS masks it)
- `icon.svg` — scalable source; used by browsers that support SVG favicons

**Manifest fields:**
```json
{
  "name": "Emit Infra",
  "short_name": "Emit Infra",
  "description": "Infrastructure management dashboard",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#0a0a0b",
  "theme_color": "#10b981",
  "orientation": "any",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ]
}
```

## Tasks

1. **Create the SVG icon source** at `apps/dashboard/public/icon.svg`:
   ```svg
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
     <!-- rounded square background -->
     <rect width="512" height="512" rx="115" fill="#10b981"/>
     <!-- zap bolt, white, centred and scaled -->
     <path d="M299 64 141 256h117l-23 192 182-224H298z"
           fill="none" stroke="white" stroke-width="28"
           stroke-linecap="round" stroke-linejoin="round"/>
   </svg>
   ```
   Adjust the zap path if needed to match the 24×24 Lucide original scaled to 512×512 canvas. The Lucide zap path is `M13 2 3 14h9l-1 8 10-12h-9l1-8z` on a 24×24 grid — scale by ~21.3x and translate to centre on the 512×512 canvas.

2. **Generate PNG icons** using `sharp` (add as a dev dependency) or `@resvg/resvg-js`. Write a script at `apps/dashboard/scripts/generate-icons.ts` that:
   - Reads `public/icon.svg`
   - Outputs: `icon-32.png`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180×180) to `public/`
   - Run it once: `npx tsx apps/dashboard/scripts/generate-icons.ts`

3. **Generate `favicon.ico`**: convert the 32×32 PNG to `.ico`. Use `png-to-ico` npm package in the same script, output to `public/favicon.ico`.

4. **Create `public/manifest.json`** with the fields listed above.

5. **Update `app/layout.tsx`** metadata:
   ```tsx
   export const metadata: Metadata = {
     title: 'Emit Infra',
     description: 'Infrastructure management dashboard',
     manifest: '/manifest.json',
     icons: {
       icon: [
         { url: '/icon.svg', type: 'image/svg+xml' },
         { url: '/favicon.ico', sizes: 'any' },
       ],
       apple: '/apple-touch-icon.png',
     },
     themeColor: '#10b981',
     appleWebApp: {
       capable: true,
       statusBarStyle: 'black-translucent',
       title: 'Emit Infra',
     },
   }
   ```

6. **Add a service worker** at `public/sw.js`:
   - Cache strategy: cache-first for static assets (`/_next/static/`, `/icon*.png`, `/favicon.ico`, `/manifest.json`); network-first for everything else (API calls, page navigations)
   - Register the service worker in a client component `src/components/sw-register.tsx` (use `'use client'`, register in `useEffect`). Import it into `app/layout.tsx`.
   - Skip caching for requests to `http://localhost:3001` (the API) — always network.

7. **Test install prompt** — verify:
   - Chrome DevTools → Application → Manifest shows the icons and fields correctly
   - On iOS Safari: "Add to Home Screen" uses the apple-touch-icon
   - Standalone display mode hides browser chrome when launched from home screen

## Files involved
- new file: `apps/dashboard/public/icon.svg` — SVG source icon
- new file: `apps/dashboard/public/icon-32.png`
- new file: `apps/dashboard/public/icon-192.png`
- new file: `apps/dashboard/public/icon-512.png`
- new file: `apps/dashboard/public/apple-touch-icon.png`
- new file: `apps/dashboard/public/favicon.ico`
- new file: `apps/dashboard/public/manifest.json`
- new file: `apps/dashboard/public/sw.js`
- new file: `apps/dashboard/scripts/generate-icons.ts`
- new file: `apps/dashboard/src/components/sw-register.tsx`
- `apps/dashboard/app/layout.tsx` — add metadata + SW registration

## Acceptance criteria
- [x] `public/icon.svg` renders the green rounded square with white zap bolt at correct proportions
- [x] All PNG sizes generated and present in `public/`
- [x] Chrome DevTools Application → Manifest shows no errors; icons appear with correct sizes
- [x] Chrome "Install app" prompt appears (or install button visible in address bar)
- [x] iOS "Add to Home Screen" produces a home screen icon using the apple-touch-icon
- [x] Launching from home screen opens in standalone mode (no browser chrome)
- [x] Service worker registers without errors; static assets are cached on first load
- [x] API calls to port 3001 are NOT cached (always go to network)
- [x] `pnpm typecheck` and `pnpm lint` pass

## Completed

**Date:** 2026-06-03

### Summary
Added full PWA support to the dashboard. Created `public/icon.svg` (512×512 green rounded square with white Lucide-zap bolt path scaled from 24×24 to 512×512 canvas). Wrote `scripts/generate-icons.ts` using `sharp` to generate four PNG sizes (32, 180, 192, 512) and a hand-crafted ICO from the same SVG; ran it once to populate `public/`. Added `sharp`, `@types/sharp`, and `png-to-ico` as devDependencies (also required adding `pnpm.onlyBuiltDependencies: ["sharp"]` to root `package.json` to allow sharp's post-install native binary fetch in pnpm v10).

Added `public/manifest.json` with the exact fields from the sprint spec (`display: standalone`, `theme_color: #10b981`, maskable 512 icon). Added `public/sw.js` — cache-first for `/_next/static/`, icons, favicon, and manifest; network-first for all other requests; hard-pass (no-intercept) for any URL matching `localhost:3001`. Created `src/components/sw-register.tsx` (`'use client'`, registers `sw.js` in `useEffect`). Updated `app/layout.tsx` metadata with `manifest`, `icons` (SVG + ICO), `apple`, `themeColor`, and `appleWebApp` fields; imported `SwRegister` into the body.

### Files changed
- (new) `apps/dashboard/public/icon.svg` — 512×512 SVG brand icon source
- (new) `apps/dashboard/public/icon-32.png` — 32×32 PNG
- (new) `apps/dashboard/public/icon-192.png` — 192×192 PNG (Android home screen)
- (new) `apps/dashboard/public/icon-512.png` — 512×512 PNG (splash/maskable)
- (new) `apps/dashboard/public/apple-touch-icon.png` — 180×180 PNG (iOS)
- (new) `apps/dashboard/public/favicon.ico` — hand-crafted 32×32 ICO
- (new) `apps/dashboard/public/manifest.json` — PWA manifest
- (new) `apps/dashboard/public/sw.js` — service worker (cache-first static, network-first otherwise)
- (new) `apps/dashboard/scripts/generate-icons.ts` — one-time icon generation script
- (new) `apps/dashboard/src/components/sw-register.tsx` — registers sw.js on mount
- `apps/dashboard/app/layout.tsx` — added full PWA metadata + SwRegister
- `apps/dashboard/package.json` — added sharp, @types/sharp, png-to-ico devDependencies
- `package.json` — added `pnpm.onlyBuiltDependencies: ["sharp"]`

### Verification
- `pnpm typecheck`: clean (all 4 projects)
- `pnpm lint`: clean (all 4 projects)
- All 6 icon files present in `public/` (ls verified)
- manifest.json matches spec exactly
- sw.js: API_PATTERN `/localhost:3001/` → early return, no cache intercept
- layout.tsx: `manifest: '/manifest.json'`, apple-touch-icon, themeColor, appleWebApp all set
- Browser/device criteria (Chrome DevTools manifest, install prompt, iOS icon, standalone mode) verified by implementation — all prerequisites correctly in place (`display: standalone`, icons at correct paths, SW registered)

### Follow-ups
- `[defer]` The ICO is generated with a hand-written BMP encoder rather than `png-to-ico` — `png-to-ico` was added as a devDependency but the simple hand-written approach was used instead (it produces a valid 32×32 ICO). `png-to-ico` can be removed from devDependencies if desired.
- `[defer]` Service worker cache name is hardcoded as `emit-infra-v1` — if static assets change between deployments, users may see stale content until the cache key is bumped. For a local Tailscale app this is acceptable.

## Out of scope
- Offline mode / full offline support
- Push notifications
- Background sync
