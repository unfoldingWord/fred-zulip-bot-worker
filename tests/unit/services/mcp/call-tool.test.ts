import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callTool } from '../../../../src/services/mcp/call-tool.js';
import type { MCPServerConfig } from '../../../../src/services/mcp/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('callTool', () => {
  let originalFetch: typeof globalThis.fetch;
  const logger: RequestLogger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const config: MCPServerConfig = {
    id: 'fred-mcp',
    name: 'Fred MCP',
    url: 'https://mcp.test/rpc',
    authToken: 'tok',
  };

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.clearAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('calls tools/call with name and arguments', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'result data' }] },
        })
      )
    );

    const result = await callTool(config, 'execute_sql', { query: 'SELECT 1' }, logger);

    expect(result.isError).toBe(false);
    expect(result.content).toBe('result data');
    expect(result.meta?.duration_ms).toBeTypeOf('number');

    const body = JSON.parse(vi.mocked(globalThis.fetch).mock.calls[0][1]?.body as string);
    expect(body.method).toBe('tools/call');
    expect(body.params.name).toBe('execute_sql');
    expect(body.params.arguments).toEqual({ query: 'SELECT 1' });
  });

  it('returns error result on JSON-RPC error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -1, message: 'tool not found' },
        })
      )
    );

    const result = await callTool(config, 'bad_tool', {}, logger);

    expect(result.isError).toBe(true);
    expect(result.content).toBe('tool not found');
    expect(logger.error).toHaveBeenCalled();
  });

  it('extracts text from multiple content blocks', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            content: [
              { type: 'text', text: 'line 1' },
              { type: 'text', text: 'line 2' },
            ],
          },
        })
      )
    );

    const result = await callTool(config, 'test', {}, logger);
    expect(result.content).toBe('line 1\nline 2');
  });

  it('logs tool call start and complete', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { content: [{ type: 'text', text: 'ok' }] },
        })
      )
    );

    await callTool(config, 'execute_sql', { q: '1' }, logger);

    expect(logger.log).toHaveBeenCalledWith(
      'tool_call_start',
      expect.objectContaining({
        tool_name: 'execute_sql',
      })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'tool_call_complete',
      expect.objectContaining({
        tool_name: 'execute_sql',
      })
    );
  });
});
