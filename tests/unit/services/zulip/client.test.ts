import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZulipClient } from '../../../../src/services/zulip/client.js';

describe('ZulipClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function getLastFetchBody(): URLSearchParams {
    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    return call?.[1]?.body as URLSearchParams;
  }

  it('sends stream messages with channel name and topic', async () => {
    const client = new ZulipClient('https://chat.example.com', 'bot@example.com', 'api-key');

    await client.sendMessage({
      type: 'stream',
      to: 'engineering',
      topic: 'bug-report',
      content: 'Hello world',
    });

    const body = getLastFetchBody();
    expect(body.get('type')).toBe('stream');
    expect(body.get('to')).toBe('engineering');
    expect(body.get('topic')).toBe('bug-report');
    expect(body.get('content')).toBe('Hello world');
  });

  it('sends stream messages with numeric channel ID', async () => {
    const client = new ZulipClient('https://chat.example.com', 'bot@example.com', 'api-key');

    await client.sendMessage({
      type: 'stream',
      to: 42,
      topic: 'updates',
      content: 'Channel by ID',
    });

    const body = getLastFetchBody();
    expect(body.get('to')).toBe('42');
    expect(body.get('topic')).toBe('updates');
  });

  it('sends direct messages with user ID array', async () => {
    const client = new ZulipClient('https://chat.example.com', 'bot@example.com', 'api-key');

    await client.sendMessage({
      type: 'direct',
      to: [5, 12, 20],
      content: 'DM by IDs',
    });

    const body = getLastFetchBody();
    expect(body.get('type')).toBe('direct');
    expect(body.get('to')).toBe('[5,12,20]');
    expect(body.has('topic')).toBe(false);
    expect(body.get('content')).toBe('DM by IDs');
  });

  it('sends direct messages with email array', async () => {
    const client = new ZulipClient('https://chat.example.com', 'bot@example.com', 'api-key');

    await client.sendMessage({
      type: 'direct',
      to: ['alice@example.com', 'bob@example.com'],
      content: 'DM by emails',
    });

    const body = getLastFetchBody();
    expect(body.get('type')).toBe('direct');
    expect(body.get('to')).toBe('["alice@example.com","bob@example.com"]');
  });

  it('uses Basic auth with bot credentials', async () => {
    const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'secret-key');

    await client.sendMessage({
      type: 'stream',
      to: 'general',
      topic: 'test',
      content: 'auth check',
    });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Basic ' + btoa('bot@test.com:secret-key'));
  });

  it('posts to /api/v1/messages with correct content type', async () => {
    const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

    await client.sendMessage({
      type: 'stream',
      to: 'general',
      topic: 'test',
      content: 'hi',
    });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    expect(call?.[0]).toBe('https://chat.example.com/api/v1/messages');
    const headers = call?.[1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
  });
});
