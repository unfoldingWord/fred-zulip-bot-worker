import type { RequestLogger } from '../../utils/logger.js';
import type { MCPServerConfig, MCPServerManifest, MCPToolDefinition } from './types.js';
import { sendJsonRpc } from './client.js';

export async function discoverTools(
  config: MCPServerConfig,
  logger: RequestLogger
): Promise<MCPServerManifest> {
  const startMs = Date.now();
  logger.log('mcp_discovery_start', { server: config.id });

  const response = await sendJsonRpc({
    url: config.url,
    method: 'tools/list',
    params: {},
    token: config.authToken,
    logger,
  });

  if (response.error) {
    logger.error('mcp_discovery_error', {
      server: config.id,
      error: response.error.message,
      duration_ms: Date.now() - startMs,
    });
    return { serverId: config.id, tools: [] };
  }

  const tools = parseToolsList(response.result);
  logger.log('mcp_discovery_complete', {
    server: config.id,
    tool_count: tools.length,
    duration_ms: Date.now() - startMs,
  });

  return { serverId: config.id, tools };
}

function parseToolsList(result: unknown): MCPToolDefinition[] {
  if (!result || typeof result !== 'object') return [];
  const obj = result as { tools?: unknown[] };
  if (!Array.isArray(obj.tools)) return [];

  return obj.tools
    .filter((t): t is Record<string, unknown> => typeof t === 'object' && t !== null)
    .map((t) => ({
      name: String(t.name ?? ''),
      description: String(t.description ?? ''),
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
    }));
}
