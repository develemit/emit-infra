'use client'

import { useEffect, useState } from 'react'
import styles from './splash-screen.module.css'

/* ────────────────────────────────────────────────────────────────────────
   Emit Infra — boot splash
   In-app loading screen shown on cold start while the shell hydrates and
   the first project list loads. Matches the dashboard's terminal theme.

   Two pieces:
     • <SplashScreen/>  – the pure visual (use directly if you want manual
                          control over when it shows / hides).
     • <SplashGate/>    – drop-in lifecycle wrapper: overlays the app on
                          first load, then fades out. Mount once in layout.
   ──────────────────────────────────────────────────────────────────────── */

// Cosmetic boot sequence. `at` is the progress-bar % when the step is shown.
const BOOT_STEPS = [
  { at: 10, label: 'connecting to tailnet' },
  { at: 38, label: 'authenticating session' },
  { at: 64, label: 'fetching projects' },
  { at: 86, label: 'reading container health' },
  { at: 100, label: 'ready' },
] as const

function prefersReducedMotion() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  )
}

export interface SplashScreenProps {
  /** When true, the overlay fades out (it stays mounted — let the parent unmount it). */
  leaving?: boolean
}

export function SplashScreen({ leaving = false }: SplashScreenProps) {
  const [step, setStep] = useState(0)

  // Advance the cosmetic boot sequence until we hit the last step.
  useEffect(() => {
    if (step >= BOOT_STEPS.length - 1) return
    const reduce = prefersReducedMotion()
    const delay = reduce ? 120 : 520 + Math.random() * 300
    const id = window.setTimeout(() => setStep((s) => s + 1), delay)
    return () => window.clearTimeout(id)
  }, [step])

  const current = BOOT_STEPS[Math.min(step, BOOT_STEPS.length - 1)]

  return (
    <div
      className={`${styles.stage} ${leaving ? styles.leaving : ''}`}
      role="status"
      aria-live="polite"
      aria-label="Loading Emit Infra"
    >
      <div className={styles.markWrap}>
        <div className={styles.mark}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path className={styles.bolt} d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
          </svg>
        </div>
      </div>

      <div className={styles.wordmark}>
        Emit&nbsp;<span className={styles.accent}>Infra</span>
      </div>
      <div className={styles.tagline}>develemit · self-hosted control</div>

      <div className={styles.boot}>
        <span className={styles.prompt}>$</span>
        <span className={styles.task}>{current.label}</span>
        <span className={styles.caret} aria-hidden="true" />
      </div>

      <div className={styles.track}>
        <div className={styles.fill} style={{ width: `${current.at}%` }} />
      </div>

      <div className={styles.footer}>
        <span className={styles.dot} />
        <span>secured · tailscale mesh</span>
      </div>
    </div>
  )
}

export interface SplashGateProps {
  /**
   * Minimum time (ms) the splash stays up so it never just flickers.
   * Default 1600.
   */
  minDuration?: number
}

/**
 * Overlays <SplashScreen/> on first load and removes it once the app is ready.
 *
 * "Ready" = `window` load event has fired AND `minDuration` has elapsed.
 * To dismiss it on REAL data readiness instead (e.g. after the first project
 * fetch resolves), dispatch a custom event from anywhere in the app:
 *
 *     window.dispatchEvent(new Event('emit:ready'))
 *
 * The gate listens for it and begins the fade immediately (still respecting
 * minDuration).
 */
export function SplashGate({ minDuration = 1600 }: SplashGateProps) {
  const [mounted, setMounted] = useState(true)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const start = performance.now()
    let done = false

    function dismiss() {
      if (done) return
      done = true
      const wait = Math.max(0, minDuration - (performance.now() - start))
      window.setTimeout(() => {
        setLeaving(true) // trigger CSS fade
        window.setTimeout(() => setMounted(false), 520) // unmount after fade
      }, wait)
    }

    // Real-readiness signal (optional) — fires the moment your data lands.
    window.addEventListener('emit:ready', dismiss, { once: true })

    // Fallback: window load (covers the app-shell case with no manual signal).
    if (document.readyState === 'complete') dismiss()
    else window.addEventListener('load', dismiss, { once: true })

    return () => {
      window.removeEventListener('emit:ready', dismiss)
      window.removeEventListener('load', dismiss)
    }
  }, [minDuration])

  if (!mounted) return null
  return <SplashScreen leaving={leaving} />
}
