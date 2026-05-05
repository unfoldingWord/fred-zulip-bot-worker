import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { discoverTools } from '../../../../src/services/mcp/discovery.js';
import type { MCPServerConfig } from '../../../../src/services/mcp/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

describe('discoverTools', () => {
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

  it('parses tool list from JSON-RPC response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: {
            tools: [
              { name: 'execute_sql', description: 'Run SQL', inputSchema: { type: 'object' } },
              { name: 'list_tables', description: 'List tables', inputSchema: {} },
            ],
          },
        })
      )
    );

    const manifest = await discoverTools(config, logger);

    expect(manifest.serverId).toBe('fred-mcp');
    expect(manifest.tools).toHaveLength(2);
    expect(manifest.tools[0].name).toBe('execute_sql');
    expect(manifest.tools[1].name).toBe('list_tables');
  });

  it('returns empty tools on error response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          error: { code: -32600, message: 'Bad request' },
        })
      )
    );

    const manifest = await discoverTools(config, logger);

    expect(manifest.tools).toHaveLength(0);
    expect(logger.error).toHaveBeenCalled();
  });

  it('returns empty tools on malformed result', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: 'not an object',
        })
      )
    );

    const manifest = await discoverTools(config, logger);
    expect(manifest.tools).toHaveLength(0);
  });

  it('logs discovery timing', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          result: { tools: [] },
        })
      )
    );

    await discoverTools(config, logger);

    expect(logger.log).toHaveBeenCalledWith('mcp_discovery_start', expect.any(Object));
    expect(logger.log).toHaveBeenCalledWith(
      'mcp_discovery_complete',
      expect.objectContaining({
        server: 'fred-mcp',
        tool_count: 0,
      })
    );
  });
});
