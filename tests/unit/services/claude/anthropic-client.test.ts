import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  callClaude,
  isRetryableStatus,
  computeBackoffDelay,
  parseRetryAfter,
  type RetryClock,
  type CallClaudeParams,
} from '../../../../src/services/claude/anthropic-client.js';
import { ClaudeAPIError } from '../../../../src/utils/errors.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

/** Hoisted so inline `() => n` arrows don't trip max-nested-callbacks in nested describes. */
const constRandom = (value: number) => () => value;

/** A fake clock with zero real sleeps and deterministic jitter/elapsed inputs. */
function makeClock(overrides?: Partial<RetryClock>): RetryClock {
  return {
    sleep: vi.fn().mockResolvedValue(undefined),
    now: () => 0,
    random: () => 0.5,
    ...overrides,
  };
}

function makeParams(overrides?: Partial<CallClaudeParams>): CallClaudeParams {
  return {
    messages: [{ role: 'user', content: 'Hi' }],
    tools: [],
    systemPrompt: 'You are Fred.',
    model: 'claude-sonnet-4-6',
    maxTokens: 4096,
    apiKey: 'api-key',
    logger,
    ...overrides,
  };
}

function messageResponse() {
  return new Response(
    JSON.stringify({
      id: 'msg_1',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-4-6',
      content: [{ type: 'text', text: 'Hello!' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
    { status: 200 }
  );
}

function errorResponse(status: number, headers?: Record<string, string>) {
  return new Response(JSON.stringify({ error: { type: 'rate_limit_error' } }), { status, headers });
}

describe('anthropic-client retry helpers', () => {
  describe('isRetryableStatus', () => {
    it('retries rate limit, transient 5xx, and overloaded', () => {
      for (const s of [429, 500, 502, 503, 504, 529]) expect(isRetryableStatus(s)).toBe(true);
    });
    it('does not retry non-transient 4xx', () => {
      for (const s of [400, 401, 403, 404]) expect(isRetryableStatus(s)).toBe(false);
    });
  });

  describe('computeBackoffDelay', () => {
    it('scales exponentially with full jitter', () => {
      // random() === 1 → full bound = base * 2^(attempt-1)
      expect(computeBackoffDelay(1, constRandom(1))).toBe(1_000);
      expect(computeBackoffDelay(2, constRandom(1))).toBe(2_000);
      expect(computeBackoffDelay(3, constRandom(1))).toBe(4_000);
    });
    it('jitters between 0 and the bound', () => {
      expect(computeBackoffDelay(3, constRandom(0))).toBe(0);
      expect(computeBackoffDelay(2, constRandom(0.5))).toBe(1_000);
    });
    it('respects the 30s per-delay cap', () => {
      // attempt 10 uncapped would be 512s; capped at 30s
      expect(computeBackoffDelay(10, constRandom(1))).toBe(30_000);
    });
  });

  describe('parseRetryAfter', () => {
    const now = () => 1_000_000;
    it('parses delta-seconds', () => {
      expect(parseRetryAfter(new Headers({ 'retry-after': '2' }), now)).toBe(2_000);
    });
    it('parses HTTP-date form relative to now', () => {
      const future = new Date(1_000_000 + 5_000).toUTCString();
      const ms = parseRetryAfter(new Headers({ 'retry-after': future }), now)!;
      // toUTCString truncates to whole seconds, so allow a sub-second slop
      expect(ms).toBeGreaterThanOrEqual(4_000);
      expect(ms).toBeLessThanOrEqual(5_000);
    });
    it('returns null when absent or unparseable', () => {
      expect(parseRetryAfter(new Headers(), now)).toBeNull();
      expect(parseRetryAfter(new Headers({ 'retry-after': 'nonsense' }), now)).toBeNull();
    });
    it('clamps negatives (past dates) to 0', () => {
      const past = new Date(1_000_000 - 5_000).toUTCString();
      expect(parseRetryAfter(new Headers({ 'retry-after': past }), now)).toBe(0);
    });
  });
});

describe('callClaude retry behavior', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns the parsed message on first-attempt success without sleeping', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(messageResponse());
    const clock = makeClock();

    const result = await callClaude(makeParams(), clock);

    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith('claude_api_call', expect.any(Object));
  });

  it('retries once on 429 then succeeds', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429))
      .mockResolvedValueOnce(messageResponse());
    const clock = makeClock();

    const result = await callClaude(makeParams(), clock);

    expect(result.content[0]).toEqual({ type: 'text', text: 'Hello!' });
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(clock.sleep).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      'claude_api_retry',
      expect.objectContaining({ attempt: 1, status: 429 })
    );
  });

  it('honors Retry-After when larger than the jittered backoff', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(429, { 'retry-after': '10' }))
      .mockResolvedValueOnce(messageResponse());
    // random()->0 so jitter is 0; Retry-After (10s) must win
    const clock = makeClock({ random: () => 0 });

    await callClaude(makeParams(), clock);

    expect(clock.sleep).toHaveBeenCalledWith(10_000, undefined);
    expect(logger.warn).toHaveBeenCalledWith(
      'claude_api_retry',
      expect.objectContaining({ retry_after_ms: 10_000, delay_ms: 10_000 })
    );
  });

  it('retries on transient 5xx', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(messageResponse());
    const clock = makeClock();

    await callClaude(makeParams(), clock);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a non-retryable 400 and throws ClaudeAPIError', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(400));
    const clock = makeClock();

    await expect(callClaude(makeParams(), clock)).rejects.toBeInstanceOf(ClaudeAPIError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'claude_api_error',
      expect.objectContaining({ status: 400 })
    );
  });

  it('exhausts retries on persistent 429 and logs exhaustion', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(429));
    const clock = makeClock();

    await expect(callClaude(makeParams(), clock)).rejects.toBeInstanceOf(ClaudeAPIError);
    // 4 attempts total (1 + 3 retries) → 3 sleeps
    expect(globalThis.fetch).toHaveBeenCalledTimes(4);
    expect(clock.sleep).toHaveBeenCalledTimes(3);
    expect(logger.error).toHaveBeenCalledWith(
      'claude_api_retry_exhausted',
      expect.objectContaining({ attempts: 4, status: 429, reason: 'max_attempts' })
    );
  });

  it('stops early when the overall retry window would be exceeded', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(429, { 'retry-after': '200' }));
    // A 200s Retry-After exceeds the 180s window on the first failure → no sleep, immediate throw.
    const clock = makeClock({ random: () => 0 });

    await expect(callClaude(makeParams(), clock)).rejects.toBeInstanceOf(ClaudeAPIError);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(clock.sleep).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'claude_api_retry_exhausted',
      expect.objectContaining({ reason: 'overall_window_exceeded' })
    );
  });

  it('retries a transient network rejection', async () => {
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(messageResponse());
    const clock = makeClock();

    await callClaude(makeParams(), clock);

    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'claude_api_retry',
      expect.objectContaining({ attempt: 1, network_error: 'network down' })
    );
  });
});

