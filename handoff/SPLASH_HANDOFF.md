# Emit Infra — Boot Splash · Handoff

A dark, terminal-green loading splash for the PWA, matching the dashboard's
design system (Geist + Geist Mono, `#10b981` accent, CRT scanlines, blinking
caret). Shown on cold start while the app shell hydrates and the first project
list loads, then fades out.

> **Scope note — two kinds of "splash".** This is the **in-app boot splash**
> (a React overlay you control). It is separate from the **native PWA splash**
> the OS paints before your JS runs. Your `manifest.json` already drives the
> native one (`background_color: #0a0a0b`, `theme_color: #10b981`, the 512px
> icon) — so the cold-start chrome already matches the brand. The component
> below takes over the moment the page renders, giving you the animated boot
> sequence. See "iOS native splash" at the bottom for the optional extra.

---

## Files

Copy both files into the dashboard app:

```
apps/dashboard/src/components/splash-screen.tsx
apps/dashboard/src/components/splash-screen.module.css
```

- `splash-screen.tsx` exports **`SplashScreen`** (the visual) and
  **`SplashGate`** (a drop-in lifecycle wrapper). Both are client components.
- `splash-screen.module.css` is a CSS Module — scoped, no globals touched.
  Colors are hard-coded to the **dark** brand palette on purpose, so the splash
  looks right even before `data-theme` hydrates and regardless of the user's
  stored light/dark preference. It reads your existing `--font-sans` /
  `--font-mono` variables from `globals.css`.

No new dependencies — the bolt mark is inline SVG. (If you'd rather use the
icon set you already ship, swap the `<svg>` for lucide's `<Zap/>` or your
`<Icon name="zap" />`.)

---

## Install — the one-line way (`SplashGate`)

Mount `SplashGate` once in the root layout, as a sibling of `<Shell>`. Because
the App Router layout persists across client navigations, it shows on the
initial load only — not on subsequent route changes.

```tsx
// apps/dashboard/app/layout.tsx
import { Shell } from '@/components/shell/shell'
import { SwRegister } from '@/components/sw-register'
import { SplashGate } from '@/components/splash-screen' // ← add

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-theme="dark"
      className={`${GeistSans.variable} ${GeistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <Shell>{children}</Shell>
        <SwRegister />
        <SplashGate />            {/* ← add */}
      </body>
    </html>
  )
}
```

That's it. The gate overlays the app, runs the boot animation, and fades out
when the app is ready.

### When does it dismiss?

`SplashGate` hides once **both** are true:

1. the window `load` event has fired, and
2. `minDuration` (default **1600 ms**) has elapsed — so it never just flickers.

Tune the floor if you like:

```tsx
<SplashGate minDuration={1200} />
```

---

## Install — tie it to real data (recommended)

The app-shell timing above is fine, but it's nicer to dismiss the splash the
instant your first project fetch lands. `SplashGate` listens for a custom
event — fire it from wherever your initial data resolves:

```tsx
// apps/dashboard/app/page.tsx — inside fetchAll(), after the first load
const ps = await getProjects()
setProjects(ps)
window.dispatchEvent(new Event('emit:ready')) // ← dismiss the splash
```

The gate still respects `minDuration`, so a very fast network won't cause a
flash. If the event never fires (e.g. the request hangs), the `load` fallback
still clears the splash so users are never stuck behind it.

> Prefer to guarantee the splash covers the *first paint of real content*?
> Render `<SplashGate/>` and call `emit:ready` only after `setProjects`, and
> keep `minDuration` at ~1400–1800 ms.

---

## Using `SplashScreen` directly (manual control)

If you want full control — e.g. gate on auth, or show it inside a specific
route — skip `SplashGate` and drive `SplashScreen` yourself:

```tsx
'use client'
import { useState } from 'react'
import { SplashScreen } from '@/components/splash-screen'

export function Boot({ children }: { children: React.ReactNode }) {
  const [leaving, setLeaving] = useState(false)
  const [show, setShow] = useState(true)

  // when your app is ready:
  //   setLeaving(true); setTimeout(() => setShow(false), 520)

  return (
    <>
      {children}
      {show && <SplashScreen leaving={leaving} />}
    </>
  )
}
```

`leaving` toggles the 0.5s fade; unmount ~520 ms later so the transition
completes.

---

## Customizing

| What | Where |
| --- | --- |
| Boot step labels / count | `BOOT_STEPS` array in `splash-screen.tsx` |
| Tagline / footer text | the JSX (`develemit · self-hosted control`, `secured · tailscale mesh`) |
| Brand mark | the inline `<svg>` `<path>` in `splash-screen.tsx` |
| Colors | the `--s-*` custom props at the top of `.stage` in the CSS module |
| Min on-screen time | `minDuration` prop on `SplashGate` |
| Fade duration | `transition: opacity 0.5s` on `.stage` (keep the unmount timeout in sync) |

**Accessibility:** the overlay is `role="status"` / `aria-live="polite"` and
the whole boot animation is disabled under `prefers-reduced-motion: reduce`
(content shows in its final state).

---

## Optional — iOS native launch image

iOS doesn't generate a launch screen from the web manifest the way Android
does; for an installed (Add to Home Screen) app it shows a blank background
unless you provide `apple-touch-startup-image` links. This is **optional** —
without it iOS just shows your `background_color`, which is already the brand
black.

If you want a branded native launch image too:

1. Render the splash visual to static PNGs at each device resolution (e.g. with
   a Playwright screenshot of a `/splash` route, or your existing
   `scripts/generate-icons.ts` + `sharp` pipeline).
2. Add `<link rel="apple-touch-startup-image" media="..." href="..." />` tags
   in `app/layout.tsx`'s `metadata` (Next supports these via the `icons` /
   custom `<head>` links) for each `media` size you target.

Because that image is static, keep it to the **end state** of this splash (mark
+ wordmark, no animation), so the handoff between the native launch image and
this animated component is seamless.

---

## Reference

The animated source of truth lives in the design project as
`Emit Infra Splash.html` — open it to preview the exact motion and timing this
component reproduces.
