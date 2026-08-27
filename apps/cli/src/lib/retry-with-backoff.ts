export interface RetryOptions {
  maxAttempts?: number
  initialDelayMs?: number
  factor?: number
  isRetryable?: (err: unknown) => boolean
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Retries `fn` with exponential backoff — not a fixed `sleep`, which the
 * repo already swept out as an anti-pattern (sprint 303,
 * `docs/TEST-TIMING-PATTERNS.md`). Re-throws the last error once `maxAttempts`
 * is exhausted or `isRetryable` rejects it, so callers can distinguish a
 * genuine failure from "ran out of budget."
 */
export async function retryWithBackoff<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 5,
    initialDelayMs = 1000,
    factor = 2,
    isRetryable = () => true,
    sleep = defaultSleep,
  } = opts

  let lastErr: unknown
  let delay = initialDelayMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt === maxAttempts || !isRetryable(err)) throw err
      await sleep(delay)
      delay *= factor
    }
  }

  throw lastErr
}
