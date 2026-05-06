import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchHistory } from '../../../../src/services/history/fetcher.js';
import { ZulipClient } from '../../../../src/services/zulip/client.js';
import type { ZulipMessage } from '../../../../src/services/zulip/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('fetchHistory', () => {
  let originalFetch: typeof globalThis.fetch;
  const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const BOT_EMAIL = 'bot@test.com';

  function makeClient() {
    return new ZulipClient('https://chat.example.com', BOT_EMAIL, 'key');
  }

  const streamMessage: ZulipMessage = {
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
  };

  const dmMessage: ZulipMessage = {
    id: 2,
    sender_id: 5,
    sender_email: 'user@test.com',
    sender_full_name: 'User',
    content: 'hi',
    subject: '',
    stream_id: undefined,
    display_recipient: [
      { id: 5, email: 'user@test.com', full_name: 'User' },
      { id: 10, email: 'bot@test.com', full_name: 'Bot' },
    ],
    type: 'private',
    timestamp: 1700000000,
  };

  it('defaults to fetching 10 messages of history', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [] })));

    await fetchHistory(makeClient(), streamMessage, BOT_EMAIL, logger);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = new URL(call[0] as string);
    expect(url.searchParams.get('num_before')).toBe('10');
  });

  it('builds stream narrow with channel and topic', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [] })));

    await fetchHistory(makeClient(), streamMessage, BOT_EMAIL, logger);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = new URL(call[0] as string);
    const narrow = JSON.parse(url.searchParams.get('narrow')!);
    expect(narrow).toEqual([
      { operator: 'channel', operand: 42 },
      { operator: 'topic', operand: 'general' },
    ]);
  });

  it('anchors on the triggering message id and excludes it, requests raw markdown', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [] })));

    await fetchHistory(makeClient(), streamMessage, BOT_EMAIL, logger);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = new URL(call[0] as string);
    expect(url.searchParams.get('anchor')).toBe(String(streamMessage.id));
    expect(url.searchParams.get('include_anchor')).toBe('false');
    expect(url.searchParams.get('apply_markdown')).toBe('false');
  });

  it('builds DM narrow with the other participant only (excludes bot)', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [] })));

    await fetchHistory(makeClient(), dmMessage, BOT_EMAIL, logger);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = new URL(call[0] as string);
    const narrow = JSON.parse(url.searchParams.get('narrow')!);
    expect(narrow).toEqual([{ operator: 'dm', operand: [5] }]);
  });

  it('builds DM narrow with sorted other-participant ids for group DMs', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ messages: [] })));

    const groupDm: ZulipMessage = {
      ...dmMessage,
      display_recipient: [
        { id: 20, email: 'alice@test.com', full_name: 'Alice' },
        { id: 5, email: 'user@test.com', full_name: 'User' },
        { id: 10, email: BOT_EMAIL, full_name: 'Bot' },
      ],
    };

    await fetchHistory(makeClient(), groupDm, BOT_EMAIL, logger);

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const url = new URL(call[0] as string);
    const narrow = JSON.parse(url.searchParams.get('narrow')!);
    expect(narrow).toEqual([{ operator: 'dm', operand: [5, 20] }]);
  });

  it('skips fetch and returns [] when no other participants remain', async () => {
    globalThis.fetch = vi.fn();

    const botOnly: ZulipMessage = {
      ...dmMessage,
      display_recipient: [{ id: 10, email: BOT_EMAIL, full_name: 'Bot' }],
    };

    const result = await fetchHistory(makeClient(), botOnly, BOT_EMAIL, logger);

    expect(result).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('returns messages from response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          messages: [
            {
              id: 1,
              sender_email: 'a@test.com',
              sender_full_name: 'A',
              content: 'hi',
              timestamp: 1,
            },
            {
              id: 2,
              sender_email: 'b@test.com',
              sender_full_name: 'B',
              content: 'hello',
              timestamp: 2,
            },
          ],
        })
      )
    );

    const result = await fetchHistory(makeClient(), streamMessage, BOT_EMAIL, logger);
    expect(result).toHaveLength(2);
  });

  it('returns empty array on fetch error and logs narrow + response body', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response('{"result":"error","msg":"Bad narrow"}', { status: 400 }));

    const result = await fetchHistory(makeClient(), streamMessage, BOT_EMAIL, logger);
    expect(result).toHaveLength(0);
    expect(logger.error).toHaveBeenCalledWith(
      'history_fetch_error',
      expect.objectContaining({
        status: 400,
        narrow: expect.stringContaining('"channel"'),
        response_body: expect.stringContaining('Bad narrow'),
      })
    );
  });
});
