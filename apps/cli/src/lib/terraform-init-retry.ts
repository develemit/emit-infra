import { retryWithBackoff, type RetryOptions } from './retry-with-backoff.js'

const AUTH_ERROR_PATTERN = /401|unauthorized/i

/**
 * `setup.ts` mints a fresh R2 token and runs `terraform init` against it
 * immediately — Cloudflare's token propagation lags real-world use by a few
 * seconds, so the first attempt can 401 against valid credentials (confirmed:
 * the same key/secret worked via `aws s3 ls` moments later). `runTerraform`'s
 * inherit-mode error collapses to a bare "exited with code N", so callers
 * must capture Terraform's stderr themselves and fold it into the thrown
 * error's message for this to have anything to match against.
 */
export function isTransientR2AuthError(err: unknown): boolean {
  return err instanceof Error && AUTH_ERROR_PATTERN.test(err.message)
}

/**
 * Wraps a `terraform init` call with bounded retry-with-backoff for the
 * post-token-mint propagation race. On exhaustion, only rewrites the error
 * message when the failure looks like the propagation case — a genuine
 * permissions error passes through unchanged so it isn't misdiagnosed either.
 */
export async function terraformInitWithR2Retry(
  runInit: () => Promise<void>,
  opts: Partial<RetryOptions> = {},
): Promise<void> {
  try {
    await retryWithBackoff(runInit, {
      maxAttempts: 6,
      initialDelayMs: 2000,
      isRetryable: isTransientR2AuthError,
      ...opts,
    })
  } catch (err) {
    if (isTransientR2AuthError(err)) {
      throw new Error(
        `Terraform init failed with an auth error after retries. The R2 token was minted moments ago — ` +
          `this is very likely Cloudflare token propagation delay, not a real permissions problem. ` +
          `Wait ~30s and re-run "emit-infra terraform-init", or re-run "emit-infra setup".\n\n` +
          `Original error: ${(err as Error).message}`,
      )
    }
    throw err
  }
}
