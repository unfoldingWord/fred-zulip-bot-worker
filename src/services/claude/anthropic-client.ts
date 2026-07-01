import type { RequestLogger } from '../../utils/logger.js';
import type { AnthropicMessage, ClaudeTool, MessageParam } from './types.js';
import { ClaudeAPIError } from '../../utils/errors.js';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const API_VERSION = '2023-06-01';

/**
 * Retry/backoff policy for transient Anthropic API failures (issue #23).
 *
 * Fred calls the Messages API with a bare `fetch`, so there is no built-in retry. These
 * constants add jittered exponential backoff for rate limits (429), transient 5xx, and
 * Anthropic `overloaded_error` (529), honoring `Retry-After`. The total is bounded by
 * {@link RETRY_OVERALL_WINDOW_MS} so a retry storm can't run for minutes; the orchestration
 * watchdog (`context.abortSignal`, issue #13) remains the ultimate time bound.
 *
 * Ported from bt-servant-worker `fetchAnthropicWithRetry` (issue #248), trimmed to Fred's
 * non-streaming call site.
 */
const RETRY_MAX_ATTEMPTS = 4; // 1 initial + 3 retries
const RETRY_BASE_MS = 1_000;
const RETRY_DELAY_CAP_MS = 30_000; // per-delay cap
const RETRY_OVERALL_WINDOW_MS = 180_000; // wall-clock cap across all attempts

/** HTTP statuses worth retrying: rate limit, transient 5xx, and Anthropic `overloaded_error`. */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

export interface CallClaudeParams {
  messages: MessageParam[];
  tools: ClaudeTool[];
  systemPrompt: string;
  model: string;
  maxTokens: number;
  apiKey: string;
  logger: RequestLogger;
  signal?: AbortSignal;
}

/**
 * Injectable clock seam so tests resolve backoff delays instantly and control the
 * jitter/elapsed-time inputs deterministically. Production uses {@link REAL_CLOCK}.
 *
 * `sleep` takes the orchestration abort signal so a backoff wait rejects the instant
 * the watchdog fires — otherwise a long `Retry-After` could park the pipeline past
 * `ORCHESTRATION_TIMEOUT_MS`, delaying the timeout reply and cleanup (PR #24 review).
 */
export interface RetryClock {
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
  random(): number;
}

export const REAL_CLOCK: RetryClock = {
  sleep: (ms, signal) =>
    new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException('Aborted', 'AbortError'));
        return;
      }
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(timer);
          reject(new DOMException('Aborted', 'AbortError'));
        },
        { once: true }
      );
    }),
  now: () => Date.now(),
  random: () => Math.random(),
};

/** Whether an Anthropic HTTP status should be retried. */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUSES.has(status);
}

/**
 * Full-jitter exponential backoff: `random(0, min(cap, base * 2^(attempt-1)))`.
 * `attempt` is 1-based (the attempt that just failed).
 */
export function computeBackoffDelay(attempt: number, random: () => number): number {
  const bound = Math.min(RETRY_DELAY_CAP_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
  return Math.round(random() * bound);
}

/**
 * Parse a `Retry-After` header into milliseconds. Supports delta-seconds and HTTP-date
 * forms; clamps negatives to 0; returns null when the header is absent/unparseable.
 */
export function parseRetryAfter(headers: Headers, now: () => number): number | null {
  const raw = headers.get('retry-after');
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, Math.round(seconds * 1000));
  const dateMs = Date.parse(raw);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - now());
}

/** Collect `anthropic-ratelimit-*` and `retry-after` response headers for diagnostics. */
function extractRatelimitHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    // eslint-disable-next-line security/detect-object-injection -- key comes from Headers iteration into a fresh object literal
    if (key.startsWith('anthropic-ratelimit-') || key === 'retry-after') out[key] = value;
  });
  return out;
}

/** True when a rejected `fetch` is a deliberate abort (the orchestration watchdog). */
function isAbortError(error: unknown): boolean {
  return (error as Error | undefined)?.name === 'AbortError';
}

/** A failed attempt — either an HTTP error response or a thrown network error. */
interface AttemptFailure {
  response?: Response;
  networkError?: unknown;
}

/** Whether a failed attempt is worth retrying (excludes deliberate aborts). */
function isRetryableFailure(failure: AttemptFailure): boolean {
  return failure.networkError
    ? !isAbortError(failure.networkError)
    : isRetryableStatus(failure.response!.status);
}

/** The backoff wait for a failed attempt: max(jittered exponential, Retry-After). */
function computeRetryDelay(
  attempt: number,
  failure: AttemptFailure,
  clock: RetryClock
): { delayMs: number; retryAfterMs: number } {
  const retryAfterMs = failure.response
    ? (parseRetryAfter(failure.response.headers, clock.now) ?? 0)
    : 0;
  const delayMs = Math.max(computeBackoffDelay(attempt, clock.random), retryAfterMs);
  return { delayMs, retryAfterMs };
}