describe('callClaude abort handling', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('does not retry a deliberate abort and propagates it', async () => {
    const abortErr = Object.assign(new Error('Aborted'), { name: 'AbortError' });
    // Plain function (not vi.fn) so the spy's result tracking doesn't flag the
    // rejection we deliberately propagate as an unhandled rejection.
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw abortErr;
    }) as unknown as typeof globalThis.fetch;
    const clock = makeClock();

    await expect(callClaude(makeParams(), clock)).rejects.toBe(abortErr);
    expect(calls).toBe(1);
    expect(clock.sleep).not.toHaveBeenCalled();
  });

  it('bails without fetching when the signal is already aborted', async () => {
    globalThis.fetch = vi.fn();
    const clock = makeClock();
    const controller = new AbortController();
    controller.abort();

    await expect(
      callClaude(makeParams({ signal: controller.signal }), clock)
    ).rejects.toHaveProperty('name', 'AbortError');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('rejects the backoff wait immediately when the watchdog aborts mid-delay', async () => {
    const controller = new AbortController();
    // Always 429 with a long Retry-After: without abort-awareness the sleep would
    // park the pipeline for ~120s past the orchestration timeout.
    globalThis.fetch = vi.fn().mockResolvedValue(errorResponse(429, { 'retry-after': '120' }));

    // A sleep that settles only via the abort signal, so we can prove the wait ends
    // the instant the watchdog fires rather than running the timer to completion.
    let sleepEntered!: () => void;
    const parkedInSleep = new Promise<void>((r) => (sleepEntered = r));
    const clock = makeClock({
      sleep: (_ms: number, signal?: AbortSignal) =>
        new Promise<void>((_resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException('Aborted', 'AbortError'));
            return;
          }
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true }
          );
          sleepEntered();
        }),
    });

    const promise = callClaude(makeParams({ signal: controller.signal }), clock);
    await parkedInSleep; // execution is now parked in the backoff wait
    controller.abort(); // watchdog fires mid-backoff

    await expect(promise).rejects.toHaveProperty('name', 'AbortError');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no retry after abort
  });
});
