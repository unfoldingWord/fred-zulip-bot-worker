import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendResponse, sendErrorMessage } from '../../../../src/services/pipeline/send-response.js';
import { ZulipClient } from '../../../../src/services/zulip/client.js';
import type { ZulipWebhookPayload } from '../../../../src/services/zulip/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

const BOT_EMAIL = 'bot@test.com';

function makeLogger(): RequestLogger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeClient(): ZulipClient {
  return new ZulipClient('https://chat.example.com', BOT_EMAIL, 'key');
}

const streamPayload: ZulipWebhookPayload = {
  token: 'tok',
  message: {
    id: 1,
    sender_id: 5,
    sender_email: 'user@test.com',
    sender_full_name: 'User',
    content: 'hello',
    subject: 'general',
    stream_id: 42,
    display_recipient: 'engineering',
    type: 'stream',
    timestamp: 1700000000,
  },
  bot_email: BOT_EMAIL,
};

describe('sendResponse', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('substitutes the fallback error text when response is empty', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    globalThis.fetch = fetchMock;
    const logger = makeLogger();

    await sendResponse(makeClient(), streamPayload, BOT_EMAIL, '   ', logger);

    expect(logger.warn).toHaveBeenCalledWith('response_empty_substituted', expect.any(Object));
    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams;
    expect(body.get('content')).toBe(
      'Sorry, I encountered an error processing your request. Please try again.'
    );
  });

  it('throws on non-retryable failure (4xx) without retrying', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('bad', { status: 400 }));
    const logger = makeLogger();

    await expect(
      sendResponse(makeClient(), streamPayload, BOT_EMAIL, 'hi', logger)
    ).rejects.toThrow(/status=400/);

    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      'response_post_error',
      expect.objectContaining({ status: 400, retried: false })
    );
  });

  it('retries and succeeds when first attempt is 5xx and second is 200', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock;
    const logger = makeLogger();

    const promise = sendResponse(makeClient(), streamPayload, BOT_EMAIL, 'hi', logger);
    await vi.advanceTimersByTimeAsync(300);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'response_post_retrying',
      expect.objectContaining({ status: 503 })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'response_posted',
      expect.objectContaining({ retried: true })
    );
  });

  it('retries and throws when both attempts return 5xx', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream', { status: 502 }))
      .mockResolvedValueOnce(new Response('upstream', { status: 503 }));
    const logger = makeLogger();

    const promise = sendResponse(makeClient(), streamPayload, BOT_EMAIL, 'hi', logger);
    const rejection = expect(promise).rejects.toThrow(/first=502 second=503/);
    await vi.advanceTimersByTimeAsync(300);
    await rejection;

    expect(logger.error).toHaveBeenCalledWith(
      'response_post_error_fatal',
      expect.objectContaining({ first_status: 502, second_status: 503 })
    );
  });

  it('treats a thrown fetch as transient and retries', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock;
    const logger = makeLogger();

    const promise = sendResponse(makeClient(), streamPayload, BOT_EMAIL, 'hi', logger);
    await vi.advanceTimersByTimeAsync(300);
    await promise;

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith(
      'response_post_threw',
      expect.objectContaining({ error: expect.stringContaining('network down') })
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'response_post_retrying',
      expect.objectContaining({ status: 0 })
    );
  });
});

describe('sendErrorMessage', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns { delivered: true } on successful delivery', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    const logger = makeLogger();

    const result = await sendErrorMessage(makeClient(), streamPayload, BOT_EMAIL, logger);

    expect(result).toEqual({ delivered: true });
    expect(logger.error).not.toHaveBeenCalledWith(
      'error_message_send_failed_fatal',
      expect.any(Object)
    );
  });

  it('returns { delivered: false } and logs error_message_send_failed_fatal when delivery fails', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 }));
    const logger = makeLogger();

    const result = await sendErrorMessage(makeClient(), streamPayload, BOT_EMAIL, logger);

    expect(result).toEqual({ delivered: false });
    expect(logger.error).toHaveBeenCalledWith(
      'error_message_send_failed_fatal',
      expect.objectContaining({ error: expect.stringContaining('status=403') })
    );
  });

  it('appends the detail suffix when provided', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('ok', { status: 200 }));
    globalThis.fetch = fetchMock;
    const logger = makeLogger();

    await sendErrorMessage(makeClient(), streamPayload, BOT_EMAIL, logger, 'no response generated');

    const body = (fetchMock.mock.calls[0][1] as RequestInit).body as URLSearchParams;
    expect(body.get('content')).toContain('no response generated');
  });

  it('returns { delivered: false } when both attempts fail (after retry)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('upstream', { status: 502 }))
      .mockResolvedValueOnce(new Response('upstream', { status: 502 }));
    const logger = makeLogger();

    const promise = sendErrorMessage(makeClient(), streamPayload, BOT_EMAIL, logger);
    await vi.advanceTimersByTimeAsync(300);
    const result = await promise;

    expect(result).toEqual({ delivered: false });
    expect(logger.error).toHaveBeenCalledWith(
      'error_message_send_failed_fatal',
      expect.any(Object)
    );
  });
});
