import type { Env } from '../../types/env.js';
import type { MCPServerConfig } from './types.js';

export function buildFredMCPConfig(env: Env): MCPServerConfig {
  return {
    id: 'fred-mcp',
    name: 'Fred MCP',
    url: env.FRED_MCP_URL ?? 'https://fred-mcp.fly.dev/mcp',
    authToken: env.FRED_MCP_TOKEN,
  };
}
