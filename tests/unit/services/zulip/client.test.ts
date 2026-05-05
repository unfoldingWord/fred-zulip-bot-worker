import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ZulipClient } from '../../../../src/services/zulip/client.js';

function getLastFetchCall() {
  return vi.mocked(globalThis.fetch).mock.calls[0];
}

function getLastFetchBody(): URLSearchParams {
  return getLastFetchCall()?.[1]?.body as URLSearchParams;
}

describe('ZulipClient', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('sendMessage', () => {
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

      const call = getLastFetchCall();
      const headers = call?.[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Basic ' + btoa('bot@test.com:secret-key'));
    });

    it('posts to /api/v1/messages with correct content type', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.sendMessage({ type: 'stream', to: 'general', topic: 'test', content: 'hi' });

      const call = getLastFetchCall();
      expect(call?.[0]).toBe('https://chat.example.com/api/v1/messages');
      const headers = call?.[1]?.headers as Record<string, string>;
      expect(headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    });
  });
});

describe('ZulipClient reactions and messages', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('addReaction', () => {
    it('posts emoji reaction to correct endpoint', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.addReaction(42, 'thinking');

      const call = getLastFetchCall();
      expect(call?.[0]).toBe('https://chat.example.com/api/v1/messages/42/reactions');
      expect(call?.[1]?.method).toBe('POST');
      const body = getLastFetchBody();
      expect(body.get('emoji_name')).toBe('thinking');
    });

    it('includes auth header', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.addReaction(1, 'thumbs_up');

      const call = getLastFetchCall();
      const headers = call?.[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Basic ' + btoa('bot@test.com:key'));
    });
  });

  describe('removeReaction', () => {
    it('sends DELETE to reactions endpoint', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.removeReaction(42, 'thinking');

      const call = getLastFetchCall();
      expect(call?.[0]).toBe('https://chat.example.com/api/v1/messages/42/reactions');
      expect(call?.[1]?.method).toBe('DELETE');
      const body = getLastFetchBody();
      expect(body.get('emoji_name')).toBe('thinking');
    });
  });

  describe('getMessages', () => {
    it('fetches messages with narrow parameters', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.getMessages({
        narrow: [
          { operator: 'channel', operand: 1 },
          { operator: 'topic', operand: 'general' },
        ],
        num_before: 20,
      });

      const call = getLastFetchCall();
      const url = new URL(call?.[0] as string);
      expect(url.pathname).toBe('/api/v1/messages');
      expect(url.searchParams.get('anchor')).toBe('newest');
      expect(url.searchParams.get('num_before')).toBe('20');
      expect(url.searchParams.get('num_after')).toBe('0');

      const narrow = JSON.parse(url.searchParams.get('narrow')!);
      expect(narrow).toEqual([
        { operator: 'channel', operand: 1 },
        { operator: 'topic', operand: 'general' },
      ]);
    });

    it('uses GET method with auth header', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.getMessages({
        narrow: [{ operator: 'dm', operand: [5, 10] }],
      });

      const call = getLastFetchCall();
      expect(call?.[1]?.method).toBe('GET');
      const headers = call?.[1]?.headers as Record<string, string>;
      expect(headers['Authorization']).toBe('Basic ' + btoa('bot@test.com:key'));
    });

    it('uses defaults for optional params', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.getMessages({ narrow: [] });

      const call = getLastFetchCall();
      const url = new URL(call?.[0] as string);
      expect(url.searchParams.get('anchor')).toBe('newest');
      expect(url.searchParams.get('num_before')).toBe('20');
      expect(url.searchParams.get('num_after')).toBe('0');
      expect(url.searchParams.has('include_anchor')).toBe(false);
      expect(url.searchParams.has('apply_markdown')).toBe(false);
    });

    it('forwards include_anchor and apply_markdown when provided', async () => {
      const client = new ZulipClient('https://chat.example.com', 'bot@test.com', 'key');

      await client.getMessages({
        narrow: [],
        anchor: 12345,
        include_anchor: false,
        apply_markdown: false,
      });

      const call = getLastFetchCall();
      const url = new URL(call?.[0] as string);
      expect(url.searchParams.get('anchor')).toBe('12345');
      expect(url.searchParams.get('include_anchor')).toBe('false');
      expect(url.searchParams.get('apply_markdown')).toBe('false');
    });
  });
});
