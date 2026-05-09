import type { RequestLogger } from '../../utils/logger.js';
import type { MCPServerConfig } from '../mcp/types.js';
import { callTool } from '../mcp/call-tool.js';

const SCHEMA_KV_KEY = 'fred:schema:v1';
const SCHEMA_TTL_SECONDS = 3600;

/**
 * Fetch the Fred database schema for injection into the system prompt.
 *
 * Hot path: KV.get('fred:schema:v1'). Cold path: call list_tables on the
 * Fred MCP server, store the result in KV with a 1h TTL, return it.
 *
 * Bumping the version suffix in the KV key (v1 → v2) is the supported
 * cache-bust mechanism if fred-mcp ever changes the descriptor format.
 *
 * Always returns a string. Empty string means "no schema available this
 * request" — the caller (system-prompt builder) should omit the schema
 * section, and the model will fall back to calling list_tables itself.
 * No request ever fails because of a cache problem.
 */
export async function fetchSchemaForPrompt(
  kv: KVNamespace,
  mcpConfig: MCPServerConfig,
  logger: RequestLogger
): Promise<string> {
  const overallStart = Date.now();
  logger.log('schema_preload_start', { key: SCHEMA_KV_KEY });

  try {
    const cached = await readCache(kv, logger);
    if (cached !== null) {
      logger.log('schema_preload_complete', {
        source: 'cache',
        bytes: cached.length,
        total_duration_ms: Date.now() - overallStart,
      });
      return cached;
    }

    const fetched = await fetchAndCache(kv, mcpConfig, logger);
    logger.log('schema_preload_complete', {
      source: fetched ? 'fetch' : 'none',
      bytes: fetched.length,
      total_duration_ms: Date.now() - overallStart,
    });
    return fetched;
  } catch (e) {
    logger.error('schema_preload_unexpected_throw', { error: errMsg(e) });
    logger.log('schema_preload_complete', {
      source: 'none',
      bytes: 0,
      total_duration_ms: Date.now() - overallStart,
    });
    return '';
  }
}

async function readCache(kv: KVNamespace, logger: RequestLogger): Promise<string | null> {
  let cached: string | null;
  try {
    cached = await kv.get(SCHEMA_KV_KEY);
  } catch (e) {
    logger.error('schema_cache_read_error', { key: SCHEMA_KV_KEY, error: errMsg(e) });
    return null;
  }

  if (cached !== null && cached.length > 0) {
    logger.log('schema_cache_hit', { key: SCHEMA_KV_KEY, bytes: cached.length });
    return cached;
  }

  logger.log('schema_cache_miss', { key: SCHEMA_KV_KEY });
  return null;
}

async function fetchAndCache(
  kv: KVNamespace,
  mcpConfig: MCPServerConfig,
  logger: RequestLogger
): Promise<string> {
  logger.log('schema_fetch_start', {});
  const fetchStart = Date.now();
  const result = await callTool(mcpConfig, 'list_tables', {}, logger);
  const fetchDuration = Date.now() - fetchStart;

  if (result.isError) {
    logger.error('schema_fetch_error', {
      error: result.content,
      duration_ms: fetchDuration,
    });
    return '';
  }

  const content = result.content.trim();
  if (content.length === 0) {
    logger.warn('schema_fetch_empty', { duration_ms: fetchDuration });
    return '';
  }

  logger.log('schema_fetch_complete', {
    bytes: content.length,
    duration_ms: fetchDuration,
  });

  await writeCache(kv, content, logger);
  return content;
}

async function writeCache(kv: KVNamespace, content: string, logger: RequestLogger): Promise<void> {
  logger.log('schema_cache_write_start', {
    key: SCHEMA_KV_KEY,
    bytes: content.length,
    ttl_seconds: SCHEMA_TTL_SECONDS,
  });
  const writeStart = Date.now();
  try {
    await kv.put(SCHEMA_KV_KEY, content, { expirationTtl: SCHEMA_TTL_SECONDS });
    logger.log('schema_cache_write_complete', {
      key: SCHEMA_KV_KEY,
      bytes: content.length,
      ttl_seconds: SCHEMA_TTL_SECONDS,
      duration_ms: Date.now() - writeStart,
    });
  } catch (e) {
    logger.error('schema_cache_write_error', { key: SCHEMA_KV_KEY, error: errMsg(e) });
  }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
