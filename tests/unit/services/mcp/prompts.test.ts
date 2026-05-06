import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchPromptText } from '../../../../src/services/mcp/prompts.js';
import type { MCPServerConfig } from '../../../../src/services/mcp/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

const config: MCPServerConfig = {
  id: 'fred-mcp',
  name: 'Fred',
  url: 'https://mcp.test/mcp',
  authToken: 'tok',
};

function makeLogger(): RequestLogger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

describe('fetchPromptText', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns concatenated text from a prompts/get response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            messages: [
              { role: 'user', content: { type: 'text', text: 'rule one' } },
              { role: 'user', content: { type: 'text', text: 'rule two' } },
            ],
          },
        })
      )
    );

    const text = await fetchPromptText(config, 'fred_query_rules', makeLogger());
    expect(text).toBe('rule one\n\nrule two');
  });

  it('handles plain string content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            messages: [{ role: 'user', content: 'plain string content' }],
          },
        })
      )
    );

    const text = await fetchPromptText(config, 'x', makeLogger());
    expect(text).toBe('plain string content');
  });

  it('returns empty string and logs warn on JSON-RPC error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32601, message: 'Method not found' },
        })
      )
    );

    const logger = makeLogger();
    const text = await fetchPromptText(config, 'missing', logger);
    expect(text).toBe('');
    expect(logger.warn).toHaveBeenCalledWith(
      'mcp_prompt_fetch_error',
      expect.objectContaining({ prompt: 'missing', error: 'Method not found' })
    );
  });

  it('returns empty string for malformed result (no messages array)', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { foo: 'bar' } }))
      );

    const text = await fetchPromptText(config, 'x', makeLogger());
    expect(text).toBe('');
  });

  it('skips messages with non-text content', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            messages: [
              { role: 'user', content: { type: 'image', data: 'xyz' } },
              { role: 'user', content: { type: 'text', text: 'kept' } },
              { role: 'user', content: null },
            ],
          },
        })
      )
    );

    const text = await fetchPromptText(config, 'x', makeLogger());
    expect(text).toBe('kept');
  });

  it('returns empty string on network error and does not throw', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const logger = makeLogger();
    const text = await fetchPromptText(config, 'x', logger);
    expect(text).toBe('');
    expect(logger.warn).toHaveBeenCalledWith(
      'mcp_prompt_fetch_error',
      expect.objectContaining({ error: expect.stringContaining('network down') })
    );
  });
});
