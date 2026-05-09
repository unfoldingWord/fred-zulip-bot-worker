import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sendJsonRpc } from '../../../../src/services/mcp/client.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('sendJsonRpc', () => {
  let originalFetch: typeof globalThis.fetch;
  const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('sends JSON-RPC 2.0 request with correct format', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { tools: [] } }))
      );

    await sendJsonRpc({
      url: 'https://mcp.test/rpc',
      method: 'tools/list',
      params: {},
      token: 'token-123',
      logger,
    });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const body = JSON.parse(call[1]?.body as string);
    expect(body.jsonrpc).toBe('2.0');
    expect(body.method).toBe('tools/list');
    expect(body.id).toBeTypeOf('number');
  });

  it('includes Bearer token in Authorization header', async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })));

    await sendJsonRpc({
      url: 'https://mcp.test/rpc',
      method: 'tools/call',
      params: {},
      token: 'my-token',
      logger,
    });

    const call = vi.mocked(globalThis.fetch).mock.calls[0];
    const headers = call[1]?.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer my-token');
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('returns error response on HTTP failure', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('', { status: 500 }));

    const result = await sendJsonRpc({
      url: 'https://mcp.test/rpc',
      method: 'tools/list',
      params: {},
      token: 'tok',
      logger,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.code).toBe(500);
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns error response on network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network down'));

    const result = await sendJsonRpc({
      url: 'https://mcp.test/rpc',
      method: 'tools/list',
      params: {},
      token: 'tok',
      logger,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toContain('network down');
  });

  it('handles timeout via AbortController', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        init?.signal?.addEventListener('abort', onAbort);
      });
    });

    const result = await sendJsonRpc({
      url: 'https://mcp.test/rpc',
      method: 'tools/list',
      params: {},
      token: 'tok',
      logger,
      timeoutMs: 50,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('Timeout');
  });

  it('aborts immediately when parent signal fires', async () => {
    globalThis.fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const onAbort = () => reject(new DOMException('The operation was aborted.', 'AbortError'));
        init?.signal?.addEventListener('abort', onAbort);
      });
    });

    const parent = new AbortController();
    const resultPromise = sendJsonRpc({
      url: 'https://mcp.test/rpc',
      method: 'tools/call',
      params: {},
      token: 'tok',
      logger,
      timeoutMs: 60000,
      signal: parent.signal,
    });

    // Parent abort fires well before the 60s per-call timeout
    parent.abort();
    const result = await resultPromise;

    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('Timeout');
  });

  it('returns timeout immediately when parent signal is already aborted', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const parent = new AbortController();
    parent.abort();

    const result = await sendJsonRpc({
      url: 'https://mcp.test/rpc',
      method: 'tools/call',
      params: {},
      token: 'tok',
      logger,
      timeoutMs: 60000,
      signal: parent.signal,
    });

    expect(result.error).toBeDefined();
    expect(result.error?.message).toBe('Timeout');
    // fetch should never have been called
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
