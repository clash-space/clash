/**
 * Shared fetch-with-retry helper for resource-resolution hooks
 * (`useAsset`, `useSignedUrl`, ...).
 *
 * Why this exists: the asset pipeline has a lot of pinch points (gateway
 * restart, workerd cold start, local D1 slow under concurrency) where one
 * failed request used to leave a node's spinner on forever — both hooks
 * `.catch()` the error and set a terminal "unresolved" state, and there
 * was no automatic retry. A short retry with exponential backoff + jitter
 * gets most of those transient blips back without hammering the server
 * when something is genuinely broken.
 *
 * Retry policy:
 *   - network error (no response) → retry
 *   - 5xx / 408 / 429              → retry
 *   - any other 4xx                → no retry (genuine "not found" / auth)
 *
 * Last attempt's error is thrown. `fetch` itself is not wrapped — we throw
 * a typed `RetriableError` to let callers distinguish "really gone" from
 * "we gave up retrying".
 */

export interface RetryOptions {
  /** Max total attempts including the first one. Default 2 (= 1 retry). */
  maxAttempts?: number;
  /** Base backoff in ms (attempt 1 waits 0; subsequent waits grow). Default 300. */
  baseMs?: number;
  /** Cap on a single backoff interval. Default 1500. */
  capMs?: number;
  /** Abort signal to stop retrying. */
  signal?: AbortSignal;
}

export class FetchRetryError extends Error {
  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastStatus?: number,
  ) {
    super(message);
    this.name = 'FetchRetryError';
  }
}

const TRANSIENT_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

function computeDelay(attempt: number, baseMs: number, capMs: number): number {
  // Full jitter: random in [0, min(cap, base * 2^(attempt-1)))
  const exp = Math.min(capMs, baseMs * 2 ** (attempt - 1));
  return Math.random() * exp;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/**
 * Fetch `url` with retry on transient failures. Returns the final Response
 * (successful or non-retriable). Throws `FetchRetryError` only when all
 * attempts failed with a transient error, or when the underlying `fetch`
 * kept rejecting (network layer).
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  options: RetryOptions = {},
): Promise<Response> {
  const { maxAttempts = 2, baseMs = 300, capMs = 1500, signal } = options;

  let lastErr: unknown;
  let lastStatus: number | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    try {
      const res = await fetch(url, { ...init, signal: init.signal ?? signal });
      if (res.ok) return res;
      lastStatus = res.status;
      // Non-retriable 4xx: hand the response to the caller so it can branch on status.
      if (!TRANSIENT_STATUSES.has(res.status)) return res;
      lastErr = new Error(`HTTP ${res.status}`);
    } catch (err) {
      // AbortError: caller cancelled, bubble up.
      if ((err as { name?: string })?.name === 'AbortError') throw err;
      lastErr = err;
    }

    if (attempt < maxAttempts) {
      await sleep(computeDelay(attempt, baseMs, capMs), signal);
    }
  }

  throw new FetchRetryError(
    `fetchWithRetry gave up after ${maxAttempts} attempts`,
    maxAttempts,
    lastStatus,
  );
}