function logRetry(
  logger: RequestLogger,
  failure: AttemptFailure,
  retry: { attempt: number; delayMs: number; retryAfterMs: number }
): void {
  logger.warn('claude_api_retry', {
    attempt: retry.attempt,
    max_attempts: RETRY_MAX_ATTEMPTS,
    status: failure.response?.status,
    delay_ms: retry.delayMs,
    retry_after_ms: retry.retryAfterMs || undefined,
    anthropic_ratelimit_headers: failure.response
      ? extractRatelimitHeaders(failure.response.headers)
      : undefined,
    network_error: failure.networkError ? (failure.networkError as Error).message : undefined,
  });
}

/** Surface a failed attempt as its terminal error (network rethrow or ClaudeAPIError). */
async function throwTerminal(logger: RequestLogger, failure: AttemptFailure): Promise<never> {
  if (failure.networkError) throw failure.networkError;
  const response = failure.response!;
  const errorBody = await response.text().catch(() => '');
  logger.error('claude_api_error', {
    status: response.status,
    body: errorBody.slice(0, 500),
  });
  throw new ClaudeAPIError(`Claude API returned ${response.status}`, response.status, errorBody);
}

/** Run a single Anthropic fetch; return the `ok` response or a described failure. */
async function attemptFetch(
  body: string,
  apiKey: string,
  signal: AbortSignal | undefined
): Promise<{ response: Response } | { failure: AttemptFailure }> {
  try {
    const response = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': API_VERSION,
      },
      body,
      signal: signal ?? null,
    });
    if (response.ok) return { response };
    return { failure: { response } };
  } catch (networkError) {
    return { failure: { networkError } };
  }
}

/**
 * Handle a failed attempt: either throw the terminal error (non-retryable, out of attempts,
 * or the backoff would blow the overall window) or return the delay to sleep before retrying.
 */
async function settleFailedAttempt(
  attempt: number,
  failure: AttemptFailure,
  overallStart: number,
  clock: RetryClock,
  logger: RequestLogger
): Promise<number> {
  const isLast = attempt >= RETRY_MAX_ATTEMPTS;
  const retryable = isRetryableFailure(failure);
  const { delayMs, retryAfterMs } = computeRetryDelay(attempt, failure, clock);
  const windowExceeded = clock.now() - overallStart + delayMs > RETRY_OVERALL_WINDOW_MS;

  if (!retryable || isLast || windowExceeded) {
    if (retryable) {
      logger.error('claude_api_retry_exhausted', {
        attempts: attempt,
        status: failure.response?.status,
        reason: isLast ? 'max_attempts' : 'overall_window_exceeded',
      });
    }
    // `await` (not a bare `return`) so the rejection handler attaches in the caller's
    // await chain immediately; a bare return defers it a microtask, which the test
    // runner can flag as a transient unhandled rejection (mirrors bt-servant #248).
    return await throwTerminal(logger, failure);
  }

  logRetry(logger, failure, { attempt, delayMs, retryAfterMs });
  // Drain the error body so the connection is freed before we back off.
  if (failure.response) await failure.response.text().catch(() => undefined);
  return delayMs;
}

/**
 * POST to the Anthropic Messages API with jittered exponential backoff (issue #23).
 *
 * Retries on {@link RETRYABLE_STATUSES} and transient network rejections, honoring
 * `Retry-After`. Bounded by {@link RETRY_MAX_ATTEMPTS} and {@link RETRY_OVERALL_WINDOW_MS}.
 * Deliberate aborts (the orchestration watchdog) are never retried. Returns a successful
 * (`ok`) response with its body not yet consumed.
 */
async function fetchAnthropicWithRetry(
  body: string,
  apiKey: string,
  logger: RequestLogger,
  signal: AbortSignal | undefined,
  clock: RetryClock
): Promise<Response> {
  const overallStart = clock.now();

  for (let attempt = 1; attempt <= RETRY_MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');

    const outcome = await attemptFetch(body, apiKey, signal);
    if ('response' in outcome) return outcome.response;

    // settleFailedAttempt throws on a terminal failure; otherwise returns the backoff delay.
    // Pass the signal so the wait rejects immediately if the watchdog aborts mid-backoff.
    await clock.sleep(
      await settleFailedAttempt(attempt, outcome.failure, overallStart, clock, logger),
      signal
    );
  }

  // Unreachable: the final attempt always returns or throws inside the loop.
  throw new Error('fetchAnthropicWithRetry: exhausted loop without resolution');
}

export async function callClaude(
  params: CallClaudeParams,
  clock: RetryClock = REAL_CLOCK
): Promise<AnthropicMessage> {
  const { messages, tools, systemPrompt, model, maxTokens, apiKey, logger, signal } = params;
  const startMs = Date.now();

  const body = JSON.stringify({
    model,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages,
    tools: tools.length > 0 ? tools : undefined,
  });

  const response = await fetchAnthropicWithRetry(body, apiKey, logger, signal, clock);

  const result = (await response.json()) as AnthropicMessage;
  logger.log('claude_api_call', {
    model: result.model,
    input_tokens: result.usage.input_tokens,
    output_tokens: result.usage.output_tokens,
    latency_ms: Date.now() - startMs,
  });

  return result;
}
