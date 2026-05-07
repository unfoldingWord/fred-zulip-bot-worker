import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchSchemaForPrompt } from '../../../../src/services/schema/preload.js';
import type { MCPServerConfig } from '../../../../src/services/mcp/types.js';
import type { RequestLogger } from '../../../../src/utils/logger.js';

vi.mock('../../../../src/services/mcp/call-tool.js', () => ({
  callTool: vi.fn(),
}));

import { callTool } from '../../../../src/services/mcp/call-tool.js';

const mcpConfig: MCPServerConfig = {
  id: 'fred-mcp',
  name: 'Fred MCP',
  url: 'https://mcp.test/rpc',
  authToken: 'tok',
};

function makeLogger(): RequestLogger {
  return { log: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeKv(overrides: Partial<KVNamespace> = {}): KVNamespace {
  const base = {
    get: vi.fn().mockResolvedValue(null),
    put: vi.fn().mockResolvedValue(undefined),
  } as unknown as KVNamespace;
  return Object.assign(base, overrides);
}

describe('fetchSchemaForPrompt', () => {
  beforeEach(() => {
    vi.mocked(callTool).mockReset();
  });

  it('returns cached value on KV hit and skips MCP call', async () => {
    const cached = 't:countries:cols=alpha_3_code:varchar(3)!:PK';
    const kv = makeKv({ get: vi.fn().mockResolvedValue(cached) } as Partial<KVNamespace>);
    const logger = makeLogger();

    const result = await fetchSchemaForPrompt(kv, mcpConfig, logger);

    expect(result).toBe(cached);
    expect(callTool).not.toHaveBeenCalled();
    expect(kv.put).not.toHaveBeenCalled();
    expect(logger.log).toHaveBeenCalledWith(
      'schema_cache_hit',
      expect.objectContaining({ key: 'fred:schema:v1', bytes: cached.length })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'schema_preload_complete',
      expect.objectContaining({ source: 'cache' })
    );
  });

  it('fetches via MCP and writes to KV on cache miss', async () => {
    const fetched = 't:organizations:cols=id:int!:PK,name:text';
    const kv = makeKv();
    const logger = makeLogger();
    vi.mocked(callTool).mockResolvedValue({
      content: fetched,
      isError: false,
      meta: { duration_ms: 10, response_size: fetched.length },
    });

    const result = await fetchSchemaForPrompt(kv, mcpConfig, logger);

    expect(result).toBe(fetched);
    expect(callTool).toHaveBeenCalledWith(mcpConfig, 'list_tables', {}, logger);
    expect(kv.put).toHaveBeenCalledWith('fred:schema:v1', fetched, { expirationTtl: 3600 });
    expect(logger.log).toHaveBeenCalledWith(
      'schema_cache_miss',
      expect.objectContaining({ key: 'fred:schema:v1' })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'schema_fetch_complete',
      expect.objectContaining({ bytes: fetched.length })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'schema_cache_write_complete',
      expect.objectContaining({ key: 'fred:schema:v1', bytes: fetched.length, ttl_seconds: 3600 })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'schema_preload_complete',
      expect.objectContaining({ source: 'fetch' })
    );
  });

  it('returns empty string and skips KV.put when MCP returns an error', async () => {
    const kv = makeKv();
    const logger = makeLogger();
    vi.mocked(callTool).mockResolvedValue({
      content: 'mcp boom',
      isError: true,
      meta: { duration_ms: 10, response_size: 0 },
    });

    const result = await fetchSchemaForPrompt(kv, mcpConfig, logger);

    expect(result).toBe('');
    expect(kv.put).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'schema_fetch_error',
      expect.objectContaining({ error: 'mcp boom' })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'schema_preload_complete',
      expect.objectContaining({ source: 'none' })
    );
  });

  it('returns empty string and skips KV.put when MCP returns empty content', async () => {
    const kv = makeKv();
    const logger = makeLogger();
    vi.mocked(callTool).mockResolvedValue({
      content: '   \n  ',
      isError: false,
      meta: { duration_ms: 10, response_size: 4 },
    });

    const result = await fetchSchemaForPrompt(kv, mcpConfig, logger);

    expect(result).toBe('');
    expect(kv.put).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith('schema_fetch_empty', expect.any(Object));
    expect(logger.log).toHaveBeenCalledWith(
      'schema_preload_complete',
      expect.objectContaining({ source: 'none' })
    );
  });

  it('still returns content when KV.put fails', async () => {
    const fetched = 't:projects:cols=id:int!:PK';
    const kv = makeKv({
      put: vi.fn().mockRejectedValue(new Error('kv write down')),
    } as Partial<KVNamespace>);
    const logger = makeLogger();
    vi.mocked(callTool).mockResolvedValue({
      content: fetched,
      isError: false,
      meta: { duration_ms: 10, response_size: fetched.length },
    });

    const result = await fetchSchemaForPrompt(kv, mcpConfig, logger);

    expect(result).toBe(fetched);
    expect(logger.error).toHaveBeenCalledWith(
      'schema_cache_write_error',
      expect.objectContaining({ key: 'fred:schema:v1', error: 'kv write down' })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'schema_preload_complete',
      expect.objectContaining({ source: 'fetch' })
    );
  });

  it('falls through to MCP and logs read error when KV.get throws', async () => {
    const fetched = 't:countries:cols=alpha_3_code:varchar(3)!:PK';
    const kv = makeKv({
      get: vi.fn().mockRejectedValue(new Error('kv read down')),
    } as Partial<KVNamespace>);
    const logger = makeLogger();
    vi.mocked(callTool).mockResolvedValue({
      content: fetched,
      isError: false,
      meta: { duration_ms: 10, response_size: fetched.length },
    });

    const result = await fetchSchemaForPrompt(kv, mcpConfig, logger);

    expect(result).toBe(fetched);
    expect(callTool).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      'schema_cache_read_error',
      expect.objectContaining({ key: 'fred:schema:v1', error: 'kv read down' })
    );
    expect(logger.log).toHaveBeenCalledWith(
      'schema_preload_complete',
      expect.objectContaining({ source: 'fetch' })
    );
  });
});
